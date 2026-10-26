import pool from '../db.js';
import { HttpError } from '../utils/httpError.js';
import { buildShortDescription } from '../utils/summary.js';
import { assertValidImage } from './serviceCatalog.service.js';

// Statuses NGOs and visitors can see; 'inactive' centers (and services) exist only for admins.
const PUBLIC_STATUSES = ['active', 'coming_soon'];

// Visitors only see the center's services they could open themselves.
const select = (includeHidden) => `
    SELECT ce.*,
        COALESCE((
            SELECT json_agg(json_build_object(
                'id', s.id, 'title', s.title, 'status', s.status, 'imageUrl', s.image_url,
                'price', s.price, 'rating', s.rating, 'shortDescription', s.short_description
            ) ORDER BY s.id)
            FROM center_services cs JOIN services s ON s.id = cs.service_id
            WHERE cs.center_id = ce.id ${includeHidden ? '' : "AND s.status <> 'inactive'"}
        ), '[]') AS services
    FROM enablement_centers ce`;

const toCenter = (row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    imageUrl: row.image_url,
    price: Number(row.price),
    requestCount: row.request_count,
    rating: Number(row.rating),
    responseTime: row.response_time,
    executionDuration: row.execution_duration,
    overview: row.overview,
    shortDescription: row.short_description,
    outputs: row.outputs,
    methodology: row.methodology,
    targetAudience: row.target_audience,
    services: row.services,
    serviceIds: row.services.map((service) => service.id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
});

const notFound = () => new HttpError(404, 'المركز غير موجود', 'NOT_FOUND');

const mapDbError = (error) => {
    if (error.code === '23503' && error.constraint === 'center_services_service_fkey') {
        return new HttpError(400, 'إحدى الخدمات المختارة غير موجودة', 'SERVICE_NOT_FOUND');
    }
    return error;
};

/**
 * Centers in seed/creation order. Visitors never see 'inactive' ones; admins (includeHidden)
 * see all and may filter by any status.
 */
export const listCenters = async ({ includeHidden = false, status, search } = {}) => {
    const where = [];
    const params = [];
    const add = (sql, value) => {
        params.push(value);
        where.push(sql.replace('?', `$${params.length}`));
    };
    if (!includeHidden) add('ce.status = ANY(?::center_status[])', PUBLIC_STATUSES);
    if (status) add('ce.status = ?', status);
    if (search) add('ce.title ILIKE ?', `%${search.replace(/[%_\\]/g, '\\$&')}%`);
    const { rows } = await pool.query(
        `${select(includeHidden)} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ce.created_at, ce.id`,
        params
    );
    return rows.map(toCenter);
};

export const getCenter = async (id, { includeHidden = false } = {}) => {
    const { rows } = await pool.query(`${select(includeHidden)} WHERE ce.id = $1`, [id]);
    if (!rows.length || (!includeHidden && !PUBLIC_STATUSES.includes(rows[0].status))) throw notFound();
    return toCenter(rows[0]);
};

const columnValues = (data) => [
    data.title, data.status, data.imageUrl, data.price, data.responseTime, data.executionDuration,
    data.overview, data.shortDescription || buildShortDescription(data.overview),
    JSON.stringify(data.outputs), JSON.stringify(data.methodology), JSON.stringify(data.targetAudience),
];

// Inside a transaction: replaces the center's services with exactly `serviceIds`.
const replaceServices = async (client, centerId, serviceIds) => {
    await client.query('DELETE FROM center_services WHERE center_id = $1', [centerId]);
    if (serviceIds.length) {
        await client.query(
            `INSERT INTO center_services (center_id, service_id)
             SELECT $1, unnest($2::int[])`,
            [centerId, serviceIds]
        );
    }
};

const inTransaction = async (work) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await work(client);
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK');
        throw mapDbError(error);
    } finally {
        client.release();
    }
};

export const createCenter = async (data) => {
    await assertValidImage(data.imageUrl);
    const id = await inTransaction(async (client) => {
        const { rows } = await client.query(
            `INSERT INTO enablement_centers (title, status, image_url, price, response_time,
                 execution_duration, overview, short_description, outputs, methodology, target_audience)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             RETURNING id`,
            columnValues(data)
        );
        await replaceServices(client, rows[0].id, data.serviceIds);
        return rows[0].id;
    });
    return getCenter(id, { includeHidden: true });
};

export const updateCenter = async (id, data) => {
    await assertValidImage(data.imageUrl);
    await inTransaction(async (client) => {
        const { rowCount } = await client.query(
            `UPDATE enablement_centers SET title = $2, status = $3, image_url = $4, price = $5,
                 response_time = $6, execution_duration = $7, overview = $8, short_description = $9,
                 outputs = $10, methodology = $11, target_audience = $12, updated_at = NOW()
             WHERE id = $1`,
            [id, ...columnValues(data)]
        );
        if (!rowCount) throw notFound();
        await replaceServices(client, id, data.serviceIds);
    });
    return getCenter(id, { includeHidden: true });
};

// center_services rows go with it (ON DELETE CASCADE); the services themselves stay.
export const deleteCenter = async (id) => {
    const { rowCount } = await pool.query('DELETE FROM enablement_centers WHERE id = $1', [id]);
    if (!rowCount) throw notFound();
    return { id };
};
