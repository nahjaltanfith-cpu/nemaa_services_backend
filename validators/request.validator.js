import Joi from 'joi';
import { TEMP_PDF_KEY_PATTERN } from '../services/upload.service.js';

export const REQUEST_STATUSES = ['draft', 'under_study', 'needs_completion', 'in_progress', 'completed'];
// Statuses an admin can move a submitted request to (drafts belong to the NGO).
export const ADMIN_STATUSES = ['under_study', 'needs_completion', 'in_progress', 'completed'];
export const CONTACT_METHODS = ['call', 'meeting', 'session'];
const MAX_FILES = 30;

// A PDF already sent to POST /api/upload: its key plus what to show for it.
const uploadedFile = Joi.object({
    key: Joi.string().pattern(TEMP_PDF_KEY_PATTERN).required()
        .messages({ 'string.pattern.base': 'ملف غير صالح، ارفعه مرة أخرى', 'any.required': 'ملف غير صالح، ارفعه مرة أخرى' }),
    name: Joi.string().trim().max(255).required(),
    size: Joi.number().integer().min(0).max(50 * 1024 * 1024).default(0),
    // Required-document name this file answers (NULL = extra file).
    label: Joi.string().trim().max(500).allow('', null).default(null).custom((value) => value || null),
});

const text = (max) => Joi.string().trim().max(max).allow('').default('');

// Drafts and submissions share the shape; `submit` decides how strict the checks are
// (the service layer enforces the submit-only rules: target, texts, mandatory documents).
export const requestSchema = Joi.object({
    type: Joi.string().valid('service', 'center').allow(null).default(null),
    targetId: Joi.alternatives().try(Joi.number().integer().positive(), Joi.string().trim().max(100)).allow(null, '').default(null),
    needTitle: Joi.string().trim().min(1).max(255).required()
        .messages({ 'string.empty': 'عنوان الاحتياج مطلوب', 'any.required': 'عنوان الاحتياج مطلوب' }),
    summary: text(500),
    description: text(10000),
    contactMethod: Joi.string().valid(...CONTACT_METHODS).default('call'),
    attachments: Joi.array().items(uploadedFile).max(MAX_FILES).default([]),
    submit: Joi.boolean().default(false),
});

// NGO upload for one missing document (the item comes from the URL; its name is the label).
export const missingFileSchema = uploadedFile.keys({ label: Joi.any().strip() });

// Admin status change / timeline entry. Same status as now = a note on the timeline only.
export const statusSchema = Joi.object({
    status: Joi.string().valid(...ADMIN_STATUSES).required().messages({ 'any.only': 'حالة غير صالحة' }),
    label: Joi.string().trim().max(255).allow('', null).default(null).custom((value) => value || null),
    note: Joi.string().trim().max(2000).allow('', null).default(null).custom((value) => value || null),
    missingItems: Joi.array().items(Joi.string().trim().allow('').max(500)).max(MAX_FILES).default([])
        .custom((items) => items.filter(Boolean)),
});

export const deliverablesSchema = Joi.object({
    files: Joi.array().items(uploadedFile).min(1).max(MAX_FILES).required()
        .messages({ 'array.min': 'ارفع ملف التسليم أولًا', 'any.required': 'ارفع ملف التسليم أولًا' }),
});

export const requestMessageSchema = Joi.object({
    body: Joi.string().trim().min(1).max(2000).required()
        .messages({ 'string.empty': 'اكتب الرسالة أولًا', 'any.required': 'اكتب الرسالة أولًا', 'string.max': 'الرسالة أطول من 2000 حرف' }),
});

// null = remove the assignment.
export const assigneeSchema = Joi.object({
    assigneeId: Joi.number().integer().positive().allow(null).required()
        .messages({ 'any.required': 'اختر الموظف', 'number.base': 'اختر الموظف' }),
});

export const requestFilterSchema = Joi.object({
    status: Joi.string().valid(...REQUEST_STATUSES),
    search: Joi.string().trim().max(100).allow(''),
    // Team only: 'me' = assigned to the signed-in user, 'unassigned' = nobody yet.
    assignee: Joi.string().valid('me', 'unassigned'),
});
