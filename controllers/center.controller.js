import { changedFields, describeChanges, logActivity } from '../services/activityLog.service.js';
import * as catalog from '../services/centerCatalog.service.js';
import { applyAllowedFields } from '../utils/catalogFields.js';
import { handle } from '../utils/handle.js';
import { HttpError } from '../utils/httpError.js';
import { centerFilterSchema } from '../validators/center.validator.js';

// req.isAdmin is set by optionalAuth: admins also see (and can filter) inactive centers.
export const list = handle('centers list', 200, 'تم جلب المراكز', (req) => {
    const { value, error } = centerFilterSchema.validate(req.query, { convert: true, stripUnknown: true });
    if (error) throw new HttpError(400, 'معايير البحث غير صالحة', 'INVALID_FILTER');
    return catalog.listCenters({ ...value, includeHidden: req.isAdmin });
});

export const get = handle('centers get', 200, 'تم جلب المركز',
    (req) => catalog.getCenter(req.params.id, { includeHidden: req.isAdmin }));

// The saved center in the form's shape (what applyAllowedFields falls back to).
const savedInput = (center) => ({
    title: center.title, status: center.status, imageUrl: center.imageUrl, price: center.price,
    responseTime: center.responseTime, executionDuration: center.executionDuration, overview: center.overview,
    shortDescription: center.shortDescription, outputs: center.outputs, methodology: center.methodology,
    targetAudience: center.targetAudience, serviceIds: center.serviceIds,
});

// Field names for the activity log.
const FIELD_LABELS = {
    title: 'الاسم', status: 'الحالة', imageUrl: 'الصورة', price: 'السعر', responseTime: 'وقت الاستجابة',
    executionDuration: 'مدة التنفيذ', overview: 'النظرة العامة', shortDescription: 'الوصف المختصر',
    outputs: 'المخرجات', methodology: 'منهجية العمل', targetAudience: 'الفئة المستهدفة', serviceIds: 'الخدمات',
};

// Creating needs manage:catalog (route); the price still needs manage:pricing.
export const create = handle('centers create', 201, 'تم إنشاء المركز', async (req) => {
    const center = await catalog.createCenter(applyAllowedFields(req.user, req.body, { ...req.body, price: 0 }));
    await logActivity(null, {
        actorId: req.user.id, action: 'center.create', entityType: 'center', entityId: center.id,
        summary: `إضافة المركز «${center.title}» (السعر ${center.price})`, details: { status: center.status, price: center.price },
    });
    return center;
});

export const update = handle('centers update', 200, 'تم تحديث المركز', async (req) => {
    const current = await catalog.getCenter(req.params.id, { includeHidden: true });
    const before = savedInput(current);
    const center = await catalog.updateCenter(req.params.id, applyAllowedFields(req.user, req.body, before));
    const changes = changedFields(before, savedInput(center), FIELD_LABELS)
        .map((label) => (label === FIELD_LABELS.price ? `السعر ${current.price} ← ${center.price}` : label));
    await logActivity(null, {
        actorId: req.user.id, action: 'center.update', entityType: 'center', entityId: center.id,
        summary: `تعديل المركز «${center.title}»: ${describeChanges(changes)}`,
        details: { changes, ...(center.price !== current.price && { price: { from: current.price, to: center.price } }) },
    });
    return center;
});

export const remove = handle('centers delete', 200, 'تم حذف المركز', async (req) => {
    const current = await catalog.getCenter(req.params.id, { includeHidden: true });
    const result = await catalog.deleteCenter(req.params.id);
    await logActivity(null, {
        actorId: req.user.id, action: 'center.delete', entityType: 'center', entityId: current.id,
        summary: `حذف المركز «${current.title}»`,
    });
    return result;
});
