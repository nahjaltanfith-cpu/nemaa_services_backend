import { logActivity } from '../services/activityLog.service.js';
import * as categories from '../services/category.service.js';
import { handle } from '../utils/handle.js';

const log = (req, action, id, summary) => logActivity(null, {
    actorId: req.user.id, action, entityType: 'category', entityId: id, summary,
});

export const list = handle('categories list', 200, 'تم جلب التصنيفات',
    () => categories.listCategories());

export const create = handle('categories create', 201, 'تم إنشاء التصنيف', async (req) => {
    const category = await categories.createCategory(req.body);
    await log(req, 'category.create', category.id, `إضافة التصنيف «${category.name}»`);
    return category;
});

export const update = handle('categories update', 200, 'تم تحديث التصنيف', async (req) => {
    const category = await categories.updateCategory(req.params.id, req.body);
    await log(req, 'category.update', category.id, `تعديل التصنيف «${category.name}»`);
    return category;
});

export const remove = handle('categories delete', 200, 'تم حذف التصنيف', async (req) => {
    const current = (await categories.listCategories()).find((item) => item.id === req.params.id);
    const result = await categories.deleteCategory(req.params.id);
    await log(req, 'category.delete', req.params.id, `حذف التصنيف «${current?.name ?? `#${req.params.id}`}»`);
    return result;
});
