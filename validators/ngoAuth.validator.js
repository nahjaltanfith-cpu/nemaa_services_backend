import Joi from 'joi';

// bcrypt silently ignores bytes after 72, so longer passwords are rejected outright.
const password = Joi.string().min(8).required()
    .custom((value, helpers) => (
        Buffer.byteLength(value, 'utf8') > 72 ? helpers.error('password.bytes') : value
    ))
    .messages({
        'string.empty': 'كلمة المرور مطلوبة',
        'any.required': 'كلمة المرور مطلوبة',
        'string.min': 'كلمة المرور 8 أحرف على الأقل',
        'password.bytes': 'كلمة المرور طويلة جدًا',
    });

const email = Joi.string().trim().lowercase().email().max(255).required()
    .messages({
        'string.empty': 'البريد الإلكتروني مطلوب',
        'any.required': 'البريد الإلكتروني مطلوب',
        'string.email': 'صيغة البريد الإلكتروني غير صحيحة',
        'string.max': 'البريد الإلكتروني طويل جدًا',
    });

const otpCode = Joi.string().trim().pattern(/^\d{6}$/).required()
    .messages({
        'string.empty': 'رمز التحقق مطلوب',
        'any.required': 'رمز التحقق مطلوب',
        'string.pattern.base': 'رمز التحقق يجب أن يكون 6 أرقام',
    });

const text = (label, min, max) => Joi.string().trim().min(min).max(max).required()
    .messages({
        'string.empty': `${label} مطلوب`,
        'any.required': `${label} مطلوب`,
        'string.min': `${label} ${min} أحرف على الأقل`,
        'string.max': `${label} طويل جدًا`,
    });

// Storage keys returned by POST /api/upload. Optional: a failed upload must not block
// registration, and keys that do not point to a real upload are dropped by the service.
const documentKey = Joi.string().trim().max(255).allow(null, '').default(null);

// Matches the payload built by RegisterNgoView.vue.
export const registerSchema = Joi.object({
    documents: Joi.object({
        ngoDocument: documentKey,
        representativeProof: documentKey,
    }).default({}),
    ngo: Joi.object({
        ngoName: text('اسم الجمعية', 3, 200),
        regNumber: Joi.string().trim().pattern(/^\d{4,10}$/).required()
            .messages({
                'string.empty': 'رقم التسجيل الرسمي مطلوب',
                'any.required': 'رقم التسجيل الرسمي مطلوب',
                'string.pattern.base': 'رقم التسجيل من 4 إلى 10 أرقام',
            }),
        fieldOfWork: text('مجال العمل', 1, 200),
    }).required().messages({ 'any.required': 'بيانات الجمعية مطلوبة' }),
    representative: Joi.object({
        representativeName: text('اسم الممثل', 3, 200),
        position: text('الصفة', 2, 100)
            .messages({ 'string.empty': 'الصفة مطلوبة', 'any.required': 'الصفة مطلوبة' }),
        email,
        mobile: Joi.string().trim().pattern(/^05\d{8}$/).required()
            .messages({
                'string.empty': 'رقم الجوال مطلوب',
                'any.required': 'رقم الجوال مطلوب',
                'string.pattern.base': 'رقم الجوال يجب أن يبدأ بـ 05 ويكون 10 أرقام',
            }),
        password,
    }).required().messages({ 'any.required': 'بيانات الممثل مطلوبة' }),
});

export const loginSchema = Joi.object({
    email,
    password: Joi.string().required().max(200)
        .messages({ 'string.empty': 'كلمة المرور مطلوبة', 'any.required': 'كلمة المرور مطلوبة' }),
});

export const emailOnlySchema = Joi.object({ email });

export const attachDocumentSchema = Joi.object({
    key: Joi.string().trim().max(255).required()
        .messages({ 'string.empty': 'مفتاح الملف مطلوب', 'any.required': 'مفتاح الملف مطلوب' }),
});

export const otpSchema = Joi.object({ email, otp_code: otpCode });

export const resetPasswordSchema = Joi.object({ email, otp_code: otpCode, new_password: password });
