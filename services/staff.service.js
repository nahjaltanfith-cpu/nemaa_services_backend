import bcrypt from 'bcryptjs';
import pool from '../db.js';
import { HttpError } from '../utils/httpError.js';
import { logActivity } from './activityLog.service.js';

// Staff = users whose role is a staff role (public 'user' sign-ups are not listed).
const SELECT = `
    SELECT u.id, u.name, u.email, u.is_active, u.last_login_at, u.created_at, u.updated_at,
           r.id AS role_id, r.name AS role_name, r.label AS role_label, r.is_super_admin,
           c.name AS created_by_name
    FROM users u
    JOIN roles r ON r.id = u.role_id
    LEFT JOIN users c ON c.id = u.created_by
    WHERE r.is_staff`;

const toStaff = (row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    isActive: row.is_active,
    role: { id: row.role_id, name: row.role_name, label: row.role_label, isSuperAdmin: row.is_super_admin },
    lastLoginAt: row.last_login_at,
    createdBy: row.created_by_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
});

const notFound = () => new HttpError(404, 'الموظف غير موجود', 'NOT_FOUND');

const mapDbError = (error) => (error.code === '23505'
    ? new HttpError(409, 'البريد الإلكتروني مستخدم لحساب آخر', 'EMAIL_TAKEN')
    : error);

export const listStaff = async ({ status, roleId, search } = {}) => {
    const where = [];
    const params = [];
    const add = (sql, value) => {
        params.push(value);
        where.push(sql.replaceAll('?', `$${params.length}`));
    };
    if (status) add('u.is_active = ?', status === 'active');
    if (roleId) add('r.id = ?', roleId);
    if (search) add('(u.name ILIKE ? OR u.email ILIKE ?)', `%${search.replace(/[%_\\]/g, '\\$&')}%`);
    const { rows } = await pool.query(
        `${SELECT} ${where.length ? `AND ${where.join(' AND ')}` : ''} ORDER BY u.is_active DESC, r.is_super_admin DESC, u.name`,
        params
    );
    return rows.map(toStaff);
};

export const getStaff = async (id, client = pool) => {
    const { rows } = await client.query(`${SELECT} AND u.id = $1`, [id]);
    if (!rows.length) throw notFound();
    return toStaff(rows[0]);
};

const findStaffRole = async (client, roleId) => {
    const { rows } = await client.query('SELECT id, label, is_super_admin FROM roles WHERE id = $1 AND is_staff', [roleId]);
    if (!rows.length) throw new HttpError(400, 'الدور المختار غير متاح لفريق العمل', 'ROLE_NOT_FOUND');
    return rows[0];
};

// Full-access accounts and roles are granted and managed by super admins only, so a manage:employees
// role can't promote anyone (itself included) past its own rights.
const superAdminOnly = () => new HttpError(403, 'حسابات مدير النظام يديرها مدير النظام فقط', 'FORBIDDEN');

/** actor = req.user (id, isSuperAdmin). */
export const createStaff = async (actor, { name, email, password, roleId }) => {
    const hash = await bcrypt.hash(password, 12);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const role = await findStaffRole(client, roleId);
        if (role.is_super_admin && !actor.isSuperAdmin) throw superAdminOnly();
        const { rows } = await client.query(
            `INSERT INTO users (name, email, password, role_id, created_by)
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [name, email, hash, roleId, actor.id]
        );
        await logActivity(client, {
            actorId: actor.id, action: 'staff.create', entityType: 'staff', entityId: rows[0].id,
            summary: `إضافة ${name} بدور «${role.label}»`, details: { roleId },
        });
        await client.query('COMMIT');
        return getStaff(rows[0].id);
    } catch (error) {
        await client.query('ROLLBACK');
        throw mapDbError(error);
    } finally {
        client.release();
    }
};

/**
 * Applies `changes` to a staff account. Guards: nobody demotes or deactivates themselves, and the
 * last active super admin can't be demoted or deactivated (someone must be able to manage staff).
 */
export const updateStaff = async (actor, id, changes) => {
    const actorId = actor.id;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // Serializes concurrent changes to super admins, so two of them can't remove each other at once.
        await client.query('SELECT pg_advisory_xact_lock(7019)');
        const current = await getStaff(id, client);
        const nextRole = changes.roleId ? await findStaffRole(client, changes.roleId) : null;
        if (!actor.isSuperAdmin && (current.role.isSuperAdmin || nextRole?.is_super_admin)) throw superAdminOnly();
        const staysSuper = nextRole ? nextRole.is_super_admin : current.role.isSuperAdmin;
        const staysActive = changes.isActive ?? current.isActive;

        if (id === actorId && (!staysActive || (current.role.isSuperAdmin && !staysSuper))) {
            throw new HttpError(409, 'لا يمكنك إيقاف حسابك أو سحب صلاحية مدير النظام من نفسك', 'SELF_LOCKOUT');
        }
        if (current.role.isSuperAdmin && current.isActive && (!staysSuper || !staysActive)) {
            const { rows } = await client.query(
                `SELECT COUNT(*) AS count FROM users u JOIN roles r ON r.id = u.role_id
                 WHERE r.is_super_admin AND u.is_active AND u.id <> $1`,
                [id]
            );
            if (!rows[0].count) {
                throw new HttpError(409, 'لا يمكن إيقاف أو تغيير دور آخر مدير نظام نشط', 'LAST_SUPER_ADMIN');
            }
        }

        const sets = [];
        const params = [id];
        const set = (column, value) => {
            params.push(value);
            sets.push(`${column} = $${params.length}`);
        };
        if (changes.name !== undefined) set('name', changes.name);
        if (changes.email !== undefined) set('email', changes.email);
        if (changes.roleId !== undefined) set('role_id', changes.roleId);
        if (changes.isActive !== undefined) set('is_active', changes.isActive);
        if (changes.password) set('password', await bcrypt.hash(changes.password, 12));
        await client.query(`UPDATE users SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1`, params);
        const what = [
            nextRole && nextRole.id !== current.role.id && `الدور: «${nextRole.label}»`,
            changes.isActive === false && current.isActive && 'إيقاف الحساب',
            changes.isActive === true && !current.isActive && 'إعادة التفعيل',
            changes.password && 'تغيير كلمة المرور',
            (changes.name !== undefined && changes.name !== current.name) && 'الاسم',
            (changes.email !== undefined && changes.email !== current.email) && 'البريد',
        ].filter(Boolean);
        if (what.length) {
            await logActivity(client, {
                actorId, action: changes.isActive === false ? 'staff.deactivate' : 'staff.update', entityType: 'staff', entityId: id,
                summary: `${current.name}: ${what.join('، ')}`,
                details: { roleId: changes.roleId, isActive: changes.isActive },
            });
        }
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw mapDbError(error);
    } finally {
        client.release();
    }
    return getStaff(id);
};

// "Removing" a staff member deactivates the account: history (requests, messages) keeps its author,
// and the account can be re-activated later. Sign-in and existing tokens stop working at once.
export const deactivateStaff = (actor, id) => updateStaff(actor, id, { isActive: false });
