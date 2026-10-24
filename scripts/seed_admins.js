import bcrypt from 'bcryptjs';
import pool from '../db.js';

// Usage: ADMIN_EMAIL=... ADMIN_PASSWORD=... [ADMIN_NAME=...] npm run seed:admins
// The dashboard checks SUPER_ADMIN by name, so seeded admins get that role.
const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;
const name = process.env.ADMIN_NAME?.trim() || 'Super Admin';

try {
    if (!email || !password) {
        throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD are required.');
    }
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
        `INSERT INTO users (name, email, password, role_id)
         VALUES ($1, $2, $3, (SELECT id FROM roles WHERE name = 'SUPER_ADMIN'))
         ON CONFLICT (email) DO UPDATE
             SET password = EXCLUDED.password, role_id = EXCLUDED.role_id
         RETURNING id, email, (xmax = 0) AS created`,
        [name, email, hash]
    );
    const [user] = rows;
    console.log(`[seed:admins] ${user.created ? 'Created' : 'Updated'} SUPER_ADMIN #${user.id}: ${user.email}`);
} catch (error) {
    console.error('[seed:admins] Failed:', error.message);
    process.exitCode = 1;
} finally {
    await pool.end();
}
