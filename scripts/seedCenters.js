// Seeds the enablement centers and their service links from scripts/seed-data/centers.json —
// the 6 centers the website used to ship as static data (EnablementCenters.vue, src/data/centers.js).
// Run after seed:services: links only point at services that exist; the services table is not touched.
//
//   npm run seed:centers            fill centers that were never edited (no overview yet), add missing links
//   npm run seed:centers -- --reset re-apply the seed values and links to the seeded centers
import { readFile } from 'node:fs/promises';
import pool from '../db.js';

const reset = process.argv.includes('--reset');
const data = JSON.parse(await readFile(new URL('./seed-data/centers.json', import.meta.url), 'utf8'));

const client = await pool.connect();
try {
    await client.query('BEGIN');

    let written = 0;
    const missing = [];
    for (const c of data.centers) {
        // seed:services creates the bare centers (id + title) first, so "missing" also means
        // "never given details": a center an admin already filled in is left alone without --reset.
        const { rowCount } = await client.query(
            `INSERT INTO enablement_centers (id, title, status, image_url, price, rating, response_time,
                 execution_duration, overview, short_description, outputs, methodology, target_audience)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
             ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, status = EXCLUDED.status,
                 image_url = EXCLUDED.image_url, price = EXCLUDED.price, rating = EXCLUDED.rating,
                 response_time = EXCLUDED.response_time, execution_duration = EXCLUDED.execution_duration,
                 overview = EXCLUDED.overview, short_description = EXCLUDED.short_description,
                 outputs = EXCLUDED.outputs, methodology = EXCLUDED.methodology,
                 target_audience = EXCLUDED.target_audience, updated_at = NOW()
             ${reset ? '' : 'WHERE enablement_centers.overview IS NULL'}`,
            [c.id, c.title, c.status, c.imageUrl, c.price, c.rating, c.responseTime, c.executionDuration,
                c.overview, c.shortDescription, JSON.stringify(c.outputs), JSON.stringify(c.methodology),
                JSON.stringify(c.targetAudience)]
        );
        written += rowCount;

        if (reset) await client.query('DELETE FROM center_services WHERE center_id = $1', [c.id]);
        const { rows: linked } = await client.query(
            `INSERT INTO center_services (center_id, service_id)
             SELECT $1, id FROM services WHERE id = ANY($2::int[])
             ON CONFLICT (service_id, center_id) DO UPDATE SET service_id = EXCLUDED.service_id
             RETURNING service_id`,
            [c.id, c.serviceIds]
        );
        const found = new Set(linked.map((row) => row.service_id));
        missing.push(...c.serviceIds.filter((id) => !found.has(id)).map((id) => `${c.id} → ${id}`));
    }

    await client.query('COMMIT');
    console.log(`[seed:centers] centers ${reset ? 'reset' : 'written'}: ${written}/${data.centers.length}`);
    if (missing.length) console.warn(`[seed:centers] skipped links to missing services: ${missing.join(', ')}`);
} catch (error) {
    await client.query('ROLLBACK');
    console.error('[seed:centers] Failed:', error.message);
    process.exitCode = 1;
} finally {
    client.release();
    await pool.end();
}
