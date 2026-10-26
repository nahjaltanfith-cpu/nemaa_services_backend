import { listActivity } from '../services/activityLog.service.js';
import * as roles from '../services/roles.service.js';
import { handle } from '../utils/handle.js';
import { HttpError } from '../utils/httpError.js';
import { activityFilterSchema } from '../validators/role.validator.js';

export const list = handle('roles list', 200, 'تم جلب الأدوار', () => roles.listRoles());

export const options = handle('roles options', 200, 'تم جلب خيارات الأدوار', () => roles.roleOptions());

export const get = handle('roles get', 200, 'تم جلب الدور', (req) => roles.getRole(req.params.id));

export const create = handle('roles create', 201, 'تم إنشاء المسمى الوظيفي',
    (req) => roles.createRole(req.user, req.body));

export const update = handle('roles update', 200, 'تم حفظ المسمى والصلاحيات',
    (req) => roles.updateRole(req.user, req.params.id, req.body));

export const remove = handle('roles delete', 200, 'تم حذف المسمى الوظيفي',
    (req) => roles.deleteRole(req.user, req.params.id));

export const activity = handle('activity list', 200, 'تم جلب سجل النشاط', (req) => {
    const { value, error } = activityFilterSchema.validate(req.query, { convert: true, stripUnknown: true });
    if (error) throw new HttpError(400, 'معايير البحث غير صالحة', 'INVALID_FILTER');
    return listActivity(value);
});
