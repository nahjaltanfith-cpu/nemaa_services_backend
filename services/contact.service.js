import pool from '../db.js';
import { HttpError } from '../utils/httpError.js';

// Query types on the public form, with the Arabic names used in emails and summaries.
export const CONTACT_TYPES = {
    general: 'استفسار عام',
    technical: 'دعم فني',
    suggestion: 'اقتراح',
    partnership: 'شراكة',
};

// pending (معلقة) → contacted (تم التواصل) → completed (مكتملة); any order is allowed.
export const CONTACT_STATUS_LABELS = {
    pending: 'معلقة',
    contacted: 'تم التواصل',
    completed: 'مكتملة',
};
export const CONTACT_STATUSES = Object.keys(CONTACT_STATUS_LABELS);

// One address may send this many messages per window; more is almost always a double submit or spam.
const THROTTLE_MAX = 3;
const THROTTLE_MINUTES = 10;

const COLUMNS = `id, type, full_name, organization_name, email, phone, message, status, created_at, updated_at`;

const toContactRequest = (row) => ({
    id: row.id,
    type: row.type,
    fullName: row.full_name,
    organizationName: row.organization_name,
    email: row.email,
    phone: row.phone,
    message: row.message,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
});

const notFound = () => new HttpError(404, 'الرسالة غير موجودة', 'NOT_FOUND');

export const createContactRequest = async ({ type, fullName, organizationName, email, phone, message }) => {
    const { rows: [{ recent }] } = await pool.query(
        `SELECT count(*)::int AS recent FROM contact_requests
         WHERE lower(email) = lower($1) AND created_at > NOW() - make_interval(mins => $2)`,
        [email, THROTTLE_MINUTES]
    );
    if (recent >= THROTTLE_MAX) {
        throw new HttpError(429, 'وصلتنا رسائلك بالفعل، سنتواصل معك قريبًا. حاول مرة أخرى بعد قليل.', 'TOO_MANY_REQUESTS');
    }
    const { rows } = await pool.query(
        `INSERT INTO contact_requests (type, full_name, organization_name, email, phone, message)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${COLUMNS}`,
        // Optional fields left blank are stored as NULL, not ''.
        [type, fullName, organizationName || null, email, phone || null, message]
    );
    return toContactRequest(rows[0]);
};

/** Newest first; optionally one status. */
export const listContactRequests = async ({ status } = {}) => {
    const { rows } = await pool.query(
        `SELECT ${COLUMNS} FROM contact_requests
         WHERE ($1::varchar IS NULL OR status = $1)
         ORDER BY created_at DESC, id DESC`,
        [status || null]
    );
    return rows.map(toContactRequest);
};

export const getContactRequest = async (id) => {
    const { rows } = await pool.query(`SELECT ${COLUMNS} FROM contact_requests WHERE id = $1`, [id]);
    if (!rows.length) throw notFound();
    return toContactRequest(rows[0]);
};

/** Returns the message after the change and the status it had before (unchanged = no write). */
export const updateContactStatus = async (id, status) => {
    const current = await getContactRequest(id);
    if (current.status === status) return { contactRequest: current, previousStatus: status };
    const { rows } = await pool.query(
        `UPDATE contact_requests SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING ${COLUMNS}`,
        [id, status]
    );
    if (!rows.length) throw notFound();
    return { contactRequest: toContactRequest(rows[0]), previousStatus: current.status };
};
