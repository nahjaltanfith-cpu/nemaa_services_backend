import Joi from 'joi';

export const SERVICE_STATUSES = ['active', 'inactive', 'coming_soon'];
export const MAX_LIST_ITEMS = 50;
// Center ids are slugs (see enablement_centers.id).
export const CENTER_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SERVICE_CODE_PATTERN = /^[A-Z]{2,10}-[0-9]{1,4}$/;

// A list of text items. Blank rows (an empty "+ add item" input) are dropped, not rejected.
export const textList = (label) => Joi.array()
    .items(Joi.string().trim().allow('').max(500).messages({ 'string.max': `عنصر في ${label} أطول من 500 حرف` }))
    .max(MAX_LIST_ITEMS)
    .default([])
    .custom((items) => items.filter(Boolean))
    .messages({ 'array.base': `${label} يجب أن تكون قائمة`, 'array.max': `${label}: الحد الأقصى ${MAX_LIST_ITEMS} عنصرًا` });

// A list of { title, description } items (methodology steps, a center's own services). A plain string
// is accepted as a title-only item; rows without a title are dropped.
export const titledList = (label, unit) => Joi.array().items(Joi.alternatives().try(
    Joi.string().trim().allow('').max(200).custom((title) => ({ title, description: '' })),
    Joi.object({
        title: Joi.string().trim().allow('').max(200).required(),
        description: Joi.string().trim().allow('').max(1000).default(''),
    }),
).messages({ 'alternatives.match': `${unit} غير صالحة في ${label}` }))
    .max(MAX_LIST_ITEMS).default([])
    .custom((items) => items.filter((item) => item.title))
    .messages({ 'array.base': `${label} يجب أن تكون قائمة`, 'array.max': `${label}: الحد الأقصى ${MAX_LIST_ITEMS} ${unit}` });

export const methodology = titledList('منهجية العمل', 'خطوة');

// Request attachments: { name, required }. required = the request can't be submitted without it.
// A plain string is accepted as a required document. Rows without a name are dropped.
const attachment = Joi.alternatives().try(
    Joi.string().trim().allow('').max(500).custom((name) => ({ name, required: true })),
    Joi.object({
        name: Joi.string().trim().allow('').max(500).required(),
        required: Joi.boolean().default(true),
    }),
).messages({ 'alternatives.match': 'مرفق غير صالح في المرفقات المطلوبة' });

const attachmentList = Joi.array().items(attachment).max(MAX_LIST_ITEMS).default([])
    .custom((items) => items.filter((item) => item.name))
    .messages({ 'array.base': 'المرفقات المطلوبة يجب أن تكون قائمة', 'array.max': `المرفقات المطلوبة: الحد الأقصى ${MAX_LIST_ITEMS} مرفقًا` });

// empty(''): a blank field ('' or spaces) becomes null. allow('') + custom() can't do it: Joi skips custom()
// for allowed values, so '' reached the database.
export const optionalText = (max) => Joi.string().trim().max(max).empty('').allow(null).default(null);

// Create and update share the schema: the admin form always sends the full service.
export const serviceSchema = Joi.object({
    title: Joi.string().trim().min(2).max(255).required()
        .messages({ 'string.empty': 'عنوان الخدمة مطلوب', 'any.required': 'عنوان الخدمة مطلوب', 'string.min': 'عنوان الخدمة حرفين على الأقل' }),
    // "GOV-01": letters, a dash, a number (same rule as services_code_format).
    // A blank code → null (services_code_format rejects '').
    code: Joi.string().trim().uppercase().pattern(SERVICE_CODE_PATTERN).empty('').allow(null).default(null)
        .messages({ 'string.pattern.base': 'كود الخدمة يكون حروفًا إنجليزية ثم شرطة ثم رقم، مثل GOV-01' }),
    status: Joi.string().valid(...SERVICE_STATUSES).default('active')
        .messages({ 'any.only': 'حالة الخدمة غير صالحة' }),
    imageUrl: optionalText(512),
    // null = no fixed price, shown as "يحدد بعد الاجتماع".
    price: Joi.number().min(0).max(9999999999.99).precision(2).allow(null).default(0)
        .messages({ 'number.base': 'السعر يجب أن يكون رقمًا', 'number.min': 'السعر لا يمكن أن يكون سالبًا' }),
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
    // Documents the NGO attaches when requesting (names only, no files here).
    requiredAttachments: attachmentList,
});

export const serviceStatusSchema = Joi.object({
    status: Joi.string().valid(...SERVICE_STATUSES).required()
        .messages({ 'any.only': 'حالة غير صالحة', 'any.required': 'الحالة مطلوبة' }),
});

export const serviceFilterSchema = Joi.object({
    status: Joi.string().valid(...SERVICE_STATUSES),
    categoryId: Joi.number().integer().positive(),
    search: Joi.string().trim().max(100).allow(''),
});
