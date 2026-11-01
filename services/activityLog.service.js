import pool from '../db.js';

const PAGE_SIZE = 50;

/**
 * Records a staff action. Pass the transaction's client so the entry commits (or rolls back)
 * with the change it describes.
 */
export const logActivity = (client, { actorId, action, entityType, entityId = null, summary, details = {} }) =>
    (client || pool).query(
        `INSERT INTO activity_log (actor_user_id, action, entity_type, entity_id, summary, details)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [actorId, action, entityType, entityId == null ? null : String(entityId), summary, JSON.stringify(details)]
    );

/**
 * Arabic names of the fields that differ between `before` and `after` (both in the form's shape),
 * for summaries like "تعديل الخدمة «…»: العنوان، السعر".
 */
export const changedFields = (before, after, labels) => Object.keys(labels)
    .filter((field) => JSON.stringify(before[field] ?? null) !== JSON.stringify(after[field] ?? null))
    .map((field) => labels[field]);

export const describeChanges = (changes) => (changes.length ? changes.join('، ') : 'بدون تغيير في البيانات');

/** Newest first, PAGE_SIZE at a time; `before` is the last id of the previous page. */
export const listActivity = async ({ entityType, actorId, before, from, to, limit = PAGE_SIZE, offset } = {}) => {
    const where = [];
    const params = [];
    const add = (sql, value) => {
        params.push(value);
        where.push(sql.replaceAll('?', `$${params.length}`));
    };
    if (entityType) add('a.entity_type = ?', entityType);
    if (actorId) add('a.actor_user_id = ?', actorId);
    if (before) add('a.id < ?', before);
    if (from) add('a.created_at >= ?', from);
    if (to) add('a.created_at < ?', to);
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    // Numbered pages also need the total (same filters)
    const total = offset === undefined ? undefined
        : Number((await pool.query(`SELECT COUNT(*) AS count FROM activity_log a ${whereSql}`, params)).rows[0].count);
    // limit 0 = every matching row
    const unlimited = limit === 0;
    if (!unlimited) params.push(limit + 1);
    if (offset !== undefined) params.push(offset);
    const limitSql = unlimited ? '' : `LIMIT $${offset === undefined ? params.length : params.length - 1}`;
    const offsetSql = offset === undefined ? '' : ` OFFSET $${params.length}`;
    const { rows } = await pool.query(
        `SELECT a.*, u.name AS actor_name, u.email AS actor_email, r.label AS actor_role
         FROM activity_log a
         LEFT JOIN users u ON u.id = a.actor_user_id
         LEFT JOIN roles r ON r.id = u.role_id
         ${whereSql}
         ORDER BY a.id DESC
         ${limitSql}${offsetSql}`,
        params
    );
    return {
        items: (unlimited ? rows : rows.slice(0, limit)).map((row) => ({
            id: row.id,
            action: row.action,
            entityType: row.entity_type,
            entityId: row.entity_id,
            summary: row.summary,
            details: row.details,
            // Current name / role of whoever did it (null = system, or the account was deleted).
            actor: row.actor_user_id
                ? { id: row.actor_user_id, name: row.actor_name, email: row.actor_email, roleLabel: row.actor_role }
                : null,
            createdAt: row.created_at,
        })),
        hasMore: !unlimited && rows.length > limit,
        ...(total !== undefined && { total }),
    };
};
