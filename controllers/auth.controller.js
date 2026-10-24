import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import Joi from 'joi';
import pool from '../db.js';

const emailSchema = Joi.string().trim().lowercase().email().max(255).required();
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
            `SELECT u.id, u.name, u.email, u.password, r.name AS role
             FROM users u JOIN roles r ON r.id = u.role_id
             WHERE LOWER(u.email) = $1`,
            [value.email]
        );
        const user = rows[0];
        if (!user || !(await bcrypt.compare(value.password, user.password))) {
            return fail(res, 401, 'Invalid email or password.');
        }
        const { password: ignored, ...safeUser } = user;
        return res.json({
            success: true, message: 'Login successful.',
            data: { token: signToken(safeUser), user: safeUser },
        });
    } catch (error) {
        console.error('[auth] login:', error);
        return fail(res, 500, 'Internal server error.');
    }
};

export const getProfile = async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT u.id, u.name, u.email, r.name AS role, u.created_at
             FROM users u JOIN roles r ON r.id = u.role_id WHERE u.id = $1`,
            [req.user.id]
        );
        if (!rows[0]) return fail(res, 404, 'User not found.');
        return res.json({ success: true, message: 'Profile retrieved successfully.', data: rows[0] });
    } catch (error) {
        console.error('[auth] profile:', error);
        return fail(res, 500, 'Internal server error.');
    }
};
