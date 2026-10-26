// Seeds categories, centers and services from scripts/seed-data/services.json — the same
// data the website used to ship as mock files (src/data/services.js, src/data/centers.js).
//
//   npm run seed:services            insert what is missing, keep admin edits
//   npm run seed:services -- --reset re-apply the seed values to the seeded services
import { readFile } from 'node:fs/promises';
import pool from '../db.js';

const reset = process.argv.includes('--reset');
const data = JSON.parse(await readFile(new URL('./seed-data/services.json', import.meta.url), 'utf8'));

const client = await pool.connect();
try {
    await client.query('BEGIN');

    // Categories, matched by name the same way the unique index does.
    const categoryIds = {};
    for (const { name } of data.categories) {
        const { rows } = await client.query(
            `INSERT INTO categories (name) VALUES ($1)
             ON CONFLICT (lower(btrim(name))) DO UPDATE SET name = categories.name
             RETURNING id`,
            [name]
        );
        categoryIds[name] = rows[0].id;
    }

    for (const center of data.centers) {
        await client.query(
            `INSERT INTO enablement_centers (id, title) VALUES ($1, $2)
             ON CONFLICT (id) DO ${reset ? 'UPDATE SET title = EXCLUDED.title, updated_at = NOW()' : 'NOTHING'}`,
            [center.id, center.title]
        );
    }

    // Services keep their mock ids so existing links (/services/1 …) stay valid.
    let inserted = 0;
    for (const s of data.services) {
        const { rowCount } = await client.query(
            `INSERT INTO services (id, title, status, image_url, price, request_count, rating, response_time,
                 duration, category_id, full_description, short_description, outputs, work_methodology,
                 target_audience, includes, required_attachments)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
             ON CONFLICT (id) DO ${reset ? `UPDATE SET title = EXCLUDED.title, status = EXCLUDED.status,
                 image_url = EXCLUDED.image_url, price = EXCLUDED.price, request_count = EXCLUDED.request_count,
                 rating = EXCLUDED.rating, response_time = EXCLUDED.response_time, duration = EXCLUDED.duration,
                 category_id = EXCLUDED.category_id, full_description = EXCLUDED.full_description,
                 short_description = EXCLUDED.short_description, outputs = EXCLUDED.outputs,
                 work_methodology = EXCLUDED.work_methodology, target_audience = EXCLUDED.target_audience,
                 includes = EXCLUDED.includes, required_attachments = EXCLUDED.required_attachments,
                 updated_at = NOW()` : 'NOTHING'}`,
            [s.id, s.title, s.status, s.imageUrl, s.price, s.requestCount, s.rating, s.responseTime,
                s.duration, categoryIds[s.category], s.fullDescription, s.shortDescription,
                JSON.stringify(s.outputs), JSON.stringify(s.workMethodology),
                JSON.stringify(s.targetAudience), JSON.stringify(s.includes),
                JSON.stringify(s.requiredAttachments || [])]
        );
        inserted += rowCount;
        if (reset) await client.query('DELETE FROM center_services WHERE service_id = $1', [s.id]);
        for (const centerId of s.centerIds) {
            await client.query(
                'INSERT INTO center_services (service_id, center_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                [s.id, centerId]
            );
        }
    }

    // Explicit ids bypass the sequence; move it past them so new services don't collide.
    await client.query(`SELECT setval(pg_get_serial_sequence('services', 'id'), GREATEST((SELECT MAX(id) FROM services), 1))`);

    await client.query('COMMIT');
    console.log(`[seed:services] categories: ${data.categories.length}, centers: ${data.centers.length}, `
        + `services ${reset ? 'reset' : 'inserted'}: ${inserted}/${data.services.length}`);
} catch (error) {
    await client.query('ROLLBACK');
    console.error('[seed:services] Failed:', error.message);
    process.exitCode = 1;
} finally {
    client.release();
    await pool.end();
}
