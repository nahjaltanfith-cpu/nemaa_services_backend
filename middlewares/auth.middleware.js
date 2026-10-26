import jwt from 'jsonwebtoken';
import pool from '../db.js';
import { CATALOG_EDIT } from '../config/permissions.js';

// Verifies a JWT and its claims; throws on anything invalid. Shared with the Socket.io handshake.
export const verifyAccessToken = (token) => {
    const user = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
    if (!Number.isSafeInteger(user.id) || user.id < 1
        || typeof user.role !== 'string' || !Number.isFinite(user.exp)) {
        throw new Error('Invalid token claims.');
    }
    return user;
};

// Legacy super-admin role names; prefer requirePermission / requireSuperAdmin in new routes.
export const ADMIN_ROLES = ['admin', 'SUPER_ADMIN'];
// Role carried by NGO tokens (NGOs live in the ngos table, not users).
export const NGO_ROLE = 'ngo';

/**
 * The live state of a users account: role, super-admin flag, permission keys, request scope and
 * active flag. Read on every request so a role change or a deactivation applies at once, not when
 * the JWT expires.
 */
export const loadAccount = async (userId) => {
    const { rows } = await pool.query(
        `SELECT u.id, u.is_active, r.id AS role_id, r.name AS role, r.label AS role_label, r.is_super_admin,
                r.is_staff, r.scope_type, r.assigned_only,
                COALESCE((SELECT array_agg(p.key ORDER BY p.key) FROM role_permissions rp
                          JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = r.id), '{}') AS permissions,
                COALESCE((SELECT array_agg(rs.service_id ORDER BY rs.service_id) FROM role_services rs
                          WHERE rs.role_id = r.id), '{}') AS scope_service_ids,
                COALESCE((SELECT array_agg(rc.center_id ORDER BY rc.center_id) FROM role_centers rc
                          WHERE rc.role_id = r.id), '{}') AS scope_center_ids
         FROM users u
         JOIN roles r ON r.id = u.role_id
         WHERE u.id = $1`,
        [userId]
    );
    return rows[0] || null;
};

// The request scope a session carries (super admins: everything, never assigned-only).
export const toScope = (account) => (account.is_super_admin
    ? { type: 'all_services', assignedOnly: false, serviceIds: [], centerIds: [] }
    : {
        type: account.scope_type,
        assignedOnly: account.assigned_only,
        serviceIds: account.scope_service_ids,
        centerIds: account.scope_center_ids,
    });

/**
 * Verified token → req.user. NGO tokens are used as they are; users tokens take their current
 * role, permissions and scope from the database. Returns null for a deleted or deactivated account.
 */
export const resolveUser = async (payload) => {
    if (payload.role === NGO_ROLE) return payload;
    const account = await loadAccount(payload.id);
    if (!account || !account.is_active) return null;
    return {
        ...payload,
        role: account.role,
        roleId: account.role_id,
        roleLabel: account.role_label,
        isSuperAdmin: account.is_super_admin,
        isStaff: account.is_staff,
        permissions: account.permissions,
        scope: toScope(account),
    };
};

export const hasPermission = (user, key) => Boolean(user?.isSuperAdmin || user?.permissions?.includes(key));

const bearer = (req) => /^Bearer ([^\s]+)$/i.exec(req.headers.authorization || '')?.[1];

export const authenticate = async (req, res, next) => {
    const token = bearer(req);
    if (!token) {
        return res.status(401).json({
            success: false, message: 'Access token is missing.', data: null,
        });
    }
    let payload;
    try {
        payload = verifyAccessToken(token);
    } catch {
        return res.status(401).json({
            success: false, message: 'Invalid or expired token.', data: null,
        });
    }
    try {
        req.user = await resolveUser(payload);
    } catch (error) {
        console.error('[auth] resolve user:', error);
        return res.status(500).json({ success: false, message: 'حدث خطأ في الخادم، حاول مرة أخرى', data: null });
    }
    if (!req.user) {
        return res.status(401).json({
            success: false, message: 'الحساب موقوف أو غير موجود', code: 'ACCOUNT_INACTIVE', data: null,
        });
    }
    return next();
};

// Roles are exact matches: explicitly include legacy roles where appropriate.
export const checkRole = (...roles) => (req, res, next) =>
    roles.includes(req.user?.role)
        ? next()
        : res.status(403).json({
            success: false, message: 'Forbidden: insufficient role.', data: null,
        });

const forbidden = (res) => res.status(403).json({
    success: false, message: 'ليست لديك صلاحية لهذا الإجراء', code: 'FORBIDDEN', data: null,
});

export const hasAnyPermission = (user, keys) => keys.some((key) => hasPermission(user, key));

// Staff whose role grants `key` ('read:orders', 'manage:catalog' … see config/permissions.js);
// super admins always pass.
export const requirePermission = (key) => (req, res, next) =>
    (hasPermission(req.user, key) ? next() : forbidden(res));

// At least one of `keys` (e.g. editing a service needs catalog, pricing or form-config rights).
export const requireAnyPermission = (...keys) => (req, res, next) =>
    (hasAnyPermission(req.user, keys) ? next() : forbidden(res));

// Full-access roles only.
export const requireSuperAdmin = (req, res, next) => (req.user?.isSuperAdmin ? next() : forbidden(res));

// Any signed-in users account (staff or public user), never an NGO token.
export const requireUserAccount = (req, res, next) => (req.user && req.user.role !== NGO_ROLE ? next() : forbidden(res));

// Public routes that show more to staff: sets req.isAdmin when the token's account may edit the
// catalog (sees inactive services and centers). A missing or invalid token is simply treated as public.
export const optionalAuth = async (req, res, next) => {
    req.isAdmin = false;
    const token = bearer(req);
    if (!token) return next();
    try {
        req.user = (await resolveUser(verifyAccessToken(token))) || undefined;
        req.isAdmin = hasAnyPermission(req.user, CATALOG_EDIT);
    } catch {
        req.user = undefined;
    }
    return next();
};
