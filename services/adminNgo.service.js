import pool from '../db.js';
import { countsBy, likeTerm, pageSql } from '../utils/pagination.js';
import { HttpError } from '../utils/httpError.js';
import { DOCUMENTS, NGO_COLUMNS, toPublicNgo } from './ngo.mapper.js';
import { EVENTS, emitToThread } from './realtime.service.js';
import { deleteFiles, keyFromPublicUrl } from './upload.service.js';

const notFound = () => new HttpError(404, 'الجمعية غير موجودة', 'NOT_FOUND');

// Only NGOs that confirmed their email are real applicants.
const VERIFIED = 'email_verified_at IS NOT NULL';

/**
 * Verified NGOs, newest first; unread counts are messages from the NGO not yet read by staff.
 * Without `page` → the plain array (the realtime unread badge uses it). With it → one page,
 * the total, and the count per account status over every verified NGO (the filter's numbers).
 */
export const listNgos = async ({ status, search, page, pageSize } = {}) => {
    const params = [];
    const where = [VERIFIED];
    if (status) {
        params.push(status);
        where.push(`account_status = $${params.length}`);
    }
    if (search) {
        params.push(likeTerm(search));
        where.push(`(ngo_name ILIKE $${params.length} OR email ILIKE $${params.length})`);
    }
    const whereSql = `WHERE ${where.join(' AND ')}`;
    if (!page) {
        const { rows } = await pool.query(`SELECT ${NGO_COLUMNS} FROM ngos ${whereSql} ORDER BY created_at DESC, id DESC`, params);
        return rows.map((row) => toPublicNgo(row, 'admin'));
    }
    const pageParams = [...params];
    const limit = pageSql(pageParams, { page, pageSize });
    const [{ rows }, { rows: totalRows }, { rows: statusRows }] = await Promise.all([
        pool.query(`SELECT ${NGO_COLUMNS} FROM ngos ${whereSql} ORDER BY created_at DESC, id DESC ${limit}`, pageParams),
        pool.query(`SELECT COUNT(*) AS count FROM ngos ${whereSql}`, params),
        pool.query(`SELECT account_status AS key, COUNT(*) AS count FROM ngos WHERE ${VERIFIED} GROUP BY account_status`),
    ]);
    const byStatus = countsBy(statusRows);
    return {
        items: rows.map((row) => toPublicNgo(row, 'admin')),
        total: Number(totalRows[0].count),
        page,
        pageSize,
        counts: { all: Object.values(byStatus).reduce((sum, count) => sum + count, 0), status: byStatus },
    };
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

/** Exempts the NGO from every request limit, or puts it back under them. */
export const setLimitsExempt = async (id, exempt) => {
    const { rows } = await pool.query(
        `UPDATE ngos SET limits_exempt = $2, updated_at = NOW() WHERE id = $1 AND ${VERIFIED} RETURNING ${NGO_COLUMNS}`,
        [id, exempt]
    );
    if (!rows.length) throw notFound();
    emitToThread(id, EVENTS.NGO_UPDATED, { ngoId: id });
    return toPublicNgo(rows[0], 'admin');
};

/**
 * Removes one registration document (e.g. a wrong file): the NGO sees it as missing again and can
 * upload a new one. The review status is left as is; the reviewer sets "needs documents" if needed.
 */
export const deleteNgoDocument = async (id, documentKey) => {
    const doc = DOCUMENTS.find(({ key }) => key === documentKey);
    if (!doc) throw new HttpError(404, 'المستند غير موجود', 'NOT_FOUND');
    // The column name comes from DOCUMENTS (fixed list), never from the request.
    const { rows } = await pool.query(`SELECT ${doc.column} AS file_key FROM ngos WHERE id = $1 AND ${VERIFIED}`, [id]);
    if (!rows.length) throw notFound();
    if (!rows[0].file_key) throw new HttpError(404, 'المستند غير مرفوع', 'NOT_FOUND');
    const updated = await pool.query(
        `UPDATE ngos SET ${doc.column} = NULL, updated_at = NOW() WHERE id = $1 RETURNING ${NGO_COLUMNS}`, [id]
    );
    await deleteFiles([rows[0].file_key]);
    emitToThread(id, EVENTS.NGO_UPDATED, { ngoId: id });
    return { ngo: toPublicNgo(updated.rows[0], 'admin'), label: doc.label };
};

/**
 * Deletes an NGO and everything it owns: messages, requests (with their files, status log and
 * conversations) cascade in the DB; its documents, picture and request files are then removed from
 * storage. Returns the deleted NGO's id and name (for the activity log).
 */
export const deleteNgo = async (id) => {
    const client = await pool.connect();
    let ngo;
    let fileKeys;
    try {
        await client.query('BEGIN');
        const { rows } = await client.query(
            'SELECT id, ngo_name, ngo_document_key, representative_proof_key, avatar_url FROM ngos WHERE id = $1 FOR UPDATE',
            [id]
        );
        if (!rows.length) throw notFound();
        ngo = rows[0];
        const files = await client.query(
            'SELECT f.file_key FROM request_files f JOIN service_requests r ON r.id = f.request_id WHERE r.ngo_id = $1',
            [id]
        );
        fileKeys = [ngo.ngo_document_key, ngo.representative_proof_key, keyFromPublicUrl(ngo.avatar_url),
            ...files.rows.map((row) => row.file_key)];
        await client.query('DELETE FROM ngos WHERE id = $1', [id]);
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
    await deleteFiles(fileKeys);
    // Open admin lists refetch (and drop it); an open chat page for it gets a 404 and leaves.
    emitToThread(ngo.id, EVENTS.NGO_UPDATED, { ngoId: ngo.id });
    return { id: ngo.id, ngoName: ngo.ngo_name };
};
