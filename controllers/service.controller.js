import * as catalog from '../services/serviceCatalog.service.js';
import { handle } from '../utils/handle.js';
import { HttpError } from '../utils/httpError.js';
import { serviceFilterSchema } from '../validators/service.validator.js';

// req.isAdmin is set by optionalAuth: admins also see (and can filter) inactive services.
export const list = handle('services list', 200, 'تم جلب الخدمات', (req) => {
    const { value, error } = serviceFilterSchema.validate(req.query, { convert: true, stripUnknown: true });
    if (error) throw new HttpError(400, 'معايير البحث غير صالحة', 'INVALID_FILTER');
    return catalog.listServices({ ...value, includeHidden: req.isAdmin });
});

export const get = handle('services get', 200, 'تم جلب الخدمة',
    (req) => catalog.getService(req.params.id, { includeHidden: req.isAdmin }));

export const create = handle('services create', 201, 'تم إنشاء الخدمة',
    (req) => catalog.createService(req.body));

export const update = handle('services update', 200, 'تم تحديث الخدمة',
    (req) => catalog.updateService(req.params.id, req.body));

export const remove = handle('services delete', 200, 'تم حذف الخدمة',
    (req) => catalog.deleteService(req.params.id));

export const listCenters = handle('centers list', 200, 'تم جلب المراكز',
    () => catalog.listCenters());
