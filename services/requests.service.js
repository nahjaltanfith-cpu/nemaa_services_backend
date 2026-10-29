import crypto from 'node:crypto';
import pool from '../db.js';
import { HttpError } from '../utils/httpError.js';
import { P } from '../config/permissions.js';
import { logActivity } from './activityLog.service.js';
import { notifyNewRequest, notifyRequestStatus } from './notifications.service.js';
import { EVENTS, emitToRequest } from './realtime.service.js';
import { ROLE_COVERS_REQUEST, scopeSql } from './requestScope.js';
import { fileExists, publicUrl } from './upload.service.js';

// Default "سجل الحالة" wording per status; admins can write their own label instead.
export const STATUS_LABELS = {
    draft: 'تم حفظ المسودة',
    under_study: 'قيد الدراسة والمراجعة',
    needs_completion: 'مطلوب استكمال مستندات',
    in_progress: 'جاري العمل على الطلب',
    completed: 'تم إنجاز الطلب',
};
const SUBMITTED_LABEL = 'تم تقديم الطلب';
const COMPLETION_SENT_LABEL = 'تم إرسال المستندات المطلوبة';
const DELIVERABLES_LABEL = 'تم رفع ملفات التسليم';
const THREAD_LIMIT = 500;

const notFound = () => new HttpError(404, 'الطلب غير موجود', 'NOT_FOUND');
const refSuffix = () => crypto.randomBytes(4).toString('hex').toUpperCase();

const inTransaction = async (work) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await work(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
};

// ── Mapping ─────────────────────────────────────────────────────────────────
// unreadFrom: whose unread messages to count ('ngo' for the admin's view, 'admin' for the NGO's).
const summarySelect = (unreadFrom) => `
    SELECT r.*, n.ngo_name, a.name AS assignee_name,
        (SELECT COUNT(*) FROM request_messages m
         WHERE m.request_id = r.id AND m.read_at IS NULL AND m.sender_type = '${unreadFrom}') AS unread_messages,
        -- Who acted last on the timeline: 'ngo' on a submitted request = waiting for the team.
        (SELECT l.actor_type FROM request_status_log l
         WHERE l.request_id = r.id ORDER BY l.created_at DESC, l.id DESC LIMIT 1) AS last_actor,
        (SELECT COUNT(*) FROM request_missing_items i
         WHERE i.request_id = r.id AND i.fulfilled_at IS NULL) AS pending_items,
        -- A team action the NGO has not opened yet.
        EXISTS (SELECT 1 FROM request_status_log l
                WHERE l.request_id = r.id AND l.actor_type = 'admin'
                  AND l.created_at > COALESCE(r.ngo_seen_at, 'epoch'::timestamp)) AS has_team_update
    FROM service_requests r
    JOIN ngos n ON n.id = r.ngo_id
    LEFT JOIN users a ON a.id = r.assigned_to_user_id`;

const toSummary = (row) => ({
    id: row.id,
    refCode: row.ref_code,
    type: row.target_type || 'general',
    targetId: row.service_id != null ? String(row.service_id) : row.center_id,
    targetName: row.target_name,
    needTitle: row.need_title,
    summary: row.summary,
    status: row.status,
    ngo: { id: row.ngo_id, name: row.ngo_name },
    unreadMessages: row.unread_messages,
    lastActor: row.last_actor,
    // Missing documents the NGO still has to upload (needs_completion).
    pendingItems: row.pending_items,
    // NGO view: the team changed something since the NGO last opened the request.
    hasTeamUpdate: row.has_team_update,
    submittedAt: row.submitted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
});

// The team's view adds who the request is assigned to (internal: never sent to the NGO).
const toAdminSummary = (row) => ({
    ...toSummary(row),
    assignee: row.assigned_to_user_id ? { id: row.assigned_to_user_id, name: row.assignee_name } : null,
    assignedAt: row.assigned_at,
});

