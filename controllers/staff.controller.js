import * as staff from '../services/staff.service.js';
import { handle } from '../utils/handle.js';
import { HttpError } from '../utils/httpError.js';
import { staffFilterSchema } from '../validators/staff.validator.js';

export const list = handle('staff list', 200, 'تم جلب فريق العمل', (req) => {
    const { value, error } = staffFilterSchema.validate(req.query, { convert: true, stripUnknown: true });
    if (error) throw new HttpError(400, 'معايير البحث غير صالحة', 'INVALID_FILTER');
    return staff.listStaff(value);
});

export const get = handle('staff get', 200, 'تم جلب الموظف', (req) => staff.getStaff(req.params.id));

export const create = handle('staff create', 201, 'تم إضافة الموظف',
    (req) => staff.createStaff(req.user, req.body));

export const update = handle('staff update', 200, 'تم حفظ بيانات الموظف',
    (req) => staff.updateStaff(req.user, req.params.id, req.body));

export const remove = handle('staff deactivate', 200, 'تم إيقاف حساب الموظف',
    (req) => staff.deactivateStaff(req.user, req.params.id));
