// Imports services exported by scripts/exportServices.js into this database (e.g. on the VPS).
//
//   node scripts/importServices.js scripts/seed-data/services-export.json            add the missing ones
//   node scripts/importServices.js scripts/seed-data/services-export.json --dry-run  only show what would happen
//
// Safe to run more than once: a service whose code already exists is left untouched (admin edits are
// kept). The category is matched by name (created if missing); centers are linked only when they exist.
import { readFile } from 'node:fs/promises';
import pool from '../db.js';

const file = process.argv[2];
const dryRun = process.argv.includes('--dry-run');
if (!file) {
    console.error('Usage: node scripts/importServices.js <export.json> [--dry-run]');
    process.exit(1);
}
const { services } = JSON.parse(await readFile(file, 'utf8'));

const client = await pool.connect();
try {
    await client.query('BEGIN');
    for (const service of services) {
        const { rows: existing } = await client.query('SELECT id FROM services WHERE code = $1', [service.code]);
        if (existing.length) {
            console.log(`[import] ${service.code} «${service.title}»: already here (id ${existing[0].id}), skipped`);
            continue;
        }
        let categoryId = null;
        if (service.category) {
            const { rows } = await client.query(
                `INSERT INTO categories (name) VALUES ($1)
                 ON CONFLICT (lower(btrim(name))) DO UPDATE SET name = categories.name RETURNING id`,
                [service.category]
            );
            categoryId = rows[0].id;
        }
        const { rows } = await client.query(
            `INSERT INTO services (code, title, status, image_url, price, is_free, rating, response_time, duration, category_id,
                 full_description, short_description, outputs, work_methodology, target_audience, includes, required_attachments)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
             RETURNING id`,
            [service.code, service.title, service.status, service.imageUrl, service.price, Boolean(service.isFree), service.rating ?? 5,
                service.responseTime, service.duration, categoryId, service.fullDescription, service.shortDescription,
                JSON.stringify(service.outputs ?? []), JSON.stringify(service.workMethodology ?? []),
                JSON.stringify(service.targetAudience ?? []), JSON.stringify(service.includes ?? []),
                JSON.stringify(service.requiredAttachments ?? [])]
        );
        const id = rows[0].id;
        const { rows: centers } = await client.query('SELECT id FROM enablement_centers WHERE id = ANY($1)', [service.centerIds ?? []]);
        for (const center of centers) {
            await client.query('INSERT INTO center_services (center_id, service_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [center.id, id]);
        }
        const skipped = (service.centerIds ?? []).filter((centerId) => !centers.some((center) => center.id === centerId));
        console.log(`[import] ${service.code} «${service.title}»: added (id ${id})`
            + `${centers.length ? `, centers: ${centers.map((center) => center.id).join(', ')}` : ''}`
            + `${skipped.length ? ` · centers not found here: ${skipped.join(', ')}` : ''}`);
    }
    if (dryRun) {
        await client.query('ROLLBACK');
        console.log('[import] dry run: nothing was saved');
    } else {
        await client.query('COMMIT');
    }
} catch (error) {
    await client.query('ROLLBACK');
    console.error('[import] failed, nothing was saved:', error.message);
    process.exitCode = 1;
} finally {
    client.release();
    await pool.end();
}