const toFile = (row) => ({
    id: row.id,
    kind: row.kind,
    label: row.label,
    required: row.required,
    missingItemId: row.missing_item_id,
    key: row.file_key,
    name: row.original_name,
    size: row.size,
    url: publicUrl(row.file_key),
    createdAt: row.created_at,
});

const toMessage = (row) => ({
    id: row.id,
    requestId: row.request_id,
    senderType: row.sender_type,
    senderName: row.sender_name,
    // The NGO's picture on its own messages; team messages have none (null)
    senderAvatar: row.sender_avatar,
    body: row.body,
    createdAt: row.created_at,
    readAt: row.read_at,
});

/**
 * One request with everything its page shows. ngoId limits it to that NGO's requests; the team
 * (no ngoId) never sees drafts, and `viewer` limits it to the viewer's request scope.
 */
const loadRequest = async (id, { ngoId = null, unreadFrom, viewer = null } = {}, client = pool) => {
    const params = [id, ngoId];
    const { rows } = await client.query(
        `${summarySelect(unreadFrom)}
         WHERE r.id = $1 AND ($2::int IS NULL OR r.ngo_id = $2) AND ($2::int IS NOT NULL OR r.status <> 'draft')
           AND ${scopeSql(viewer, params)}`,
        params
    );
    if (!rows.length) throw notFound();
    const row = rows[0];
    const [{ rows: files }, { rows: items }, { rows: log }] = await Promise.all([
        client.query('SELECT * FROM request_files WHERE request_id = $1 ORDER BY created_at, id', [id]),
        client.query('SELECT * FROM request_missing_items WHERE request_id = $1 ORDER BY created_at, id', [id]),
        client.query('SELECT * FROM request_status_log WHERE request_id = $1 ORDER BY created_at, id', [id]),
    ]);
    const mapped = files.map(toFile);
    return {
        ...(ngoId ? toSummary(row) : toAdminSummary(row)),
        description: row.description,
        contactMethod: row.contact_method,
        completionNote: row.completion_note,
        attachments: mapped.filter((file) => file.kind === 'ngo'),
        deliverables: mapped.filter((file) => file.kind === 'deliverable'),
        // Every missing-document round, with the file that answered it (if any).
        missingItems: items.map((item) => ({
            id: item.id,
            name: item.name,
            fulfilledAt: item.fulfilled_at,
            createdAt: item.created_at,
            file: mapped.find((file) => file.missingItemId === item.id) || null,
        })),
        timeline: log.map((entry) => ({
            id: entry.id,
            key: entry.status,
            label: entry.label,
            note: entry.note,
            actor: entry.actor_type,
            date: entry.created_at,
        })),
    };
};

export const getRequestForNgo = (ngoId, id) => loadRequest(id, { ngoId, unreadFrom: 'admin' });

/** The NGO opened the request page: team updates up to now count as seen. */
export const markSeenByNgo = async (ngoId, id) => {
    await pool.query('UPDATE service_requests SET ngo_seen_at = NOW() WHERE id = $1 AND ngo_id = $2', [id, ngoId]);
};
export const getRequestForAdmin = (id, viewer = null) => loadRequest(id, { unreadFrom: 'ngo', viewer });

const listRequests = async ({ ngoId = null, status, search, assignee, unreadFrom, viewer = null }) => {
    const where = [];
    const params = [];
    const add = (sql, value) => {
        params.push(value);
        where.push(sql.replaceAll('?', `$${params.length}`));
    };
    if (ngoId) add('r.ngo_id = ?', ngoId);
    else where.push("r.status <> 'draft'", scopeSql(viewer, params));
    if (status) add('r.status = ?', status);
    // Team filter: 'me' = assigned to the viewer · 'unassigned' = nobody yet.
    if (!ngoId && assignee === 'me') add('r.assigned_to_user_id = ?', viewer?.id);
    if (!ngoId && assignee === 'unassigned') where.push('r.assigned_to_user_id IS NULL');
    if (search) {
        add('(r.ref_code ILIKE ? OR r.need_title ILIKE ? OR r.target_name ILIKE ? OR n.ngo_name ILIKE ?)',
            `%${search.replace(/[%_\\]/g, '\\$&')}%`);
    }
    const { rows } = await pool.query(
        `${summarySelect(unreadFrom)} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY r.updated_at DESC, r.id DESC`,
        params
    );
    return rows.map(ngoId ? toSummary : toAdminSummary);
};

