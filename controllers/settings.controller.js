import Joi from 'joi';
import { LIMIT_PERIODS, getRequestLimits, updateRequestLimits } from '../services/settings.service.js';
import { handle } from '../utils/handle.js';
import { HttpError } from '../utils/httpError.js';

// YYYY-MM-DD that is a real calendar day (2026-02-31 is refused).
const calendarDay = (missing) => Joi.string().custom((value, helpers) => {
    const date = new Date(`${value}T00:00:00Z`);
    const valid = /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
    return valid ? value : helpers.message('التاريخ غير صالح');
}).required().messages({ 'any.required': missing, 'string.empty': missing, 'string.base': missing });
// Only a custom period has dates; any other period drops whatever was sent.
const periodDay = (missing) => Joi.any().when('period', { is: 'custom', then: calendarDay(missing), otherwise: Joi.any().strip() });
const limit = (label) => Joi.number().integer().min(1).max(100000).empty('').allow(null).default(null)
    .messages({ 'number.base': `${label} يجب أن يكون رقمًا`, 'number.integer': `${label} يجب أن يكون رقمًا صحيحًا`, 'number.min': `${label} لا يقل عن 1`, 'number.max': `${label} لا يزيد عن 100000` });

const requestLimitsSchema = Joi.object({
    maxFreeServices: limit('حد الخدمات المجانية'),
    maxTotalServices: limit('الحد الإجمالي للخدمات'),
    period: Joi.string().valid(...LIMIT_PERIODS).required().messages({ 'any.only': 'الفترة غير صالحة', 'any.required': 'الفترة مطلوبة' }),
    periodFrom: periodDay('حدد تاريخ بداية الفترة'),
    periodTo: periodDay('حدد تاريخ نهاية الفترة'),
});

export const requestLimits = handle('request limits', 200, 'تم جلب حدود الطلبات', () => getRequestLimits());

export const saveRequestLimits = handle('request limits save', 200, 'تم حفظ حدود الطلبات', (req) => {
    const { value, error } = requestLimitsSchema.validate(req.body, { stripUnknown: true });
    if (error) throw new HttpError(400, error.details[0].message, 'VALIDATION_ERROR');
    if (value.maxFreeServices !== null && value.maxTotalServices !== null && value.maxFreeServices > value.maxTotalServices) {
        throw new HttpError(400, 'حد الخدمات المجانية لا يتجاوز الحد الإجمالي', 'VALIDATION_ERROR');
    }
    if (value.period === 'custom' && value.periodFrom > value.periodTo) {
        throw new HttpError(400, 'تاريخ البداية يجب أن يسبق تاريخ النهاية', 'VALIDATION_ERROR');
    }
    return updateRequestLimits(value, req.user);
});
