import Joi from 'joi';
import { P, SCOPE_TYPES } from '../config/permissions.js';
import { CENTER_ID_PATTERN, MAX_LIST_ITEMS } from './service.validator.js';

const PERMISSION_KEYS = Object.values(P);

// Create and update share the schema: the role editor always sends the whole role.
export const roleSchema = Joi.object({
    label: Joi.string().trim().min(2).max(100).required()
        .messages({ 'string.empty': 'المسمى الوظيفي مطلوب', 'any.required': 'المسمى الوظيفي مطلوب', 'string.min': 'المسمى الوظيفي حرفين على الأقل' }),
    description: Joi.string().trim().max(500).allow('', null).default(null).custom((value) => value || null),
    permissions: Joi.array().items(Joi.string().valid(...PERMISSION_KEYS)).unique().default([])
        .messages({ 'any.only': 'صلاحية غير معروفة', 'array.unique': 'صلاحية مكررة' }),
    scopeType: Joi.string().valid(...SCOPE_TYPES).default('all_services')
        .messages({ 'any.only': 'نطاق غير صالح' }),
    assignedOnly: Joi.boolean().default(false),
    // Only the list matching scopeType is kept.
    serviceIds: Joi.array().items(Joi.number().integer().positive()).unique().max(MAX_LIST_ITEMS).default([]),
    centerIds: Joi.array().items(Joi.string().trim().pattern(CENTER_ID_PATTERN).max(100)).unique().max(MAX_LIST_ITEMS).default([]),
}).custom((role, helpers) => {
    if (role.scopeType === 'specific_services' && !role.serviceIds.length) return helpers.error('scope.services');
    if (role.scopeType === 'specific_centers' && !role.centerIds.length) return helpers.error('scope.centers');
    return {
        ...role,
        serviceIds: role.scopeType === 'specific_services' ? role.serviceIds : [],
        centerIds: role.scopeType === 'specific_centers' ? role.centerIds : [],
    };
}).messages({
    'scope.services': 'اختر خدمة واحدة على الأقل لنطاق «خدمات محددة»',
    'scope.centers': 'اختر مركزًا واحدًا على الأقل لنطاق «مراكز محددة»',
});

export const activityFilterSchema = Joi.object({
    entityType: Joi.string().valid('request', 'role', 'staff', 'ngo', 'service', 'center', 'category'),
    actorId: Joi.number().integer().positive(),
    before: Joi.number().integer().positive(),
});
