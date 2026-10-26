import Joi from 'joi';

// bcrypt only reads the first 72 bytes; longer passwords would be silently truncated.
const password = Joi.string().min(8).max(200)
    .custom((value, helpers) => (Buffer.byteLength(value, 'utf8') > 72 ? helpers.error('password.bytes') : value))
    .messages({
        'string.min': 'كلمة المرور 8 أحرف على الأقل',
        'string.empty': 'كلمة المرور مطلوبة',
        'any.required': 'كلمة المرور مطلوبة',
        'password.bytes': 'كلمة المرور أطول من المسموح',
    });

const fields = {
    name: Joi.string().trim().min(2).max(200)
        .messages({ 'string.empty': 'اسم الموظف مطلوب', 'any.required': 'اسم الموظف مطلوب', 'string.min': 'اسم الموظف حرفين على الأقل' }),
    // Any domain (staff may use an internal one, e.g. name@nemaa.local).
    email: Joi.string().trim().lowercase().email({ tlds: { allow: false } }).max(255)
        .messages({ 'string.email': 'البريد الإلكتروني غير صالح', 'string.empty': 'البريد الإلكتروني مطلوب', 'any.required': 'البريد الإلكتروني مطلوب' }),
    roleId: Joi.number().integer().positive()
        .messages({ 'number.base': 'اختر الدور', 'any.required': 'اختر الدور' }),
};

export const createStaffSchema = Joi.object({
    name: fields.name.required(),
    email: fields.email.required(),
    password: password.required(),
    roleId: fields.roleId.required(),
});

// Everything optional: the edit form sends what changed; an empty password keeps the current one.
export const updateStaffSchema = Joi.object({
    name: fields.name,
    email: fields.email,
    roleId: fields.roleId,
    isActive: Joi.boolean(),
    password: password.allow('', null).custom((value) => value || undefined),
}).min(1).messages({ 'object.min': 'لا توجد تعديلات للحفظ' });

export const staffFilterSchema = Joi.object({
    status: Joi.string().valid('active', 'inactive'),
    roleId: Joi.number().integer().positive(),
    search: Joi.string().trim().max(100).allow(''),
});
