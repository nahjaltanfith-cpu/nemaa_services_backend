import pool from '../db.js';
import { HttpError } from '../utils/httpError.js';

const toCategory = (row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
});

const COLUMNS = 'id, name, description, created_at, updated_at';

const notFound = () => new HttpError(404, 'التصنيف غير موجود', 'NOT_FOUND');

// Unique name (categories_name_unique) → 409. services.category_id is ON DELETE SET NULL, so
// deleting never fails today; the 23503 branch covers any future table that RESTRICTs.
const mapDbError = (error) => {
    if (error.code === '23505') return new HttpError(409, 'يوجد تصنيف بنفس الاسم', 'CATEGORY_NAME_TAKEN');
    if (error.code === '23503') {
        return new HttpError(409, 'لا يمكن حذف تصنيف مرتبط بخدمات، انقل الخدمات لتصنيف آخر أولًا', 'CATEGORY_IN_USE');
    }
    return error;
};

export const listCategories = async () => {
    const { rows } = await pool.query(`SELECT ${COLUMNS} FROM categories ORDER BY lower(name), id`);
    return rows.map(toCategory);
};

export const createCategory = async ({ name, description }) => {
    try {
        const { rows } = await pool.query(
            `INSERT INTO categories (name, description) VALUES ($1, $2) RETURNING ${COLUMNS}`,
            [name, description || null]
        );
        return toCategory(rows[0]);
    } catch (error) {
        throw mapDbError(error);
    }
};

export const updateCategory = async (id, { name, description }) => {
    try {
        const { rows } = await pool.query(
            `UPDATE categories SET name = $2, description = $3, updated_at = NOW()
             WHERE id = $1 RETURNING ${COLUMNS}`,
            [id, name, description || null]
        );
        if (!rows.length) throw notFound();
        return toCategory(rows[0]);
    } catch (error) {
        throw mapDbError(error);
    }
};

export const deleteCategory = async (id) => {
    try {
        const { rowCount } = await pool.query('DELETE FROM categories WHERE id = $1', [id]);
        if (!rowCount) throw notFound();
        return { id };
    } catch (error) {
        throw mapDbError(error);
    }
};
