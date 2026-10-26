import pool from '../db.js';
import { HttpError } from '../utils/httpError.js';
import { logActivity } from './activityLog.service.js';

// Staff roles with permissions, scope and member counts. 'user' (public sign-ups) is not a staff role.
const SELECT = `
    SELECT r.id, r.name, r.label, r.description, r.is_super_admin, r.is_system, r.scope_type, r.assigned_only,
        (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id AND u.is_active) AS active_members,
        (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id) AS members,
        COALESCE((SELECT json_agg(json_build_object('key', p.key, 'label', p.label, 'group', p.group_key)
                                  ORDER BY p.group_key, p.sort_order)
                  FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
                  WHERE rp.role_id = r.id), '[]') AS permissions,
        COALESCE((SELECT json_agg(json_build_object('id', s.id, 'title', s.title) ORDER BY s.title)
                  FROM role_services rs JOIN services s ON s.id = rs.service_id
                  WHERE rs.role_id = r.id), '[]') AS services,
        COALESCE((SELECT json_agg(json_build_object('id', c.id, 'title', c.title) ORDER BY c.title)
                  FROM role_centers rc JOIN enablement_centers c ON c.id = rc.center_id
                  WHERE rc.role_id = r.id), '[]') AS centers
    FROM roles r
    WHERE r.is_staff`;

const toRole = (row) => ({
    id: row.id,
    name: row.name,
    label: row.label,
    description: row.description,
    isSuperAdmin: row.is_super_admin,
    isSystem: row.is_system,
    activeMembers: row.active_members,
    members: row.members,
    permissions: row.permissions,
    scope: {
        type: row.scope_type,
        assignedOnly: row.assigned_only,
        services: row.services,
        centers: row.centers,
    },
});

const notFound = () => new HttpError(404, 'الدور غير موجود', 'NOT_FOUND');
const forbidden = (message) => new HttpError(403, message, 'FORBIDDEN');

export const listRoles = async () => {
    const { rows } = await pool.query(`${SELECT} ORDER BY r.is_super_admin DESC, r.is_system DESC, r.label`);
    return rows.map(toRole);
};

export const getRole = async (id, client = pool) => {
    const { rows } = await client.query(`${SELECT} AND r.id = $1`, [id]);
    if (!rows.length) throw notFound();
    return toRole(rows[0]);
};

/** What the role editor offers: the permission catalog by group, and the services / centers to scope to. */
export const roleOptions = async () => {
    const [{ rows: permissions }, { rows: services }, { rows: centers }] = await Promise.all([
        pool.query('SELECT key, label, description, group_key FROM permissions ORDER BY group_key, sort_order, key'),
        pool.query('SELECT id, title, status FROM services ORDER BY title'),
        pool.query('SELECT id, title, status FROM enablement_centers ORDER BY title'),
    ]);
    return {
        permissions: permissions.map((row) => ({
            key: row.key, label: row.label, description: row.description, group: row.group_key,
        })),
        services,
        centers,
    };
};

/**
 * Who may grant what. Super admins: anything. Other role managers can't touch super-admin roles or
 * the role they hold themselves, and can only grant permissions they have.
 */
const assertMayEdit = (actor, role) => {
    if (actor.isSuperAdmin) return;
    if (role?.isSuperAdmin) throw forbidden('أدوار الصلاحيات الكاملة يعدّلها مدير النظام فقط');
    if (role && role.id === actor.roleId) throw forbidden('لا يمكنك تعديل الدور المسند إليك');
};

const assertMayGrant = (actor, keys, current = []) => {
    if (actor.isSuperAdmin) return;
    const added = keys.filter((key) => !current.includes(key));
    const missing = added.filter((key) => !actor.permissions.includes(key));
    if (missing.length) throw forbidden('لا يمكنك منح صلاحيات لا تملكها');
};

// Inside a transaction: the role's permission and scope rows become exactly `data`'s.
const writeMatrix = async (client, roleId, data) => {
    const { rows: known } = await client.query('SELECT id, key FROM permissions WHERE key = ANY($1::varchar[])', [data.permissions]);
    if (known.length !== data.permissions.length) throw new HttpError(400, 'صلاحية غير معروفة', 'UNKNOWN_PERMISSION');
    await client.query('DELETE FROM role_permissions WHERE role_id = $1', [roleId]);
    await client.query(
        'INSERT INTO role_permissions (role_id, permission_id) SELECT $1, unnest($2::int[])',
        [roleId, known.map((row) => row.id)]
    );
    await client.query('UPDATE roles SET scope_type = $2, assigned_only = $3, updated_at = NOW() WHERE id = $1',
        [roleId, data.scopeType, data.assignedOnly]);
    await client.query('DELETE FROM role_services WHERE role_id = $1', [roleId]);
    await client.query('DELETE FROM role_centers WHERE role_id = $1', [roleId]);
    if (data.scopeType === 'specific_services') {
        await client.query('INSERT INTO role_services (role_id, service_id) SELECT $1, unnest($2::int[])', [roleId, data.serviceIds]);
    } else if (data.scopeType === 'specific_centers') {
        await client.query('INSERT INTO role_centers (role_id, center_id) SELECT $1, unnest($2::varchar[])', [roleId, data.centerIds]);
    }
};

