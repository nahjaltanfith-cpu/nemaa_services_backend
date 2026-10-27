import { changedFields, describeChanges, logActivity } from '../services/activityLog.service.js';
import * as catalog from '../services/serviceCatalog.service.js';
import { applyAllowedFields } from '../utils/catalogFields.js';
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

// The saved service in the form's shape (what applyAllowedFields falls back to).
const savedInput = (service) => ({
    code: service.code, title: service.title, status: service.status, imageUrl: service.imageUrl, price: service.price,
    duration: service.duration, categoryId: service.categoryId,
    fullDescription: service.fullDescription, shortDescription: service.shortDescription,
    outputs: service.outputs, workMethodology: service.workMethodology, targetAudience: service.targetAudience,
    includes: service.includes, requiredAttachments: service.requiredAttachments,
});

// Field names for the activity log.
const FIELD_LABELS = {
    code: 'كود الخدمة', title: 'العنوان', status: 'الحالة', imageUrl: 'الصورة', price: 'السعر',
    duration: 'مدة التنفيذ', categoryId: 'التصنيف', fullDescription: 'الوصف الكامل', shortDescription: 'الوصف المختصر',
    outputs: 'المخرجات', workMethodology: 'منهجية العمل', targetAudience: 'الفئة المستهدفة', includes: 'ما تشمله الخدمة (النطاق)',
    requiredAttachments: 'المرفقات المطلوبة',
};

// Creating needs manage:catalog (route); the price and form requirements still need their own rights.
export const create = handle('services create', 201, 'تم إنشاء الخدمة', async (req) => {
    const service = await catalog.createService(applyAllowedFields(req.user, req.body, { ...req.body, price: 0, requiredAttachments: [] }));
    await logActivity(null, {
        actorId: req.user.id, action: 'service.create', entityType: 'service', entityId: service.id,
        summary: `إضافة الخدمة «${service.title}» (السعر ${service.price})`, details: { status: service.status, price: service.price },
    });
    return service;
});

export const update = handle('services update', 200, 'تم تحديث الخدمة', async (req) => {
    const current = await catalog.getService(req.params.id, { includeHidden: true });
    const before = savedInput(current);
    const service = await catalog.updateService(req.params.id, applyAllowedFields(req.user, req.body, before));
    const changes = changedFields(before, savedInput(service), FIELD_LABELS)
        .map((label) => (label === FIELD_LABELS.price ? `السعر ${current.price ?? 'يحدد بعد الاجتماع'} ← ${service.price ?? 'يحدد بعد الاجتماع'}` : label));
    await logActivity(null, {
        actorId: req.user.id, action: 'service.update', entityType: 'service', entityId: service.id,
        summary: `تعديل الخدمة «${service.title}»: ${describeChanges(changes)}`,
        details: { changes, ...(service.price !== current.price && { price: { from: current.price, to: service.price } }) },
    });
    return service;
});

export const remove = handle('services delete', 200, 'تم حذف الخدمة', async (req) => {
    const current = await catalog.getService(req.params.id, { includeHidden: true });
    const result = await catalog.deleteService(req.params.id);
    await logActivity(null, {
        actorId: req.user.id, action: 'service.delete', entityType: 'service', entityId: current.id,
        summary: `حذف الخدمة «${current.title}»`,
    });
    return result;
});
