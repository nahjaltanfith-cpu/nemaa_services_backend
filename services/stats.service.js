import pool from '../db.js';
import { scopeSql } from './requestScope.js';

/**
 * Public counters for the website's "about" section:
 * - services: requestable now ('active' only; coming_soon is not "available" yet)
 * - centers: shown on the website ('active' + 'coming_soon', same as the centers section)
 * - ngos: every NGO account registered with us, whatever its review status
 */
export const getPublicStats = async () => {
    const { rows } = await pool.query(`
        SELECT
            (SELECT COUNT(*) FROM services WHERE status = 'active') AS services,
            (SELECT COUNT(*) FROM enablement_centers WHERE status <> 'inactive') AS centers,
            (SELECT COUNT(*) FROM ngos) AS ngos`);
    return rows[0];
};

const MONTHS_SHOWN = 6;
const TOP_TARGETS = 5;

/**
 * Dashboard home numbers. Request figures cover submitted requests inside the viewer's role scope
 * (no drafts, no archived); NGO figures are only included when `includeNgos` is true.
 */
export const getAdminOverview = async (viewer, { includeNgos = false } = {}) => {
    const params = [];
    const scope = scopeSql(viewer, params);
    const base = `r.status <> 'draft' AND r.deleted_at IS NULL AND ${scope}`;

    const [summary, monthly, topTargets, ngos] = await Promise.all([
        pool.query(
            `SELECT COUNT(*)::int AS total,
                    COUNT(*) FILTER (WHERE r.status = 'under_study')::int AS under_study,
                    COUNT(*) FILTER (WHERE r.status = 'needs_completion')::int AS needs_completion,
                    COUNT(*) FILTER (WHERE r.status = 'in_progress')::int AS in_progress,
                    COUNT(*) FILTER (WHERE r.status = 'completed')::int AS completed,
                    COUNT(*) FILTER (WHERE r.assigned_to_user_id IS NULL AND r.status <> 'completed')::int AS unassigned,
                    COUNT(*) FILTER (WHERE r.submitted_at >= NOW() - INTERVAL '30 days')::int AS last_30_days
             FROM service_requests r WHERE ${base}`,
            params
        ),
        pool.query(
            `SELECT to_char(month, 'YYYY-MM') AS month, COUNT(r.id)::int AS count
             FROM generate_series(date_trunc('month', NOW()) - INTERVAL '${MONTHS_SHOWN - 1} months', date_trunc('month', NOW()), INTERVAL '1 month') AS month
             LEFT JOIN service_requests r ON date_trunc('month', r.submitted_at) = month AND ${base}
             GROUP BY month ORDER BY month`,
            params
        ),
        pool.query(
            `SELECT r.target_name AS name, COUNT(*)::int AS count
             FROM service_requests r WHERE ${base} AND r.target_name <> ''
             GROUP BY r.target_name ORDER BY count DESC, name LIMIT ${TOP_TARGETS}`,
            params
        ),
        includeNgos
            ? pool.query('SELECT account_status AS status, COUNT(*)::int AS count FROM ngos GROUP BY account_status')
            : null,
    ]);

    const { total, under_study: underStudy, needs_completion: needsCompletion, in_progress: inProgress,
        completed, unassigned, last_30_days: last30Days } = summary.rows[0];
    return {
        requests: {
            total,
            // Accepted = approved for work, whether it is still running or already delivered.
            accepted: inProgress + completed,
            underStudy,
            needsCompletion,
            inProgress,
            completed,
            unassigned,
            last30Days,
        },
        monthly: monthly.rows,
        topTargets: topTargets.rows,
        ngos: ngos ? {
            total: ngos.rows.reduce((sum, row) => sum + row.count, 0),
            byStatus: Object.fromEntries(ngos.rows.map((row) => [row.status, row.count])),
        } : null,
    };
};