const mapDbError = (error) => {
    if (error.code === '23505') return new HttpError(409, 'يوجد دور بنفس الاسم', 'ROLE_LABEL_TAKEN');
    if (error.code === '23503' && error.constraint?.startsWith('role_services')) {
        return new HttpError(400, 'إحدى الخدمات المختارة غير موجودة', 'SERVICE_NOT_FOUND');
    }
    if (error.code === '23503' && error.constraint?.startsWith('role_centers')) {
        return new HttpError(400, 'أحد المراكز المختارة غير موجود', 'CENTER_NOT_FOUND');
    }
    return error;
};

const inTransaction = async (work) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await work(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK');
        throw mapDbError(error);
    } finally {
        client.release();
    }
};

const assertLabelFree = async (client, label, exceptId = null) => {
    const { rows } = await client.query(
        'SELECT 1 FROM roles WHERE LOWER(label) = LOWER($1) AND ($2::int IS NULL OR id <> $2)', [label, exceptId]
    );
    if (rows.length) throw new HttpError(409, 'يوجد دور بنفس الاسم', 'ROLE_LABEL_TAKEN');
};

/** A new job title. roles.name is the stable key carried by JWTs, generated here. */
export const createRole = async (actor, data) => {
    assertMayGrant(actor, data.permissions);
    const id = await inTransaction(async (client) => {
        await assertLabelFree(client, data.label);
        const { rows } = await client.query(
            `INSERT INTO roles (name, label, description)
             VALUES ('ROLE_' || upper(substr(md5(random()::text), 1, 12)), $1, $2) RETURNING id`,
            [data.label, data.description]
        );
        await writeMatrix(client, rows[0].id, data);
        await logActivity(client, {
            actorId: actor.id, action: 'role.create', entityType: 'role', entityId: rows[0].id,
            summary: `إنشاء المسمى «${data.label}»`, details: { permissions: data.permissions, scopeType: data.scopeType },
        });
        return rows[0].id;
    });
    return getRole(id);
};

/** Built-in roles keep their name; their permissions and scope can change. */
export const updateRole = async (actor, id, data) => {
    await inTransaction(async (client) => {
        // Same lock as staff changes: a role edit and a staff change can't race each other.
        await client.query('SELECT pg_advisory_xact_lock(7019)');
        const current = await getRole(id, client);
        assertMayEdit(actor, current);
        if (current.isSuperAdmin) throw new HttpError(409, 'دور الصلاحيات الكاملة لا يحتاج تحديد صلاحيات', 'SUPER_ADMIN_ROLE');
        assertMayGrant(actor, data.permissions, current.permissions.map((permission) => permission.key));
        if (!current.isSystem) {
            await assertLabelFree(client, data.label, id);
            await client.query('UPDATE roles SET label = $2, description = $3 WHERE id = $1', [id, data.label, data.description]);
        } else if (data.label !== current.label) {
            throw new HttpError(409, 'لا يمكن تغيير اسم دور أساسي في النظام', 'SYSTEM_ROLE');
        } else {
            await client.query('UPDATE roles SET description = $2 WHERE id = $1', [id, data.description]);
        }
        await writeMatrix(client, id, data);
        await logActivity(client, {
            actorId: actor.id, action: 'role.update', entityType: 'role', entityId: id,
            summary: `تعديل صلاحيات «${data.label}»`,
            details: {
                from: current.permissions.map((permission) => permission.key), to: data.permissions,
                scopeType: data.scopeType, assignedOnly: data.assignedOnly,
            },
        });
    });
    return getRole(id);
};

/** Custom roles nobody holds (active or not) can be deleted; built-in roles never. */
export const deleteRole = async (actor, id) => {
    await inTransaction(async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(7019)');
        const current = await getRole(id, client);
        assertMayEdit(actor, current);
        if (current.isSystem) throw new HttpError(409, 'لا يمكن حذف دور أساسي في النظام', 'SYSTEM_ROLE');
        if (current.members) {
            throw new HttpError(409, 'انقل الموظفين إلى دور آخر قبل حذف هذا الدور', 'ROLE_IN_USE');
        }
        await client.query('DELETE FROM roles WHERE id = $1', [id]);
        await logActivity(client, {
            actorId: actor.id, action: 'role.delete', entityType: 'role', entityId: id, summary: `حذف المسمى «${current.label}»`,
        });
    });
    return { id };
};
