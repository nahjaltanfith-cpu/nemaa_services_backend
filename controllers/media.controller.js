import Joi from 'joi';
import * as media from '../services/media.service.js';
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

export const purge = handle('media purge', 200, 'تم حذف الملفات غير المستخدمة', (req) => media.purgeUnused(req.user));

export const remove = handle('media delete', 200, 'تم حذف الملف', (req) => media.deleteMedia(req.params.id, req.user));
