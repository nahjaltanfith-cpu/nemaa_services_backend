import Joi from 'joi';
import { CONTACT_STATUSES, CONTACT_TYPES } from '../services/contact.service.js';

export const MESSAGE_MIN = 20;
export const MESSAGE_MAX = 2000;

// The public form (POST /api/contact).
export const contactRequestSchema = Joi.object({
    type: Joi.string().valid(...Object.keys(CONTACT_TYPES)).default('general')
        .messages({ 'any.only': 'نوع الاستفسار غير صالح' }),
    fullName: Joi.string().trim().min(2).max(255).required()
        .messages({
            'string.empty': 'الاسم الكامل مطلوب',
            'any.required': 'الاسم الكامل مطلوب',
            'string.min': 'اكتب اسمك الكامل',
            'string.max': 'الاسم طويل جدًا',
        }),
    organizationName: Joi.string().trim().max(255).allow('', null).default(null)
        .messages({ 'string.max': 'اسم الجهة طويل جدًا' }),
    email: Joi.string().trim().lowercase().max(255).email({ tlds: { allow: false } }).required()
        .messages({
            'string.empty': 'البريد الإلكتروني مطلوب',
            'any.required': 'البريد الإلكتروني مطلوب',
            'string.email': 'اكتب بريدًا إلكترونيًا صحيحًا',
            'string.max': 'البريد الإلكتروني طويل جدًا',
        }),
    // Digits with an optional leading +; the site strips spaces and dashes before sending.
    phone: Joi.string().trim().pattern(/^\+?\d{7,15}$/).allow('', null).default(null)
        .messages({ 'string.pattern.base': 'اكتب رقم جوال صحيحًا' }),
    message: Joi.string().trim().min(MESSAGE_MIN).max(MESSAGE_MAX).required()
        .messages({
            'string.empty': 'نص الرسالة مطلوب',
            'any.required': 'نص الرسالة مطلوب',
            'string.min': `اكتب رسالتك بتفصيل أكثر (${MESSAGE_MIN} حرفًا على الأقل)`,
            'string.max': `الرسالة أطول من ${MESSAGE_MAX} حرف`,
        }),
    // Honeypot: hidden on the site, so only bots fill it in.
    website: Joi.string().allow('').max(500),
});

export const contactStatusSchema = Joi.object({
    status: Joi.string().valid(...CONTACT_STATUSES).required()
        .messages({ 'any.only': 'حالة غير صالحة', 'any.required': 'الحالة مطلوبة' }),
});
