import Joi from 'joi';

export const SERVICE_STATUSES = ['active', 'inactive', 'coming_soon'];
const MAX_LIST_ITEMS = 50;

// A list of text items. Blank rows (an empty "+ add item" input) are dropped, not rejected.
const textList = (label) => Joi.array()
    .items(Joi.string().trim().allow('').max(500).messages({ 'string.max': `عنصر في ${label} أطول من 500 حرف` }))
    .max(MAX_LIST_ITEMS)
    .default([])
    .custom((items) => items.filter(Boolean))
    .messages({ 'array.base': `${label} يجب أن تكون قائمة`, 'array.max': `${label}: الحد الأقصى ${MAX_LIST_ITEMS} عنصرًا` });

// Methodology steps: { title, description }. A plain string is accepted as a title-only step.
const step = Joi.alternatives().try(
    Joi.string().trim().allow('').max(200).custom((title) => ({ title, description: '' })),
    Joi.object({
        title: Joi.string().trim().allow('').max(200).required(),
        description: Joi.string().trim().allow('').max(1000).default(''),
    }),
).messages({ 'alternatives.match': 'خطوة غير صالحة في منهجية العمل' });

const methodology = Joi.array().items(step).max(MAX_LIST_ITEMS).default([])
    .custom((steps) => steps.filter((item) => item.title))
    .messages({ 'array.base': 'منهجية العمل يجب أن تكون قائمة', 'array.max': `منهجية العمل: الحد الأقصى ${MAX_LIST_ITEMS} خطوة` });

const optionalText = (max) => Joi.string().trim().max(max).allow('', null).default(null)
    .custom((value) => value || null);

// Create and update share the schema: the admin form always sends the full service.
export const serviceSchema = Joi.object({
    title: Joi.string().trim().min(2).max(255).required()
        .messages({ 'string.empty': 'عنوان الخدمة مطلوب', 'any.required': 'عنوان الخدمة مطلوب', 'string.min': 'عنوان الخدمة حرفين على الأقل' }),
    status: Joi.string().valid(...SERVICE_STATUSES).default('active')
        .messages({ 'any.only': 'حالة الخدمة غير صالحة' }),
    imageUrl: optionalText(512),
    price: Joi.number().min(0).max(9999999999.99).precision(2).default(0)
        .messages({ 'number.base': 'السعر يجب أن يكون رقمًا', 'number.min': 'السعر لا يمكن أن يكون سالبًا' }),
    responseTime: optionalText(100),
    duration: optionalText(100),
    categoryId: Joi.number().integer().positive().allow(null).default(null)
        .messages({ 'number.base': 'التصنيف غير صالح' }),
    fullDescription: Joi.string().trim().min(10).max(20000).required()
        .messages({ 'string.empty': 'الوصف الكامل مطلوب', 'any.required': 'الوصف الكامل مطلوب', 'string.min': 'الوصف الكامل قصير جدًا' }),
    // Empty → generated from fullDescription by the service layer.
    shortDescription: optionalText(500),
    outputs: textList('المخرجات'),
    workMethodology: methodology,
    targetAudience: textList('الفئة المستهدفة'),
    includes: textList('ما تشمله الخدمة'),
    centerIds: Joi.array().items(Joi.string().trim().pattern(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(100))
        .unique().max(MAX_LIST_ITEMS).default([])
        .messages({ 'array.unique': 'تم اختيار نفس المركز أكثر من مرة', 'string.pattern.base': 'معرّف مركز غير صالح' }),
});

export const serviceFilterSchema = Joi.object({
    status: Joi.string().valid(...SERVICE_STATUSES),
    categoryId: Joi.number().integer().positive(),
    search: Joi.string().trim().max(100).allow(''),
});
