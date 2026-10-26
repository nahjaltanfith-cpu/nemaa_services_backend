import pool from '../db.js';
import { HttpError } from '../utils/httpError.js';
import { buildShortDescription } from '../utils/summary.js';
import { IMAGE_KEY_PATTERN, fileExists, keyFromPublicUrl } from './upload.service.js';

// Statuses NGOs and visitors can see; 'inactive' services exist only for admins.
const PUBLIC_STATUSES = ['active', 'coming_soon'];
// Images bundled with the public website (the seeded services use these paths).
const SITE_ASSET_PATTERN = /^\/images\/[\w/-]+\.(png|jpe?g|webp|svg)$/i;

const SELECT = `
    SELECT s.*, c.name AS category_name,
        COALESCE((
            SELECT json_agg(json_build_object('id', ce.id, 'title', ce.title) ORDER BY ce.title)
            FROM center_services sc JOIN enablement_centers ce ON ce.id = sc.center_id
            WHERE sc.service_id = s.id
        ), '[]') AS centers
    FROM services s
    LEFT JOIN categories c ON c.id = s.category_id`;

const toService = (row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    imageUrl: row.image_url,
    price: Number(row.price),
    requestCount: row.request_count,
    rating: Number(row.rating),
    responseTime: row.response_time,
    duration: row.duration,
    categoryId: row.category_id,
    category: row.category_id ? { id: row.category_id, name: row.category_name } : null,
    fullDescription: row.full_description,
    shortDescription: row.short_description,
    outputs: row.outputs,
    workMethodology: row.work_methodology,
    targetAudience: row.target_audience,
    includes: row.includes,
    requiredAttachments: row.required_attachments,
    centers: row.centers,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
});

const notFound = () => new HttpError(404, 'الخدمة غير موجودة', 'NOT_FOUND');

const mapDbError = (error) => {
    if (error.code !== '23503') return error;
    if (error.constraint?.includes('category')) return new HttpError(400, 'التصنيف المختار غير موجود', 'CATEGORY_NOT_FOUND');
    if (error.constraint === 'center_services_center_fkey') return new HttpError(400, 'أحد المراكز المختارة غير موجود', 'CENTER_NOT_FOUND');
    return error;
};

// Only images uploaded through POST /api/upload/image (and still stored), or the website's own assets.
export const assertValidImage = async (imageUrl) => {
    if (!imageUrl || SITE_ASSET_PATTERN.test(imageUrl)) return;
    const key = keyFromPublicUrl(imageUrl);
    if (!key || !(await fileExists(key, IMAGE_KEY_PATTERN))) {
        throw new HttpError(400, 'الصورة غير موجودة، ارفعها مرة أخرى', 'IMAGE_NOT_FOUND');
    }
};

/**
 * Services newest first. Visitors never see 'inactive' ones; admins (includeHidden) see all
 * and may filter by any status.
 */
export const listServices = async ({ includeHidden = false, status, categoryId, search } = {}) => {
    const where = [];
    const params = [];
    const add = (sql, value) => {
        params.push(value);
        where.push(sql.replace('?', `$${params.length}`));
    };
    if (!includeHidden) add('s.status = ANY(?::service_status[])', PUBLIC_STATUSES);
    if (status) add('s.status = ?', status);
    if (categoryId) add('s.category_id = ?', categoryId);
    if (search) add('s.title ILIKE ?', `%${search.replace(/[%_\\]/g, '\\$&')}%`);
    const { rows } = await pool.query(
        `${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY s.id`,
        params
    );
    return rows.map(toService);
};

export const getService = async (id, { includeHidden = false } = {}) => {
    const { rows } = await pool.query(`${SELECT} WHERE s.id = $1`, [id]);
    if (!rows.length || (!includeHidden && !PUBLIC_STATUSES.includes(rows[0].status))) throw notFound();
    return toService(rows[0]);
};

const columnValues = (data) => [
    data.title, data.status, data.imageUrl, data.price, data.responseTime, data.duration, data.categoryId,
    data.fullDescription, data.shortDescription || buildShortDescription(data.fullDescription),
    JSON.stringify(data.outputs), JSON.stringify(data.workMethodology),
    JSON.stringify(data.targetAudience), JSON.stringify(data.includes), JSON.stringify(data.requiredAttachments),
];

// Inside a transaction: replaces the service's centers with exactly `centerIds`.
const replaceCenters = async (client, serviceId, centerIds) => {
    await client.query('DELETE FROM center_services WHERE service_id = $1', [serviceId]);
    if (centerIds.length) {
        await client.query(
            `INSERT INTO center_services (service_id, center_id)
             SELECT $1, unnest($2::varchar[])`,
            [serviceId, centerIds]
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

export const createService = async (data) => {
    await assertValidImage(data.imageUrl);
    const id = await inTransaction(async (client) => {
        const { rows } = await client.query(
            `INSERT INTO services (title, status, image_url, price, response_time, duration, category_id,
                 full_description, short_description, outputs, work_methodology, target_audience, includes,
                 required_attachments)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
             RETURNING id`,
            columnValues(data)
        );
        await replaceCenters(client, rows[0].id, data.centerIds);
        return rows[0].id;
    });
    return getService(id, { includeHidden: true });
};

export const updateService = async (id, data) => {
    await assertValidImage(data.imageUrl);
    await inTransaction(async (client) => {
        const { rowCount } = await client.query(
            `UPDATE services SET title = $2, status = $3, image_url = $4, price = $5, response_time = $6,
                 duration = $7, category_id = $8, full_description = $9, short_description = $10,
                 outputs = $11, work_methodology = $12, target_audience = $13, includes = $14,
                 required_attachments = $15,
                 updated_at = NOW()
             WHERE id = $1`,
            [id, ...columnValues(data)]
        );
        if (!rowCount) throw notFound();
        await replaceCenters(client, id, data.centerIds);
    });
    return getService(id, { includeHidden: true });
};

// center_services rows go with it (ON DELETE CASCADE).
export const deleteService = async (id) => {
    const { rowCount } = await pool.query('DELETE FROM services WHERE id = $1', [id]);
    if (!rowCount) throw notFound();
    return { id };
};

/**
 * Atomically counts one NGO request for a service. Meant to be called by the requests module
 * inside the same transaction that stores the request (pass its client), so the counter can
 * never drift from the real number of requests. Only active services accept requests.
 * @returns {Promise<number>} the new request_count
 */
export const incrementRequestCount = async (serviceId, client = pool) => {
    const { rows } = await client.query(
        `UPDATE services SET request_count = request_count + 1, updated_at = NOW()
         WHERE id = $1 AND status = 'active'
         RETURNING request_count`,
        [serviceId]
    );
    if (!rows.length) throw new HttpError(409, 'الخدمة غير متاحة للطلب حاليًا', 'SERVICE_NOT_REQUESTABLE');
    return rows[0].request_count;
};
