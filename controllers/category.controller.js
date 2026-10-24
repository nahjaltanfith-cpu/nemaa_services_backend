import * as categories from '../services/category.service.js';
import { handle } from '../utils/handle.js';

export const list = handle('categories list', 200, 'تم جلب التصنيفات',
    () => categories.listCategories());

export const create = handle('categories create', 201, 'تم إنشاء التصنيف',
    (req) => categories.createCategory(req.body));

export const update = handle('categories update', 200, 'تم تحديث التصنيف',
    (req) => categories.updateCategory(req.params.id, req.body));

export const remove = handle('categories delete', 200, 'تم حذف التصنيف',
    (req) => categories.deleteCategory(req.params.id));
