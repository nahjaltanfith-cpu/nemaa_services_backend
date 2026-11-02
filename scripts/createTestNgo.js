// Creates a complete demo NGO account (both registration documents attached, email already verified),
// waiting for review with the status 'new', so it can sign in on the website and be reviewed from the dashboard.
//
//   node scripts/createTestNgo.js            create it
//   node scripts/createTestNgo.js --dry-run  only show what would happen
//
// Runs on every deploy (see .github/workflows/deploy.yml) but acts only once: a row in schema_migrations
// remembers it ran, so an admin who deletes the demo NGO does not get it back on the next push.
// Nothing is created either when the email or the registration number is already taken.
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import pool from '../db.js';
import { deleteFiles, storeFile } from '../services/upload.service.js';
import { registerMedia } from '../services/media.service.js';

const dryRun = process.argv.includes('--dry-run');

const NGO = {
    ngoName: 'جمعية نماء التجريبية للتنمية المجتمعية',
    regNumber: '1000990001',
    fieldOfWork: 'التنمية المجتمعية',
    region: 'الرياض',
    representativeName: 'عبدالله محمد العتيبي',
    position: 'المدير التنفيذي',
    email: 'demo.ngo@naama.org.sa',
    mobile: '0551234567',
    password: 'Naama@Demo2026',
};

// A one-page PDF with a single line of (ASCII) text, so the dashboard can preview the documents.
const makePdf = (text) => {
    const stream = `BT /F1 24 Tf 72 760 Td (${text}) Tj ET`;
    const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
        `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    ];
    let body = '%PDF-1.4\n';
    const offsets = objects.map((object, index) => {
        const offset = body.length;
        body += `${index + 1} 0 obj\n${object}\nendobj\n`;
        return offset;
    });
    const xref = body.length;
    body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
    body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(body, 'latin1');
};

const DOCUMENTS = [
    { column: 'ngo_document_key', name: 'ngo_registration_certificate.pdf', text: 'Demo NGO - Registration Certificate' },
    { column: 'representative_proof_key', name: 'representative_authorization.pdf', text: 'Demo NGO - Representative Authorization' },
];

const MARKER = 'seed:demo-ngo';
const stored = [];
const client = await pool.connect();
try {
    const { rows: done } = await client.query('SELECT 1 FROM schema_migrations WHERE filename = $1', [MARKER]);
    const { rows: taken } = await client.query(
        'SELECT id, email, reg_number FROM ngos WHERE email = $1 OR reg_number = $2', [NGO.email, NGO.regNumber]);
    if (done.length) {
        console.log('[demo-ngo] already created on an earlier deploy: nothing to do');
    } else if (taken.length) {
        console.log(`[demo-ngo] already here (id ${taken[0].id}, ${taken[0].email}): nothing created`);
    } else {
        const { rows: regions } = await client.query('SELECT id FROM regions WHERE name = $1', [NGO.region]);
        if (!regions.length) throw new Error(`region «${NGO.region}» not found`);

        const keys = {};
        for (const document of DOCUMENTS) {
            const buffer = makePdf(document.text);
            keys[document.column] = `temp/${crypto.randomUUID()}.pdf`;
            if (!dryRun) {
                await storeFile(keys[document.column], buffer);
                stored.push(keys[document.column]);
                await registerMedia({ key: keys[document.column], originalName: document.name, mimeType: 'application/pdf', buffer });
            }
        }

        await client.query('BEGIN');
        const { rows } = await client.query(
            `INSERT INTO ngos (ngo_name, reg_number, field_of_work, representative_name, position, email, mobile,
                 password, account_status, ngo_document_key, representative_proof_key, region_id, email_verified_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'new', $9, $10, $11, NOW())
             RETURNING id`,
            [NGO.ngoName, NGO.regNumber, NGO.fieldOfWork, NGO.representativeName, NGO.position, NGO.email, NGO.mobile,
                await bcrypt.hash(NGO.password, 12), keys.ngo_document_key, keys.representative_proof_key, regions[0].id]
        );
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [MARKER]);
        if (dryRun) {
            await client.query('ROLLBACK');
            console.log('[demo-ngo] dry run: nothing was saved');
        } else {
            await client.query('COMMIT');
            console.log(`[demo-ngo] created (id ${rows[0].id}) with status 'new'`);
            console.log(`[demo-ngo] email: ${NGO.email} · password: ${NGO.password}`);
        }
    }
} catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    await deleteFiles(stored);
    console.error('[demo-ngo] failed, nothing was saved:', error.message);
    process.exitCode = 1;
} finally {
    client.release();
    await pool.end();
}
