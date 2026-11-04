import Joi from 'joi';
import * as media from '../services/media.service.js';
import { EXCEPTION_HARD_MAX_MB, EXCEPTION_TYPES } from '../services/fileSafety.service.js';
import { getUploadExceptions, updateUploadExceptions } from '../services/settings.service.js';
import { handle } from '../utils/handle.js';
import { HttpError } from '../utils/httpError.js';
import { pageFields } from '../utils/pagination.js';

const listSchema = Joi.object({
    search: Joi.string().trim().max(100).allow(''),
    type: Joi.string().valid('pdf', 'image', 'other'),
    usage: Joi.string().max(30),
    status: Joi.string().valid('pending', 'attached', 'orphaned', 'missing', 'deleted'),
    sort: Joi.string().valid('size_desc', 'size_asc', 'date_desc', 'date_asc').default('size_desc'),
    ...pageFields,
});

export const list = handle('media list', 200, 'تم جلب الملفات', (req) => {
    const { value, error } = listSchema.validate(req.query, { convert: true, stripUnknown: true });
    if (error) throw new HttpError(400, 'معايير البحث غير صالحة', 'INVALID_FILTER');
    return media.listMedia({ page: 1, ...value });
});

export const stats = handle('media stats', 200, 'تم جلب إحصائيات الملفات', () => media.mediaStats());

// Re-reads storage + usage on demand (the "refresh" button); the jobs do it on their own too
export const sync = handle('media sync', 200, 'تم تحديث سجل الملفات', async () => {
    await media.syncMediaRegistry({ scanDisk: true });
    return media.mediaStats();
});

// ── Upload exceptions (what may go beyond PDF up to 5 MB) ─────────────────────
const CHOOSABLE_TYPES = Object.keys(EXCEPTION_TYPES).filter((ext) => ext !== 'pdf');
const uploadSettingsSchema = Joi.object({
    enabled: Joi.boolean().required(),
    maxMb: Joi.number().integer().min(5).max(EXCEPTION_HARD_MAX_MB).required()
        .messages({ 'number.min': 'أقل حجم 5 ميجابايت', 'number.max': `أقصى حجم ${EXCEPTION_HARD_MAX_MB} ميجابايت` }),
    types: Joi.array().items(Joi.string().valid(...CHOOSABLE_TYPES)).unique().required(),
});
// The settings plus every type the admin can choose from
const withChoices = (settings) => ({
    ...settings,
    hardMaxMb: EXCEPTION_HARD_MAX_MB,
    choices: CHOOSABLE_TYPES.map((ext) => ({ ext, label: EXCEPTION_TYPES[ext].label })),
});

export const uploadSettings = handle('upload settings', 200, 'تم جلب إعدادات الرفع', async () => withChoices(await getUploadExceptions()));

export const saveUploadSettings = handle('upload settings save', 200, 'تم حفظ إعدادات الرفع', async (req) => {
    const { value, error } = uploadSettingsSchema.validate(req.body, { stripUnknown: true });
    if (error) throw new HttpError(400, error.details[0].message, 'VALIDATION_ERROR');
    return withChoices(await updateUploadExceptions(value, req.user));
});

// Deletes are permanent: the client must say so explicitly, so a stray or replayed call deletes nothing.
const requireConfirm = (req) => {
    if (req.body?.confirm !== true) {
        throw new HttpError(400, 'الحذف نهائي ويحتاج تأكيدًا صريحًا', 'CONFIRMATION_REQUIRED');
    }
};

export const purge = handle('media purge', 200, 'تم حذف الملفات غير المستخدمة', (req) => {
    requireConfirm(req);
    return media.purgeUnused(req.user);
});

// A file still in use is only deleted with { force: true } (the dashboard asks for a typed confirmation first)
export const remove = handle('media delete', 200, 'تم حذف الملف', (req) => {
    requireConfirm(req);
    return media.deleteMedia(req.params.id, req.user, { force: req.body.force === true });
});