export const listRequestsForNgo = (ngoId, filters = {}) => listRequests({ ...filters, ngoId, unreadFrom: 'admin' });
export const listRequestsForAdmin = (filters = {}, viewer = null) => listRequests({ ...filters, viewer, unreadFrom: 'ngo' });

// ── Rules shared by create / update ─────────────────────────────────────────
const assertCanRequest = async (ngoId) => {
    const { rows } = await pool.query('SELECT account_status FROM ngos WHERE id = $1', [ngoId]);
    if (!rows.length) throw new HttpError(404, 'الجمعية غير موجودة', 'NOT_FOUND');
    if (rows[0].account_status !== 'approved') {
        throw new HttpError(403, 'لا يمكن تقديم الطلبات قبل اعتماد حساب الجمعية', 'ACCOUNT_NOT_APPROVED');
    }
};

// Files must have been uploaded through POST /api/upload and still be stored.
const assertFilesExist = async (files) => {
    for (const file of files) {
        if (!(await fileExists(file.key))) {
            throw new HttpError(400, `الملف «${file.name}» غير موجود، ارفعه مرة أخرى`, 'FILE_NOT_FOUND');
        }
    }
};

// What the request is for: an active service or center (title snapshot + its required documents).
const resolveTarget = async (client, type, targetId) => {
    if (!type || targetId == null || targetId === '') {
        return { type: null, serviceId: null, centerId: null, name: '', documents: [] };
    }
    if (type === 'service') {
        const id = Number(targetId);
        const { rows } = Number.isSafeInteger(id)
            ? await client.query('SELECT id, title, status, required_attachments FROM services WHERE id = $1', [id])
            : { rows: [] };
        if (!rows.length || rows[0].status !== 'active') {
            throw new HttpError(400, 'الخدمة المختارة غير متاحة للطلب حاليًا', 'TARGET_NOT_AVAILABLE');
        }
        return { type, serviceId: rows[0].id, centerId: null, name: rows[0].title, documents: rows[0].required_attachments };
    }
    const { rows } = await client.query('SELECT id, title, status FROM enablement_centers WHERE id = $1', [String(targetId)]);
    if (!rows.length || rows[0].status !== 'active') {
        throw new HttpError(400, 'المركز المختار غير متاح للطلب حاليًا', 'TARGET_NOT_AVAILABLE');
    }
    return { type, serviceId: null, centerId: rows[0].id, name: rows[0].title, documents: [] };
};

const assertSubmittable = (data, target) => {
    if (!target.type) throw new HttpError(400, 'اختر الخدمة أو مركز التمكين أولًا', 'TARGET_REQUIRED');
    if (!data.summary) throw new HttpError(400, 'ملخص احتياج الجمعية مطلوب', 'SUMMARY_REQUIRED');
    if (!data.description) throw new HttpError(400, 'الوصف التفصيلي مطلوب', 'DESCRIPTION_REQUIRED');
    const missing = target.documents
        .filter((doc) => doc.required && !data.attachments.some((file) => file.label === doc.name))
        .map((doc) => doc.name);
    if (missing.length) {
        throw new HttpError(400, `ارفع المستندات الإلزامية: ${missing.join('، ')}`, 'MISSING_REQUIRED_DOCUMENTS');
    }
};

