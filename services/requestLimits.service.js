import { HttpError } from '../utils/httpError.js';
import { getRequestLimits } from './settings.service.js';

/**
 * The limits checked when an NGO submits a request.
 *  - Per service / per center: distinct NGOs with an open request. A completed or archived request
 *    frees its place.
 *  - Per NGO (services only, centers have their own counter): every submitted request that is not
 *    archived, inside the period the admin chose. Completing a request does not give it back.
 * Drafts count for nothing; an NGO marked limits_exempt skips every check.
 */

// A request holds a place on its service or center while in one of these.
const OPEN_STATUSES_SQL = "('under_study', 'needs_completion', 'in_progress')";

/** Catalog subquery: how many NGOs currently hold a place. column: service_id | center_id. */
export const activeBeneficiariesSql = (column, targetRef) => `
    (SELECT COUNT(DISTINCT r.ngo_id) FROM service_requests r
     WHERE r.${column} = ${targetRef} AND r.deleted_at IS NULL AND r.status IN ${OPEN_STATUSES_SQL})`;

/** The API fields a service or center gets from max_beneficiaries + active_beneficiaries. */
export const capacityFields = (row) => ({
    maxBeneficiaries: row.max_beneficiaries,
    activeBeneficiaries: row.active_beneficiaries,
    isFull: row.max_beneficiaries !== null && row.active_beneficiaries >= row.max_beneficiaries,
});

const TARGETS = {
    service: { table: 'services', column: 'service_id', idOf: (target) => target.serviceId, fullMessage: 'اكتمل العدد لهذه الخدمة، ولا يمكن استقبال طلبات جديدة حاليًا' },
    center: { table: 'enablement_centers', column: 'center_id', idOf: (target) => target.centerId, fullMessage: 'اكتمل العدد لهذا المركز، ولا يمكن استقبال طلبات جديدة حاليًا' },
};

// SQL narrowing r.submitted_at to the chosen period ('' = lifetime).
const periodSql = ({ period, periodFrom, periodTo }, params) => {
    if (period === 'yearly') return "AND r.submitted_at >= date_trunc('year', NOW())";
    if (period === 'monthly') return "AND r.submitted_at >= date_trunc('month', NOW())";
    if (period === 'custom') {
        params.push(periodFrom, periodTo);
        return `AND r.submitted_at >= $${params.length - 1}::date AND r.submitted_at < $${params.length}::date + 1`;
    }
    return '';
};

const assertNgoWithinLimits = async (client, ngoId, target, limits) => {
    const { maxFreeServices, maxTotalServices, period, periodFrom, periodTo } = limits;
    if (maxFreeServices === null && maxTotalServices === null) return;
    if (period === 'custom') {
        // A dated phase (e.g. launch only): outside it the limits don't apply.
        const { rows } = await client.query('SELECT CURRENT_DATE BETWEEN $1::date AND $2::date AS inside', [periodFrom, periodTo]);
        if (!rows[0].inside) return;
    }
    const params = [ngoId];
    const { rows } = await client.query(
        `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE r.target_is_free) AS free
         FROM service_requests r
         WHERE r.ngo_id = $1 AND r.target_type = 'service' AND r.status <> 'draft' AND r.deleted_at IS NULL
           ${periodSql(limits, params)}`,
        params
    );
    const { total, free } = rows[0];
    if (maxTotalServices !== null && total >= maxTotalServices) {
        throw new HttpError(409, `وصلت جمعيتكم إلى الحد الأقصى لعدد الخدمات (${maxTotalServices} خدمات)`, 'NGO_TOTAL_LIMIT_REACHED');
    }
    if (target.isFree && maxFreeServices !== null && free >= maxFreeServices) {
        throw new HttpError(409, `وصلت جمعيتكم إلى الحد الأقصى للخدمات المجانية (${maxFreeServices} خدمات)`, 'NGO_FREE_LIMIT_REACHED');
    }
};

/**
 * Throws a 409 with the reason when the NGO can't submit this request. Call it inside the transaction
 * that stores the request: the row locks (always target, then NGO) make simultaneous submissions wait
 * for each other, so the last place can't be taken twice.
 */
export const assertWithinLimits = async (client, ngoId, target) => {
    const { table, column, idOf, fullMessage } = TARGETS[target.type];
    const targetId = idOf(target);
    const { rows: [locked] } = await client.query(
        `SELECT max_beneficiaries FROM ${table} WHERE id = $1 FOR NO KEY UPDATE`, [targetId]
    );
    const { rows: [ngo] } = await client.query('SELECT limits_exempt FROM ngos WHERE id = $1 FOR NO KEY UPDATE', [ngoId]);
    if (ngo.limits_exempt) return;
    if (target.type === 'service') await assertNgoWithinLimits(client, ngoId, target, await getRequestLimits(client));
    if (locked.max_beneficiaries === null) return;
    const { rows: [{ count }] } = await client.query(
        `SELECT ${activeBeneficiariesSql(column, '$1')} AS count`, [targetId]
    );
    if (count >= locked.max_beneficiaries) throw new HttpError(409, fullMessage, 'TARGET_FULL');
};
