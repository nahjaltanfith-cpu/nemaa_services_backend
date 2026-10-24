import Joi from 'joi';

// Used for both create and update: the edit form always sends the full category.
export const categorySchema = Joi.object({
    name: Joi.string().trim().min(2).max(100).required()
        .messages({
            'string.empty': 'اسم التصنيف مطلوب',
            'any.required': 'اسم التصنيف مطلوب',
            'string.min': 'اسم التصنيف حرفين على الأقل',
            'string.max': 'اسم التصنيف أطول من 100 حرف',
        }),
    description: Joi.string().trim().max(1000).allow('', null).default(null)
        .messages({ 'string.max': 'الوصف أطول من 1000 حرف' }),
});
