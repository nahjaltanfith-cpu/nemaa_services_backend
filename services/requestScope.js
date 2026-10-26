import pool from '../db.js';

/**
 * Request scope enforcement. A viewer is { id, scope } where scope comes from req.user.scope;
 * scope null = unrestricted (super admins, or all_services without assigned-only).
 * Every admin request query adds scopeSql's condition, so a request outside the viewer's scope
 * reads as "not found" — the same as a request that does not exist.
 */
export const viewerOf = (user) => ({
    id: user.id,
    scope: user.isSuperAdmin || (user.scope.type === 'all_services' && !user.scope.assignedOnly) ? null : user.scope,
});

/**
 * SQL condition (on service_requests aliased `r`) for the requests `viewer` may see, pushing its
 * values onto `params`. Returns 'TRUE' for an unrestricted viewer.
 */
export const scopeSql = (viewer, params) => {
    const scope = viewer?.scope;
    if (!scope) return 'TRUE';
    const parts = [];
    const add = (value) => {
        params.push(value);
        return `$${params.length}`;
    };
    if (scope.type === 'specific_services') {
        parts.push(`r.service_id = ANY(${add(scope.serviceIds)}::int[])`);
    } else if (scope.type === 'specific_centers') {
        // A center covers its own requests and requests for the services it offers.
        const centers = add(scope.centerIds);
        parts.push(`(r.center_id = ANY(${centers}::varchar[])
            OR r.service_id IN (SELECT cs.service_id FROM center_services cs WHERE cs.center_id = ANY(${centers}::varchar[])))`);
    }
    if (scope.assignedOnly) parts.push(`r.assigned_to_user_id = ${add(viewer.id)}`);
    return parts.length ? parts.join(' AND ') : 'TRUE';
};

/**
 * SQL condition: role `ro` covers request `r` by its service/center scope (assigned-only aside —
 * that is what an assignment grants). Used to pick who a request may be assigned to.
 */
export const ROLE_COVERS_REQUEST = `(
    ro.is_super_admin
    OR ro.scope_type = 'all_services'
    OR (ro.scope_type = 'specific_services'
        AND r.service_id IN (SELECT rs.service_id FROM role_services rs WHERE rs.role_id = ro.id))
    OR (ro.scope_type = 'specific_centers' AND (
        r.center_id IN (SELECT rc.center_id FROM role_centers rc WHERE rc.role_id = ro.id)
        OR r.service_id IN (SELECT cs.service_id FROM center_services cs
                            JOIN role_centers rc ON rc.center_id = cs.center_id WHERE rc.role_id = ro.id))))`;

/** Whether `viewer` may see submitted request `requestId` (realtime fan-out uses this). */
export const isRequestVisible = async (viewer, requestId, client = pool) => {
    if (!viewer.scope) return true;
    const params = [requestId];
    const { rows } = await client.query(
        `SELECT 1 FROM service_requests r WHERE r.id = $1 AND r.status <> 'draft' AND ${scopeSql(viewer, params)}`,
        params
    );
    return rows.length > 0;
};
