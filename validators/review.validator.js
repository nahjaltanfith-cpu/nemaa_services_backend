import Joi from 'joi';
import { ACCOUNT_STATUSES } from '../services/ngo.mapper.js';
import { MAX_MESSAGE_LENGTH } from '../services/messages.service.js';

export const statusUpdateSchema = Joi.object({
    status: Joi.string().valid(...ACCOUNT_STATUSES).required()
        .messages({ 'any.only': 'حالة غير صالحة', 'any.required': 'الحالة مطلوبة' }),
    // Required when asking for completion: it is what the NGO reads in its banner.
    notes: Joi.string().trim().max(2000).allow('')
        .when('status', {
            is: 'needs_documents',
            then: Joi.string().trim().min(5).required(),
        })
        .messages({
            'any.required': 'اكتب ملاحظات توضح للجمعية المطلوب استكماله',
            'string.empty': 'اكتب ملاحظات توضح للجمعية المطلوب استكماله',
            'string.min': 'الملاحظات قصيرة جدًا',
            'string.max': 'الملاحظات طويلة جدًا',
        }),
});

export const messageSchema = Joi.object({
    body: Joi.string().trim().min(1).max(MAX_MESSAGE_LENGTH).required()
        .messages({
            'string.empty': 'لا يمكن إرسال رسالة فارغة',
            'any.required': 'لا يمكن إرسال رسالة فارغة',
            'string.max': `الرسالة أطول من ${MAX_MESSAGE_LENGTH} حرف`,
        }),
});

export const conversationSchema = Joi.object({
    open: Joi.boolean().required().messages({ 'any.required': 'حالة المحادثة مطلوبة' }),
});

const optionalText = (label, min, max) => Joi.string().trim().min(min).max(max)
    .messages({ 'string.empty': `${label} مطلوب`, 'string.min': `${label} ${min} أحرف على الأقل`, 'string.max': `${label} طويل جدًا` });

// Same rules as registration; every field is optional so the NGO can fix just what was asked.
// ngoName / regNumber are not here: they are fixed, and stripUnknown drops them from the request.
export const profileUpdateSchema = Joi.object({
    fieldOfWork: optionalText('مجال العمل', 1, 200),
    representativeName: optionalText('اسم الممثل', 3, 200),
    position: optionalText('الصفة', 2, 100),
    mobile: Joi.string().trim().pattern(/^05\d{8}$/)
        .messages({ 'string.pattern.base': 'رقم الجوال يجب أن يبدأ بـ 05 ويكون 10 أرقام' }),
});

export const statusFilterSchema = Joi.string().valid(...ACCOUNT_STATUSES);
