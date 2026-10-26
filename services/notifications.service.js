import pool from '../db.js';
import { P } from '../config/permissions.js';
import {
    newRequestStaffEmail, ngoApprovedEmail, ngoNeedsDocumentsEmail, requestCompletedEmail, requestNeedsCompletionEmail,
} from '../templates/emailTemplates.js';
import { queueEmail } from './email.service.js';
import { ROLE_COVERS_REQUEST } from './requestScope.js';

/**
 * Email only for milestones that need someone to act or that close a case:
 *   NGO account needs documents / approved · request needs completion / completed (to the NGO)
 *   new request submitted (to the staff who route requests) · OTP (services/email.service.js).
 * Everything else (intermediate statuses, notes, chat) stays as in-app updates.
 * Callers run these after their transaction commits; they never throw.
 */
const SITE_URL = () => (process.env.SITE_URL || 'http://localhost:5173').replace(/\/+$/, '');
const DASHBOARD_URL = () => (process.env.DASHBOARD_URL || 'http://localhost:5174').replace(/\/+$/, '');

const safely = (label, work) => work().catch((error) => console.error(`[notify] ${label}:`, error.message));

// ── NGO account ─────────────────────────────────────────────────────────────
/**
 * The team set the NGO's account status. needs_documents: every time (new notes = new feedback);
 * approved: only the first time it becomes approved.
 */
export const notifyNgoAccountStatus = (ngo, previousStatus) => safely('ngo status', async () => {
    if (ngo.accountStatus === 'needs_documents') {
        queueEmail({ to: ngo.email, ...ngoNeedsDocumentsEmail({ ngoName: ngo.ngoName, notes: ngo.adminNotes, url: `${SITE_URL()}/dashboard/status` }) });
    } else if (ngo.accountStatus === 'approved' && previousStatus !== 'approved') {
        queueEmail({ to: ngo.email, ...ngoApprovedEmail({ ngoName: ngo.ngoName, url: `${SITE_URL()}/dashboard` }) });
    }
});

// ── Requests ────────────────────────────────────────────────────────────────
const loadRequest = async (requestId) => {
    const { rows } = await pool.query(
        `SELECT r.id, r.ref_code, r.need_title, r.target_name, r.completion_note, n.ngo_name, n.email AS ngo_email
         FROM service_requests r JOIN ngos n ON n.id = r.ngo_id WHERE r.id = $1`,
        [requestId]
    );
    return rows[0] || null;
};

/** A status change by the team: email the NGO only for "needs completion" and "completed". */
export const notifyRequestStatus = (requestId, { from, to, missingItems = [] }) => safely('request status', async () => {
    if (from === to || !['needs_completion', 'completed'].includes(to)) return;
    const request = await loadRequest(requestId);
    if (!request) return;
    const common = {
        ngoName: request.ngo_name, refCode: request.ref_code, needTitle: request.need_title,
        targetName: request.target_name, url: `${SITE_URL()}/dashboard/requests/${request.id}`,
    };
    queueEmail({
        to: request.ngo_email,
        ...(to === 'needs_completion'
            ? requestNeedsCompletionEmail({ ...common, items: missingItems, note: request.completion_note })
            : requestCompletedEmail(common)),
    });
});

// Who routes new requests: active staff with assign:orders whose scope covers the request.
// If nobody does, the super admins hear about it instead, so no request goes unnoticed.
const ROUTERS_SQL = `
    SELECT u.name, u.email
    FROM users u
    JOIN roles ro ON ro.id = u.role_id
    CROSS JOIN service_requests r
    WHERE r.id = $1 AND u.is_active AND ro.is_staff AND NOT ro.assigned_only
      AND EXISTS (SELECT 1 FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
                  WHERE rp.role_id = ro.id AND p.key = '${P.ASSIGN_ORDERS}')
      AND ${ROLE_COVERS_REQUEST}`;
const SUPER_ADMINS_SQL = `
    SELECT u.name, u.email FROM users u JOIN roles ro ON ro.id = u.role_id
    WHERE u.is_active AND ro.is_super_admin`;

/** The NGO submitted a request: one personal email per relevant staff member. */
export const notifyNewRequest = (requestId) => safely('new request', async () => {
    const request = await loadRequest(requestId);
    if (!request) return;
    let { rows: staff } = await pool.query(ROUTERS_SQL, [requestId]);
    if (!staff.length) ({ rows: staff } = await pool.query(SUPER_ADMINS_SQL));
    for (const member of staff) {
        queueEmail({
            to: member.email,
            ...newRequestStaffEmail({
                staffName: member.name, ngoName: request.ngo_name, refCode: request.ref_code,
                needTitle: request.need_title, targetName: request.target_name,
                url: `${DASHBOARD_URL()}/dashboard/requests/${request.id}`,
            }),
        });
    }
});
