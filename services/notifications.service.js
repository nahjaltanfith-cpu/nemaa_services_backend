import pool from '../db.js';
import { P } from '../config/permissions.js';
import {
    contactRequestEmail, newRequestStaffEmail, ngoApprovedEmail, ngoNeedsDocumentsEmail, requestCompletedEmail,
    requestNeedsCompletionEmail,
} from '../templates/emailTemplates.js';
import { CONTACT_TYPES } from './contact.service.js';
import { queueEmail } from './email.service.js';
import { ROLE_COVERS_REQUEST } from './requestScope.js';

/**
 * Email only for milestones that need someone to act or that close a case:
 *   NGO account needs documents / approved · request needs completion / completed (to the NGO)
 *   new request submitted (to the staff who route requests) · contact-form message (to the team inbox)
 *   · OTP (services/email.service.js).
 * Everything else (intermediate statuses, notes, chat) stays as in-app updates.
 * Callers run these after their transaction commits; they never throw.
 */
const SITE_URL = () => (process.env.SITE_URL || 'http://localhost:5173').replace(/\/+$/, '');
const DASHBOARD_URL = () => (process.env.DASHBOARD_URL || 'http://localhost:5174').replace(/\/+$/, '');
// Where contact-form messages are announced (CONTACT_INBOX_EMAIL in .env).
const CONTACT_INBOX = () => process.env.CONTACT_INBOX_EMAIL || 'info@namaa.sa';

const safely = (label, work) => work().catch((error) => console.error(`[notify] ${label}:`, error.message));

// ── NGO account ─────────────────────────────────────────────────────────────
/**
 * The team set the NGO's account status. needs_documents: when it is newly asked for or the
 * requirements (notes) changed, not on a save that changes nothing; approved: only the first time.
 */
export const notifyNgoAccountStatus = (ngo, before) => safely('ngo status', async () => {
    const previousStatus = before.accountStatus;
    const newRequirements = previousStatus !== 'needs_documents' || (before.adminNotes || '') !== (ngo.adminNotes || '');
    if (ngo.accountStatus === 'needs_documents' && newRequirements) {
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

/**
 * A status change by the team: email the NGO only for "needs completion" and "completed".
 * Needs completion: when newly asked for, or when new items are added to an open round.
 */
export const notifyRequestStatus = (requestId, { from, to, missingItems = [] }) => safely('request status', async () => {
    if (!['needs_completion', 'completed'].includes(to)) return;
    if (from === to && !(to === 'needs_completion' && missingItems.length)) return;
    const request = await loadRequest(requestId);
    if (!request) return;
    const common = {
        ngoName: request.ngo_name, refCode: request.ref_code, needTitle: request.need_title,
        targetName: request.target_name, url: `${SITE_URL()}/dashboard/requests/${request.id}`,
    };
    if (to === 'completed') {
        queueEmail({ to: request.ngo_email, ...requestCompletedEmail(common) });
        return;
    }
    // Everything still asked for in this round, and whether the work had already started
    const [{ rows: open }, { rows: started }] = await Promise.all([
        pool.query('SELECT name FROM request_missing_items WHERE request_id = $1 AND fulfilled_at IS NULL ORDER BY id', [requestId]),
        pool.query("SELECT 1 FROM request_status_log WHERE request_id = $1 AND status = 'in_progress' LIMIT 1", [requestId]),
    ]);
    queueEmail({
        to: request.ngo_email,
        ...requestNeedsCompletionEmail({
            ...common, items: open.map((row) => row.name), note: request.completion_note, inExecution: started.length > 0,
        }),
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

// ── Contact form ────────────────────────────────────────────────────────────
/** A visitor sent the "تواصل معنا" form: one email to the team inbox. */
export const notifyContactRequest = (contactRequest) => safely('contact request', async () => {
    queueEmail({
        to: CONTACT_INBOX(),
        ...contactRequestEmail({
            ...contactRequest,
            typeLabel: CONTACT_TYPES[contactRequest.type],
            url: `${DASHBOARD_URL()}/dashboard/contact-requests/${contactRequest.id}`,
        }),
    });
});
