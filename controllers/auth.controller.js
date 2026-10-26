import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import Joi from 'joi';
import pool from '../db.js';
import { loadAccount, toScope } from '../middlewares/auth.middleware.js';

// Any domain: staff accounts may use an internal one (same rule as validators/staff.validator.js).
const emailSchema = Joi.string().trim().lowercase().email({ tlds: { allow: false } }).max(255).required();
const registerSchema = Joi.object({
    name: Joi.string().trim().min(1).max(200).required(),
    email: emailSchema,
    password: Joi.string().min(8).required(),
}).unknown(true);
const loginSchema = Joi.object({
    email: emailSchema,
    password: Joi.string().required(),
}).unknown(true);

const fail = (res, status, message) =>
    res.status(status).json({ success: false, message, data: null });

// What the dashboard needs to show / hide sections: live role, super-admin flag, permission keys
// and request scope (the API enforces all of them; the dashboard only adapts what it shows).
const toSessionUser = (user, account) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    role: account.role,
    roleId: account.role_id,
    roleLabel: account.role_label,
    isSuperAdmin: account.is_super_admin,
    isStaff: account.is_staff,
    permissions: account.permissions,
    scope: toScope(account),
    createdAt: user.created_at,
});

const signToken = (user) => jwt.sign(
    { id: user.id, role: user.role },
    process.env.JWT_SECRET,
    { algorithm: 'HS256', expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
);

export const register = async (req, res) => {
    const { value, error } = registerSchema.validate(req.body ?? {}, { convert: true });
    if (error || Buffer.byteLength(value.password || '', 'utf8') > 72) {
        return fail(res, 400, 'Valid name, email and password (min 8 chars, max 72 bytes) are required.');
    }

    let connection;
    try {
        connection = await pool.connect();
        await connection.query('BEGIN');
        const hash = await bcrypt.hash(value.password, 12);
        const { rows: [user] } = await connection.query(
            `INSERT INTO users (name, email, password, role_id)
             VALUES ($1, $2, $3, (SELECT id FROM roles WHERE name = 'user'))
             RETURNING id, name, email, 'user' AS role`,
            [value.name, value.email, hash]
        );
        // Signing before commit avoids creating an account when JWT configuration is invalid.
        const token = signToken(user);
        await connection.query('COMMIT');
        return res.status(201).json({
            success: true, message: 'Registration successful.', data: { token, user },
        });
    } catch (error) {
        if (connection) await connection.query('ROLLBACK');
        if (error.code === '23505') return fail(res, 409, 'Email already registered.');
        console.error('[auth] register:', error);
        return fail(res, 500, 'Internal server error.');
    } finally {
        connection?.release();
    }
};

export const login = async (req, res) => {
    const { value, error } = loginSchema.validate(req.body ?? {}, { convert: true });
    if (error || Buffer.byteLength(value.password || '', 'utf8') > 72) {
        return fail(res, 400, 'Valid email and password are required.');
    }

    try {
        const { rows } = await pool.query(
            `SELECT u.id, u.name, u.email, u.password, u.is_active, u.created_at, r.name AS role
             FROM users u JOIN roles r ON r.id = u.role_id
             WHERE LOWER(u.email) = $1`,
            [value.email]
        );
        const user = rows[0];
        if (!user || !(await bcrypt.compare(value.password, user.password))) {
            return fail(res, 401, 'Invalid email or password.');
        }
        // Checked after the password, so a deactivated account isn't revealed to guessers.
        if (!user.is_active) {
            return res.status(403).json({
                success: false, message: 'تم إيقاف هذا الحساب، تواصل مع مدير النظام', code: 'ACCOUNT_INACTIVE', data: null,
            });
        }
        await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);
        const sessionUser = toSessionUser(user, await loadAccount(user.id));
        return res.json({
            success: true, message: 'Login successful.',
            data: { token: signToken(sessionUser), user: sessionUser },
        });
    } catch (error) {
        console.error('[auth] login:', error);
        return fail(res, 500, 'Internal server error.');
    }
};

export const getProfile = async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT id, name, email, created_at FROM users WHERE id = $1', [req.user.id]);
        const account = rows[0] && await loadAccount(req.user.id);
        if (!account) return fail(res, 404, 'User not found.');
        return res.json({ success: true, message: 'Profile retrieved successfully.', data: toSessionUser(rows[0], account) });
    } catch (error) {
        console.error('[auth] profile:', error);
        return fail(res, 500, 'Internal server error.');
    }
};
