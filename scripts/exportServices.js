// Exports catalog services (by code) to a JSON file, to copy them to another database (e.g. local → VPS).
//
//   node scripts/exportServices.js MED-04 [GOV-02 ...] [--out scripts/seed-data/export.json]
//
// The file carries everything the service form saves, plus its category name and the ids of the
// centers that offer it; import it with scripts/importServices.js. Image files are not copied:
// a service with an uploaded image lists it under "imageUrl" so it can be copied by hand.
import { writeFile } from 'node:fs/promises';
import pool from '../db.js';

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const out = outIndex >= 0 ? args[outIndex + 1] : 'scripts/seed-data/services-export.json';
// Every argument except --out and its value is a service code
const codes = args.filter((arg, index) => !arg.startsWith('--') && (outIndex < 0 || index !== outIndex + 1))
    .map((code) => code.trim().toUpperCase()).filter(Boolean);
if (!codes.length) {
    console.error('Usage: node scripts/exportServices.js <CODE> [CODE ...] [--out file.json]');
    process.exit(1);
}

try {
    const { rows } = await pool.query(
        `SELECT s.*, c.name AS category_name,
                COALESCE((SELECT json_agg(cs.center_id ORDER BY cs.center_id) FROM center_services cs WHERE cs.service_id = s.id), '[]') AS center_ids
         FROM services s LEFT JOIN categories c ON c.id = s.category_id
         WHERE s.code = ANY($1) ORDER BY s.code`,
        [codes]
    );
    const missing = codes.filter((code) => !rows.some((row) => row.code === code));
    if (missing.length) console.warn(`[export] not found: ${missing.join(', ')}`);
    const services = rows.map((row) => ({
        code: row.code,
        title: row.title,
        status: row.status,
        imageUrl: row.image_url,
        price: row.price === null ? null : Number(row.price),
        isFree: row.is_free,
        rating: Number(row.rating),
        responseTime: row.response_time,
        duration: row.duration,
        category: row.category_name,
        fullDescription: row.full_description,
        shortDescription: row.short_description,
        outputs: row.outputs,
        workMethodology: row.work_methodology,
        targetAudience: row.target_audience,
        includes: row.includes,
        requiredAttachments: row.required_attachments,
        centerIds: row.center_ids,
    }));
    await writeFile(out, `${JSON.stringify({ exportedAt: new Date().toISOString(), services }, null, 2)}\n`);
    console.log(`[export] ${services.length} service(s) → ${out}`);
    for (const service of services) {
        if (service.imageUrl?.startsWith('/uploads/')) console.log(`[export] ${service.code} uses an uploaded image: copy uploads/${service.imageUrl.slice(9)} too`);
    }
} finally {
    await pool.end();
}