const insertFiles = async (client, requestId, kind, files, { userId = null, documents = [] } = {}) => {
    for (const file of files) {
        const doc = file.label ? documents.find((item) => item.name === file.label) : null;
        await client.query(
            `INSERT INTO request_files (request_id, kind, label, required, missing_item_id, file_key,
                 original_name, size, uploaded_by_user_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [requestId, kind, file.label || null, Boolean(doc?.required), file.itemId || null,
                file.key, file.name, file.size || 0, userId]
        );
    }
};

const logStatus = (client, requestId, { status, label, note = null, actor, userId = null }) => client.query(
    `INSERT INTO request_status_log (request_id, status, label, note, actor_type, actor_user_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [requestId, status, label, note, actor, userId]
);

const notifyUpdated = (ngoId, requestId, status) =>
    emitToRequest(ngoId, requestId, EVENTS.REQUEST_UPDATED, { requestId, ngoId, status });

// ── NGO actions ─────────────────────────────────────────────────────────────
/** Saves a new draft, or submits it right away when data.submit is true. */
export const createRequest = async (ngoId, data) => {
    await assertCanRequest(ngoId);
    await assertFilesExist(data.attachments);
    const id = await inTransaction(async (client) => {
        const target = await resolveTarget(client, data.type, data.targetId);
        if (data.submit) assertSubmittable(data, target);
        const status = data.submit ? 'under_study' : 'draft';
        const { rows } = await client.query(
            `INSERT INTO service_requests (ref_code, ngo_id, target_type, service_id, center_id, target_name,
                 need_title, summary, description, contact_method, status, submitted_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, ${data.submit ? 'NOW()' : 'NULL'})
             RETURNING id`,
            [`${data.submit ? 'REQ' : 'DRAFT'}-${refSuffix()}`, ngoId, target.type, target.serviceId, target.centerId,
                target.name, data.needTitle, data.summary, data.description, data.contactMethod, status]
        );
        const requestId = rows[0].id;
        await insertFiles(client, requestId, 'ngo', data.attachments, { documents: target.documents });
        await logStatus(client, requestId, {
            status, label: data.submit ? SUBMITTED_LABEL : STATUS_LABELS.draft, actor: 'ngo',
        });
        return requestId;
    });
    if (data.submit) {
        notifyUpdated(ngoId, id, 'under_study');
        notifyNewRequest(id);
    }
    return getRequestForNgo(ngoId, id);
};

/** Replaces a draft's content (files included); submits it when data.submit is true. */
export const updateDraft = async (ngoId, id, data) => {
    await assertCanRequest(ngoId);
    await assertFilesExist(data.attachments);
    await inTransaction(async (client) => {
        const { rows } = await client.query(
            'SELECT status FROM service_requests WHERE id = $1 AND ngo_id = $2 FOR UPDATE', [id, ngoId]
        );
        if (!rows.length) throw notFound();
        if (rows[0].status !== 'draft') {
            throw new HttpError(409, 'لا يمكن تعديل الطلب بعد إرساله', 'REQUEST_ALREADY_SUBMITTED');
        }
        const target = await resolveTarget(client, data.type, data.targetId);
        if (data.submit) assertSubmittable(data, target);
        await client.query(
            `UPDATE service_requests SET target_type = $2, service_id = $3, center_id = $4, target_name = $5,
                 need_title = $6, summary = $7, description = $8, contact_method = $9,
                 status = $10,
                 ref_code = CASE WHEN $11::boolean THEN replace(ref_code, 'DRAFT-', 'REQ-') ELSE ref_code END,
                 submitted_at = CASE WHEN $11::boolean THEN NOW() ELSE submitted_at END,
                 updated_at = NOW()
             WHERE id = $1`,
            [id, target.type, target.serviceId, target.centerId, target.name, data.needTitle, data.summary,
                data.description, data.contactMethod, data.submit ? 'under_study' : 'draft', data.submit]
        );
        await client.query("DELETE FROM request_files WHERE request_id = $1 AND kind = 'ngo'", [id]);
        await insertFiles(client, id, 'ngo', data.attachments, { documents: target.documents });
        if (data.submit) await logStatus(client, id, { status: 'under_study', label: SUBMITTED_LABEL, actor: 'ngo' });
    });
    if (data.submit) {
        notifyUpdated(ngoId, id, 'under_study');
        notifyNewRequest(id);
    }
    return getRequestForNgo(ngoId, id);
};

/** Drafts only: submitted requests stay for the record. */
export const deleteDraft = async (ngoId, id) => {
    const { rowCount } = await pool.query(
        "DELETE FROM service_requests WHERE id = $1 AND ngo_id = $2 AND status = 'draft'", [id, ngoId]
    );
    if (!rowCount) throw notFound();
    return { id };
};

// Locks the NGO's request while it waits for missing documents.
const lockAwaitingCompletion = async (client, ngoId, id) => {
    const { rows } = await client.query(
        'SELECT status FROM service_requests WHERE id = $1 AND ngo_id = $2 FOR UPDATE', [id, ngoId]
    );
    if (!rows.length) throw notFound();
    if (rows[0].status !== 'needs_completion') {
        throw new HttpError(409, 'الطلب لا يحتاج إلى استكمال حاليًا', 'NOT_AWAITING_COMPLETION');
    }
};

const findMissingItem = async (client, id, itemId) => {
    const { rows } = await client.query(
        'SELECT id, name FROM request_missing_items WHERE id = $1 AND request_id = $2', [itemId, id]
    );
    if (!rows.length) throw new HttpError(404, 'المستند المطلوب غير موجود', 'NOT_FOUND');
    return rows[0];
};

/**
 * Attaches the NGO's file to one missing item (replacing an earlier upload for it).
 * When no item is left pending, the round is over: the request goes back to "under study".
 * @returns {Promise<{ request, roundCompleted: boolean }>}
 */
export const uploadMissingItem = async (ngoId, id, itemId, file) => {
    await assertFilesExist([file]);
    const roundCompleted = await inTransaction(async (client) => {
        await lockAwaitingCompletion(client, ngoId, id);
        const item = await findMissingItem(client, id, itemId);
        await client.query("DELETE FROM request_files WHERE request_id = $1 AND kind = 'completion' AND missing_item_id = $2", [id, item.id]);
        await insertFiles(client, id, 'completion', [{ ...file, label: item.name, itemId: item.id }]);
        await client.query('UPDATE request_missing_items SET fulfilled_at = NOW() WHERE id = $1', [item.id]);
        const { rows: pending } = await client.query(
            'SELECT 1 FROM request_missing_items WHERE request_id = $1 AND fulfilled_at IS NULL LIMIT 1', [id]
        );
        if (pending.length) {
            await client.query('UPDATE service_requests SET updated_at = NOW() WHERE id = $1', [id]);
            return false;
        }
        // Every requested document is in: list this round's documents on the timeline.
        const { rows: round } = await client.query(
            `SELECT name FROM request_missing_items
             WHERE request_id = $1 AND created_at >= (
                 SELECT MAX(created_at) FROM request_status_log WHERE request_id = $1 AND status = 'needs_completion'
             ) - INTERVAL '1 second'
             ORDER BY created_at, id`,
            [id]
        );
        await client.query(
            `UPDATE service_requests SET status = 'under_study', completion_note = NULL, updated_at = NOW()
             WHERE id = $1`,
            [id]
        );
        await logStatus(client, id, {
            status: 'under_study', label: COMPLETION_SENT_LABEL,
            note: round.map((row) => row.name).join('، ') || null, actor: 'ngo',
        });
        return true;
    });
    notifyUpdated(ngoId, id, roundCompleted ? 'under_study' : null);
    return { request: await getRequestForNgo(ngoId, id), roundCompleted };
};

/** Takes back an uploaded file while the request still waits for documents. */
export const removeMissingItemFile = async (ngoId, id, itemId) => {
    await inTransaction(async (client) => {
        await lockAwaitingCompletion(client, ngoId, id);
        const item = await findMissingItem(client, id, itemId);
        await client.query("DELETE FROM request_files WHERE request_id = $1 AND kind = 'completion' AND missing_item_id = $2", [id, item.id]);
        await client.query('UPDATE request_missing_items SET fulfilled_at = NULL WHERE id = $1', [item.id]);
        await client.query('UPDATE service_requests SET updated_at = NOW() WHERE id = $1', [id]);
    });
    notifyUpdated(ngoId, id, null);
    return getRequestForNgo(ngoId, id);
};

// ── Admin actions ───────────────────────────────────────────────────────────
// actor = { id, scope, can(key) }: the signed-in staff member (see controllers/requests.controller.js).
const forbidden = () => new HttpError(403, 'ليست لديك صلاحية لهذا الإجراء', 'FORBIDDEN');

// A submitted request inside the actor's scope, locked for the change.
const lockSubmitted = async (client, id, actor = null) => {
    const params = [id];
    const { rows } = await client.query(
        `SELECT r.ngo_id, r.status, r.ref_code, r.assigned_to_user_id FROM service_requests r
         WHERE r.id = $1 AND r.status <> 'draft' AND ${scopeSql(actor, params)} FOR UPDATE OF r`,
        params
    );
    if (!rows.length) throw notFound();
    return rows[0];
};

/**
 * The permissions that allow a status change (current → next); one is enough.
 * Same status = a note on the timeline. Back to "under study" from a completion round ends the
 * round (request:order_info); from anywhere else it re-opens the request (approval).
 */
const statusPermissions = (from, to) => {
    if (from === to) return [P.DOCUMENT_UPDATES];
    if (to === 'needs_completion') return [P.REQUEST_ORDER_INFO];
    if (to === 'in_progress') return [P.APPROVE_SERVICE_ORDERS];
    if (to === 'completed') return [P.COMPLETE_ORDER];
    return from === 'needs_completion' ? [P.REQUEST_ORDER_INFO, P.APPROVE_SERVICE_ORDERS] : [P.APPROVE_SERVICE_ORDERS];
};

/**
 * Moves a request to `status` and records it on the timeline (label defaults per status).
 * needs_completion: the missing documents become upload slots for the NGO.
 * Same status as now = just a timeline entry (e.g. "تم التوجيه للمستشار المختص").
 */
export const changeStatus = async (id, actor, { status, label, note, missingItems }) => {
    if (status === 'needs_completion' && !missingItems.length && !note) {
        throw new HttpError(400, 'حدّد المستندات الناقصة أو اكتب ملاحظة للجمعية', 'COMPLETION_DETAILS_REQUIRED');
    }
    const { ngoId, from } = await inTransaction(async (client) => {
        const request = await lockSubmitted(client, id, actor);
        if (!statusPermissions(request.status, status).some(actor.can)) throw forbidden();
        if (status === 'needs_completion') {
            for (const name of missingItems) {
                await client.query('INSERT INTO request_missing_items (request_id, name) VALUES ($1, $2)', [id, name]);
            }
        } else {
            // Leaving the completion round: what was never answered is no longer asked for.
            await client.query('DELETE FROM request_missing_items WHERE request_id = $1 AND fulfilled_at IS NULL', [id]);
        }
        await client.query(
            `UPDATE service_requests SET status = $2, updated_at = NOW(),
                 completion_note = CASE WHEN $2::request_status = 'needs_completion' THEN $3 ELSE NULL END
             WHERE id = $1`,
            [id, status, note]
        );
        await logStatus(client, id, { status, label: label || STATUS_LABELS[status], note, actor: 'admin', userId: actor.id });
        const changed = status !== request.status;
        const missing = status === 'needs_completion' && missingItems.length ? ` (المطلوب: ${missingItems.join('، ')})` : '';
        await logActivity(client, {
            actorId: actor.id, action: changed ? 'request.status' : 'request.note', entityType: 'request', entityId: id,
            summary: changed
                ? `${request.ref_code}: من «${STATUS_LABELS[request.status]}» إلى «${STATUS_LABELS[status]}»${missing}`
                : `${request.ref_code}: إضافة تحديث على سجل الطلب «${label || STATUS_LABELS[status]}»`,
            details: { from: request.status, to: status, label, missingItems },
        });
        return { ngoId: request.ngo_id, from: request.status };
    });
    notifyUpdated(ngoId, id, status);
    notifyRequestStatus(id, { from, to: status, missingItems });
    return getRequestForAdmin(id);
};

/** Final result files from Nemaa's team; the NGO sees them on the request. */
export const addDeliverables = async (id, actor, files) => {
    await assertFilesExist(files);
    const ngoId = await inTransaction(async (client) => {
        const request = await lockSubmitted(client, id, actor);
        await insertFiles(client, id, 'deliverable', files, { userId: actor.id });
        await client.query('UPDATE service_requests SET updated_at = NOW() WHERE id = $1', [id]);
        await logStatus(client, id, {
            status: request.status, label: DELIVERABLES_LABEL,
            note: files.map((file) => file.label || file.name).join('، '), actor: 'admin', userId: actor.id,
        });
        await logActivity(client, {
            actorId: actor.id, action: 'request.deliverables', entityType: 'request', entityId: id,
            summary: `${request.ref_code}: رفع ملفات التسليم (${files.map((file) => file.name).join('، ')})`,
            details: { files: files.map((file) => file.name) },
        });
        return request.ngo_id;
    });
    notifyUpdated(ngoId, id, null);
    return getRequestForAdmin(id);
};

export const removeDeliverable = async (id, actor, fileId) => {
    const ngoId = await inTransaction(async (client) => {
        const request = await lockSubmitted(client, id, actor);
        const { rows } = await client.query(
            "DELETE FROM request_files WHERE id = $2 AND request_id = $1 AND kind = 'deliverable' RETURNING original_name",
            [id, fileId]
        );
        if (!rows.length) throw new HttpError(404, 'الملف غير موجود', 'NOT_FOUND');
        await logActivity(client, {
            actorId: actor.id, action: 'request.deliverable_delete', entityType: 'request', entityId: id,
            summary: `${request.ref_code}: حذف ملف التسليم «${rows[0].original_name}»`,
        });
        return request.ngo_id;
    });
    notifyUpdated(ngoId, id, null);
    return getRequestForAdmin(id);
};

// Active staff who may be given request `r` ($1): their role can execute requests and covers it.
const ASSIGNEES_SQL = `
    SELECT u.id, u.name, ro.label AS role_label
    FROM users u
    JOIN roles ro ON ro.id = u.role_id
    CROSS JOIN service_requests r
    WHERE r.id = $1 AND u.is_active AND ro.is_staff
      AND EXISTS (SELECT 1 FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
                  WHERE rp.role_id = ro.id AND p.key = '${P.EXECUTE_ORDERS}')
      AND ${ROLE_COVERS_REQUEST}`;

/** Who the request can be assigned to (for the assignee picker). */
export const listAssignees = async (id, actor) => {
    await getRequestForAdmin(id, actor);
    const { rows } = await pool.query(`${ASSIGNEES_SQL} ORDER BY u.name`, [id]);
    return rows.map((row) => ({ id: row.id, name: row.name, roleLabel: row.role_label }));
};

/**
 * Assigns the request to `assigneeId` (null = unassign). The assignee must be active staff whose
 * role has execute:orders and covers the request's service or center.
 */
export const assignRequest = async (id, actor, assigneeId) => {
    const ngoId = await inTransaction(async (client) => {
        const request = await lockSubmitted(client, id, actor);
        let assignee = null;
        if (assigneeId) {
            const { rows } = await client.query(`${ASSIGNEES_SQL} AND u.id = $2`, [id, assigneeId]);
            if (!rows.length) {
                throw new HttpError(400, 'لا يمكن إسناد الطلب لهذا الموظف: دوره لا يشمل تنفيذ هذه الخدمة', 'ASSIGNEE_NOT_ELIGIBLE');
            }
            assignee = rows[0];
        }
        if ((request.assigned_to_user_id || null) === (assigneeId || null)) return request.ngo_id;
        await client.query(
            `UPDATE service_requests SET assigned_to_user_id = $2::int, updated_at = NOW(),
                 assigned_at = CASE WHEN $2::int IS NULL THEN NULL ELSE NOW() END
             WHERE id = $1`,
            [id, assigneeId || null]
        );
        await logActivity(client, {
            actorId: actor.id, action: assignee ? 'request.assign' : 'request.unassign', entityType: 'request', entityId: id,
            summary: assignee ? `${request.ref_code}: أُسند إلى ${assignee.name}` : `${request.ref_code}: أُلغي الإسناد`,
            details: { from: request.assigned_to_user_id, to: assigneeId || null },
        });
        return request.ngo_id;
    });
    // Internal change: the NGO gets nothing, the team sees the new assignee.
    emitToRequest(null, id, EVENTS.REQUEST_UPDATED, { requestId: id, ngoId, status: null });
    return getRequestForAdmin(id);
};

// ── Conversation per request ────────────────────────────────────────────────
const MESSAGE_SELECT = `SELECT m.*,
        CASE WHEN m.sender_type = 'admin' THEN COALESCE(u.name, 'فريق نماء') ELSE n.ngo_name END AS sender_name,
        CASE WHEN m.sender_type = 'admin' THEN NULL ELSE n.avatar_url END AS sender_avatar
    FROM request_messages m
    JOIN service_requests r ON r.id = m.request_id
    JOIN ngos n ON n.id = r.ngo_id
    LEFT JOIN users u ON u.id = m.sender_user_id`;

// The NGO's own non-draft request, or a non-draft request inside the staff viewer's scope.
const threadOwner = async (requestId, ngoId = null, viewer = null) => {
    const params = [requestId, ngoId];
    const { rows } = await pool.query(
        `SELECT r.ngo_id, r.status FROM service_requests r
         WHERE r.id = $1 AND ($2::int IS NULL OR r.ngo_id = $2) AND ${scopeSql(ngoId ? null : viewer, params)}`,
        params
    );
    if (!rows.length || (ngoId == null && rows[0].status === 'draft')) throw notFound();
    if (rows[0].status === 'draft') throw new HttpError(409, 'أرسل الطلب أولًا لبدء المحادثة', 'REQUEST_IS_DRAFT');
    return rows[0].ngo_id;
};

export const listMessages = async (requestId, { ngoId = null, viewer = null } = {}) => {
    await threadOwner(requestId, ngoId, viewer);
    const { rows } = await pool.query(
        `SELECT * FROM (${MESSAGE_SELECT} WHERE m.request_id = $1 ORDER BY m.created_at DESC, m.id DESC LIMIT $2) t
         ORDER BY created_at, id`,
        [requestId, THREAD_LIMIT]
    );
    // Same shape as the general NGO thread, so the chat component works unchanged.
    return { conversationOpen: true, messages: rows.map(toMessage) };
};

export const sendMessage = async (requestId, { ngoId = null, viewer = null, senderType, senderUserId = null, body }) => {
    const ownerId = await threadOwner(requestId, ngoId, viewer);
    const { rows } = await pool.query(
        `INSERT INTO request_messages (request_id, sender_type, sender_user_id, body)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [requestId, senderType, senderUserId, body]
    );
    const { rows: [row] } = await pool.query(`${MESSAGE_SELECT} WHERE m.id = $1`, [rows[0].id]);
    const message = toMessage(row);
    emitToRequest(ownerId, requestId, EVENTS.REQUEST_MESSAGE, { requestId, ngoId: ownerId, message });
    return message;
};

export const markMessagesRead = async (requestId, reader, { ngoId = null, viewer = null } = {}) => {
    const ownerId = await threadOwner(requestId, ngoId, viewer);
    const { rowCount } = await pool.query(
        `UPDATE request_messages SET read_at = NOW()
         WHERE request_id = $1 AND sender_type = $2 AND read_at IS NULL`,
        [requestId, reader === 'admin' ? 'ngo' : 'admin']
    );
    if (rowCount) emitToRequest(ownerId, requestId, EVENTS.REQUEST_READ, { requestId, ngoId: ownerId, reader });
    return { marked: rowCount };
};
