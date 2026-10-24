import pool from '../db.js';
import { HttpError } from '../utils/httpError.js';
import { NGO_COLUMNS, toPublicNgo } from './ngo.mapper.js';
import { EVENTS, emitToThread } from './realtime.service.js';

const notFound = () => new HttpError(404, 'الجمعية غير موجودة', 'NOT_FOUND');

// Only NGOs that confirmed their email are real applicants.
const VERIFIED = 'email_verified_at IS NOT NULL';

/** All verified NGOs, newest first; unread counts are messages from the NGO not yet read by staff. */
export const listNgos = async ({ status } = {}) => {
    const params = [];
    let filter = '';
    if (status) {
        params.push(status);
        filter = 'AND account_status = $1';
    }
    const { rows } = await pool.query(
        `SELECT ${NGO_COLUMNS} FROM ngos WHERE ${VERIFIED} ${filter} ORDER BY created_at DESC, id DESC`,
        params
    );
    return rows.map((row) => toPublicNgo(row, 'admin'));
};

export const getNgo = async (id) => {
    const { rows } = await pool.query(`SELECT ${NGO_COLUMNS} FROM ngos WHERE id = $1 AND ${VERIFIED}`, [id]);
    if (!rows.length) throw notFound();
    return toPublicNgo(rows[0], 'admin');
};

/**
 * Sets the review status. Notes are required for needs_documents (they tell the NGO what to fix)
 * and kept as-is otherwise unless new ones are given. The NGO sees an unseen-status indicator.
 */
export const updateNgoStatus = async (id, { status, notes }) => {
    const { rows } = await pool.query(
        `UPDATE ngos
         SET account_status = $2,
             admin_notes = CASE WHEN $3::text IS NOT NULL THEN $3 ELSE admin_notes END,
             status_updated_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND ${VERIFIED}
         RETURNING ${NGO_COLUMNS}`,
        [id, status, notes || null]
    );
    if (!rows.length) throw notFound();
    const ngo = toPublicNgo(rows[0], 'admin');
    emitToThread(id, EVENTS.NGO_STATUS, {
        ngoId: id, accountStatus: ngo.accountStatus, adminNotes: ngo.adminNotes, statusUpdatedAt: ngo.statusUpdatedAt,
    });
    return ngo;
};
