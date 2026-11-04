import crypto from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import pool from '../db.js';
import { HttpError } from '../utils/httpError.js';
import { countsBy, likeTerm, pageSql } from '../utils/pagination.js';
import { logActivity } from './activityLog.service.js';
import { UPLOADS_PUBLIC_PATH, UPLOADS_ROOT, deleteFiles, publicUrl } from './upload.service.js';
import { EXCEPTION_TYPES } from './fileSafety.service.js';

/**
 * Media registry (table media_files): what is stored, how big it is, and what uses it.
 * The domain tables stay the source of truth for usage; `syncMediaRegistry` derives each file's
 * owner / usage / status from them, so no domain service has to report attach / detach events.
 */

const MIME_BY_EXT = {
    ...Object.fromEntries(Object.entries(EXCEPTION_TYPES).map(([ext, type]) => [ext, type.mime])),
    jpeg: 'image/jpeg', webp: 'image/webp',
};
const mimeOf = (key) => MIME_BY_EXT[path.extname(key).slice(1).toLowerCase()] || 'application/octet-stream';
const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const GRACE_HOURS = Number(process.env.MEDIA_CLEANUP_HOURS) || 24;
// Used by both the sync and the cleanup jobs (and safe across several PM2 instances)
const JOB_LOCK = 7351;

// ── Registering uploads ─────────────────────────────────────────────────────
/**
 * Records a freshly stored file as 'pending' (nothing uses it yet). Never throws: the upload itself
 * already succeeded, and the next sync would register the file anyway.
 * uploader: { userId } for staff, { ngoId } for an NGO, {} when anonymous (sign-up documents).
 */
export const registerMedia = async ({ key, originalName, mimeType, buffer, size, isException = false }, uploader = {}) => {
    try {
        await pool.query(
            `INSERT INTO media_files (storage_key, original_name, mime_type, size_bytes, sha256, uploaded_by_user_id, uploaded_by_ngo_id, is_exception)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (storage_key) DO NOTHING`,
            [key, originalName?.slice(0, 255) || null, mimeType || mimeOf(key), size ?? buffer?.length ?? 0,
                buffer ? sha256(buffer) : null, uploader.userId || null, uploader.ngoId || null, isException]
        );
    } catch (error) {
        console.error('[media] could not register', key, error.message);
    }
};

// ── Where files are used (the one list of file-holding columns) ─────────────
// Images are stored as public URLs (/uploads/<key>), documents as keys.
const URL_KEY = (column) => `substr(${column}, ${UPLOADS_PUBLIC_PATH.length + 2})`;
const URL_REF = (column) => `${column} LIKE '${UPLOADS_PUBLIC_PATH}/%'`;
const REFERENCES_SQL = `
    SELECT f.file_key AS key,
           CASE f.kind WHEN 'ngo' THEN 'request_attachment' WHEN 'completion' THEN 'request_completion' ELSE 'request_deliverable' END AS usage,
           'request' AS owner_type, f.request_id::text AS owner_id, f.original_name
    FROM request_files f
    UNION ALL SELECT ngo_document_key, 'ngo_document', 'ngo', id::text, NULL FROM ngos WHERE ngo_document_key IS NOT NULL
    UNION ALL SELECT representative_proof_key, 'ngo_proof', 'ngo', id::text, NULL FROM ngos WHERE representative_proof_key IS NOT NULL
    UNION ALL SELECT ${URL_KEY('avatar_url')}, 'ngo_avatar', 'ngo', id::text, NULL FROM ngos WHERE ${URL_REF('avatar_url')}
    UNION ALL SELECT ${URL_KEY('avatar_url')}, 'staff_avatar', 'staff', id::text, NULL FROM users WHERE ${URL_REF('avatar_url')}
    UNION ALL SELECT ${URL_KEY('image_url')}, 'service_image', 'service', id::text, NULL FROM services WHERE ${URL_REF('image_url')}
    UNION ALL SELECT ${URL_KEY('image_url')}, 'center_image', 'center', id::text, NULL FROM enablement_centers WHERE ${URL_REF('image_url')}`;

// ── Sync (registry ← storage + domain tables) ───────────────────────────────
const walk = async (dir, prefix = '') => {
    let entries = [];
    try {
        entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
    }
    const files = await Promise.all(entries.map(async (entry) => {
        const key = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) return walk(path.join(dir, entry.name), key);
        return entry.isFile() ? [key] : [];
    }));
    return files.flat();
};

/** Registers files found in storage that the registry does not know yet; flags rows whose file is gone. */
const scanStorage = async (client) => {
    const keys = await walk(UPLOADS_ROOT);
    const { rows } = await client.query('SELECT storage_key, status FROM media_files');
    const known = new Map(rows.map((row) => [row.storage_key, row.status]));
    for (const key of keys) {
        if (known.has(key)) continue;
        const full = path.join(UPLOADS_ROOT, key);
        const info = await stat(full);
        await client.query(
            `INSERT INTO media_files (storage_key, mime_type, size_bytes, sha256, created_at, source)
             VALUES ($1, $2, $3, $4, $5, 'scan') ON CONFLICT (storage_key) DO NOTHING`,
            [key, mimeOf(key), info.size, sha256(await readFile(full)), info.mtime]
        );
    }
    const onDisk = new Set(keys);
    const gone = rows.filter((row) => row.status !== 'deleted' && row.status !== 'missing' && !onDisk.has(row.storage_key))
        .map((row) => row.storage_key);
    if (gone.length) await client.query("UPDATE media_files SET status = 'missing' WHERE storage_key = ANY($1)", [gone]);
    const back = rows.filter((row) => row.status === 'missing' && onDisk.has(row.storage_key)).map((row) => row.storage_key);
    if (back.length) await client.query("UPDATE media_files SET status = 'pending' WHERE storage_key = ANY($1)", [back]);
    return { scanned: keys.length };
};

/** Derives owner / usage / status of every registered file from the domain tables. */
const reconcile = async (client) => {
    // Used now → attached (first reference wins when a file is shared, e.g. a seeded image)
    await client.query(`
        WITH refs AS (SELECT DISTINCT ON (key) * FROM (${REFERENCES_SQL}) r WHERE key IS NOT NULL ORDER BY key)
        UPDATE media_files m
        SET status = 'attached', usage = refs.usage, owner_type = refs.owner_type, owner_id = refs.owner_id,
            original_name = COALESCE(m.original_name, refs.original_name),
            attached_at = COALESCE(m.attached_at, NOW()), released_at = NULL
        FROM refs
        WHERE m.storage_key = refs.key AND m.status IN ('pending', 'attached', 'orphaned')
          AND (m.status <> 'attached' OR m.usage IS DISTINCT FROM refs.usage OR m.owner_type IS DISTINCT FROM refs.owner_type
               OR m.owner_id IS DISTINCT FROM refs.owner_id OR (m.original_name IS NULL AND refs.original_name IS NOT NULL))`);
    // Was used, no longer is → orphaned (the cleanup removes it after the grace period)
    await client.query(`
        UPDATE media_files SET status = 'orphaned', released_at = NOW()
        WHERE status = 'attached' AND storage_key NOT IN (SELECT key FROM (${REFERENCES_SQL}) r WHERE key IS NOT NULL)`);
};

/** Runs under a DB advisory lock so concurrent instances / jobs never overlap. */
const withJobLock = async (work) => {
    const client = await pool.connect();
    try {
        const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [JOB_LOCK]);
        if (!rows[0].ok) return null;
        try {
            return await work(client);
        } finally {
            await client.query('SELECT pg_advisory_unlock($1)', [JOB_LOCK]);
        }
    } finally {
        client.release();
    }
};

export const syncMediaRegistry = ({ scanDisk = false } = {}) => withJobLock(async (client) => {
    const scan = scanDisk ? await scanStorage(client) : null;
    await reconcile(client);
    return { scan };
});

// Removes the given unused rows' files from storage and marks them deleted
const removeUnused = async (client, rows) => {
    if (!rows.length) return { removed: 0, bytes: 0 };
    await deleteFiles(rows.map((row) => row.storage_key));
    await client.query("UPDATE media_files SET status = 'deleted', deleted_at = NOW() WHERE id = ANY($1)", [rows.map((row) => row.id)]);
    return { removed: rows.length, bytes: rows.reduce((sum, row) => sum + Number(row.size_bytes), 0) };
};

// What the automatic cleanup removes: unused after the grace period, but only uploads registered by the
// registry or files released after tracking; files found by the storage scan wait for an admin (purgeUnused).
export const AUTO_CLEANUP_WHERE = `status IN ('pending', 'orphaned') AND (source = 'upload' OR status = 'orphaned')
    AND COALESCE(released_at, created_at) < NOW() - ($1 || ' hours')::interval`;

/** The hourly cleanup. Usage is re-derived first, so a file attached in the meantime is kept. */
export const cleanupMedia = () => withJobLock(async (client) => {
    await reconcile(client);
    const { rows } = await client.query(
        `SELECT id, storage_key, size_bytes FROM media_files WHERE ${AUTO_CLEANUP_WHERE}`, [String(GRACE_HOURS)]
    );
    return removeUnused(client, rows);
});

/**
 * An admin's "delete every unused file": all pending / orphaned files older than an hour
 * (an hour so a form being filled right now keeps its uploads). Logged in the activity log.
 */
export const purgeUnused = async (actor) => {
    const result = await withJobLock(async (client) => {
        await reconcile(client);
        const { rows } = await client.query(
            `SELECT id, storage_key, size_bytes FROM media_files
             WHERE status IN ('pending', 'orphaned') AND COALESCE(released_at, created_at) < NOW() - INTERVAL '1 hour'`
        );
        return removeUnused(client, rows);
    });
    if (!result) throw new HttpError(409, 'تنظيف آخر يعمل الآن، حاول بعد قليل', 'CLEANUP_RUNNING');
    if (result.removed) {
        await logActivity(null, {
            actorId: actor.id, action: 'file.purge', entityType: 'file', entityId: null,
            summary: `حذف ${result.removed} ملفًا غير مستخدم (${(result.bytes / 1024 / 1024).toFixed(2)} MB)`,
            details: result,
        });
    }
    return result;
};

/** Background jobs: a full scan at start, a usage sync every 10 minutes, the cleanup every hour. */
export const startMediaJobs = () => {
    if (process.env.MEDIA_JOBS === 'off') return;
    const run = (job, label) => job().catch((error) => console.error(`[media] ${label} failed:`, error.message));
    setTimeout(() => run(() => syncMediaRegistry({ scanDisk: true }), 'initial sync'), 5000).unref();
    setInterval(() => run(() => syncMediaRegistry(), 'sync'), 10 * 60 * 1000).unref();
    setInterval(() => run(cleanupMedia, 'cleanup'), 60 * 60 * 1000).unref();
};

// ── Admin: list, stats, delete ──────────────────────────────────────────────
const TYPE_SQL = {
    pdf: "m.mime_type = 'application/pdf'",
    image: "m.mime_type LIKE 'image/%'",
    other: "m.mime_type <> 'application/pdf' AND m.mime_type NOT LIKE 'image/%'",
};
const SORT_SQL = {
    size_desc: 'm.size_bytes DESC, m.id DESC',
    size_asc: 'm.size_bytes ASC, m.id DESC',
    date_desc: 'm.created_at DESC, m.id DESC',
    date_asc: 'm.created_at ASC, m.id ASC',
};

// The file plus a readable "used in" (request ref + NGO, NGO, staff member, service, center) and its uploader
const LIST_SELECT = `
    SELECT m.*, sr.ref_code AS request_ref, sr.ngo_id AS request_ngo_id, rn.ngo_name AS request_ngo_name,
           ng.ngo_name AS ngo_name, us.name AS staff_name, sv.title AS service_title, ce.title AS center_title,
           up.name AS uploader_name, upn.ngo_name AS uploader_ngo_name
    FROM media_files m
    LEFT JOIN service_requests sr ON m.owner_type = 'request' AND sr.id::text = m.owner_id
    LEFT JOIN ngos rn ON rn.id = sr.ngo_id
    LEFT JOIN ngos ng ON m.owner_type = 'ngo' AND ng.id::text = m.owner_id
    LEFT JOIN users us ON m.owner_type = 'staff' AND us.id::text = m.owner_id
    LEFT JOIN services sv ON m.owner_type = 'service' AND sv.id::text = m.owner_id
    LEFT JOIN enablement_centers ce ON m.owner_type = 'center' AND ce.id = m.owner_id
    LEFT JOIN users up ON up.id = m.uploaded_by_user_id
    LEFT JOIN ngos upn ON upn.id = m.uploaded_by_ngo_id`;

const ownerOf = (row) => {
    if (!row.owner_type) return null;
    const base = { type: row.owner_type, id: row.owner_id };
    switch (row.owner_type) {
        case 'request': return { ...base, label: row.request_ref, ngoId: row.request_ngo_id, ngoName: row.request_ngo_name };
        case 'ngo': return { ...base, label: row.ngo_name };
        case 'staff': return { ...base, label: row.staff_name };
        case 'service': return { ...base, label: row.service_title };
        case 'center': return { ...base, label: row.center_title };
        default: return base;
    }
};

const toMedia = (row) => ({
    id: row.id,
    key: row.storage_key,
    url: row.status === 'deleted' || row.status === 'missing' ? null : publicUrl(row.storage_key),
    provider: row.provider,
    name: row.original_name || path.basename(row.storage_key),
    mimeType: row.mime_type,
    size: Number(row.size_bytes),
    usage: row.usage,
    status: row.status,
    source: row.source,
    isException: Boolean(row.is_exception),
    owner: row.status === 'attached' ? ownerOf(row) : null,
    uploadedBy: row.uploader_name || row.uploader_ngo_name || null,
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
});

/** One page of files. Deleted ones only when asked for (status=deleted). */
export const listMedia = async ({ search, type, usage, status, sort = 'size_desc', page = 1, pageSize = 25 } = {}) => {
    const params = [];
    const where = [];
    const add = (sql, value) => {
        params.push(value);
        where.push(sql.replaceAll('?', `$${params.length}`));
    };
    if (status) add('m.status = ?', status);
    else where.push("m.status <> 'deleted'");
    if (type && TYPE_SQL[type]) where.push(TYPE_SQL[type]);
    if (usage) add('m.usage = ?', usage);
    if (search) {
        add(`(m.original_name ILIKE ? OR m.storage_key ILIKE ? OR sr.ref_code ILIKE ? OR rn.ngo_name ILIKE ?
              OR ng.ngo_name ILIKE ? OR us.name ILIKE ? OR sv.title ILIKE ? OR ce.title ILIKE ?)`, likeTerm(search));
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const pageParams = [...params];
    const limit = pageSql(pageParams, { page, pageSize });
    const [{ rows }, { rows: totalRows }, { rows: statusRows }] = await Promise.all([
        pool.query(`${LIST_SELECT} ${whereSql} ORDER BY ${SORT_SQL[sort] || SORT_SQL.size_desc} ${limit}`, pageParams),
        pool.query(`SELECT COUNT(*) AS count FROM (${LIST_SELECT} ${whereSql}) x`, params),
        pool.query('SELECT status AS key, COUNT(*) AS count FROM media_files GROUP BY status'),
    ]);
    const byStatus = countsBy(statusRows);
    return {
        items: rows.map(toMedia),
        total: Number(totalRows[0].count),
        page,
        pageSize,
        counts: {
            all: Object.entries(byStatus).filter(([key]) => key !== 'deleted').reduce((sum, [, count]) => sum + count, 0),
            status: byStatus,
        },
    };
};

/** Storage totals for the stats card: overall, per file type, unused (reclaimable), freed so far. */
export const mediaStats = async () => {
    const { rows } = await pool.query(`
        SELECT
            COUNT(*) FILTER (WHERE status <> 'deleted') AS files,
            COALESCE(SUM(size_bytes) FILTER (WHERE status <> 'deleted' AND status <> 'missing'), 0) AS bytes,
            COUNT(*) FILTER (WHERE status <> 'deleted' AND mime_type = 'application/pdf') AS pdf_files,
            COALESCE(SUM(size_bytes) FILTER (WHERE status NOT IN ('deleted', 'missing') AND mime_type = 'application/pdf'), 0) AS pdf_bytes,
            COUNT(*) FILTER (WHERE status <> 'deleted' AND mime_type LIKE 'image/%') AS image_files,
            COALESCE(SUM(size_bytes) FILTER (WHERE status NOT IN ('deleted', 'missing') AND mime_type LIKE 'image/%'), 0) AS image_bytes,
            COUNT(*) FILTER (WHERE status IN ('pending', 'orphaned')) AS unused_files,
            COALESCE(SUM(size_bytes) FILTER (WHERE status IN ('pending', 'orphaned')), 0) AS unused_bytes,
            COUNT(*) FILTER (WHERE status = 'missing') AS missing_files,
            COUNT(*) FILTER (WHERE status = 'deleted') AS deleted_files,
            COALESCE(SUM(size_bytes) FILTER (WHERE status = 'deleted'), 0) AS freed_bytes
        FROM media_files`);
    const row = rows[0];
    const n = (value) => Number(value);
    return {
        total: { files: n(row.files), bytes: n(row.bytes) },
        pdf: { files: n(row.pdf_files), bytes: n(row.pdf_bytes) },
        image: { files: n(row.image_files), bytes: n(row.image_bytes) },
        unused: { files: n(row.unused_files), bytes: n(row.unused_bytes) },
        missing: { files: n(row.missing_files) },
        deleted: { files: n(row.deleted_files), bytes: n(row.freed_bytes) },
        cleanupAfterHours: GRACE_HOURS,
    };
};

// Registration documents are what NGO approval is based on: never removed from here
const PROTECTED_USAGES = new Set(['ngo_document', 'ngo_proof']);

/**
 * Detaches a file from everything that uses it, then removes it from storage.
 * Request files lose their row (a completion file's item goes back to "waiting");
 * images / avatars are cleared. NGO registration documents can't be deleted.
 */
export const deleteMedia = async (id, actor, { force = false } = {}) => {
    const client = await pool.connect();
    let file;
    try {
        await client.query('BEGIN');
        const { rows } = await client.query('SELECT * FROM media_files WHERE id = $1 FOR UPDATE', [id]);
        file = rows[0];
        if (!file || file.status === 'deleted') throw new HttpError(404, 'الملف غير موجود', 'NOT_FOUND');
        // Fresh usage straight from the domain tables, not the last sync
        const { rows: refs } = await client.query(`SELECT * FROM (${REFERENCES_SQL}) r WHERE key = $1`, [file.storage_key]);
        if (refs.some((ref) => PROTECTED_USAGES.has(ref.usage))) {
            throw new HttpError(409, 'هذا مستند تسجيل إلزامي للجمعية ولا يمكن حذفه من هنا', 'PROTECTED_FILE');
        }
        if (refs.length && !force) {
            throw new HttpError(409, 'الملف مستخدم حاليًا، وحذفه يحتاج تأكيدًا إضافيًا', 'FILE_IN_USE');
        }
        const url = publicUrl(file.storage_key);
        const { rows: removedFiles } = await client.query(
            'DELETE FROM request_files WHERE file_key = $1 RETURNING request_id, missing_item_id', [file.storage_key]
        );
        for (const removed of removedFiles) {
            if (removed.missing_item_id) {
                await client.query('UPDATE request_missing_items SET fulfilled_at = NULL WHERE id = $1', [removed.missing_item_id]);
            }
            await client.query('UPDATE service_requests SET updated_at = NOW() WHERE id = $1', [removed.request_id]);
        }
        await client.query('UPDATE ngos SET avatar_url = NULL WHERE avatar_url = $1', [url]);
        await client.query('UPDATE users SET avatar_url = NULL WHERE avatar_url = $1', [url]);
        await client.query('UPDATE services SET image_url = NULL WHERE image_url = $1', [url]);
        await client.query('UPDATE enablement_centers SET image_url = NULL WHERE image_url = $1', [url]);
        await client.query(
            "UPDATE media_files SET status = 'deleted', deleted_at = NOW(), released_at = COALESCE(released_at, NOW()) WHERE id = $1", [id]
        );
        const sizeMb = (Number(file.size_bytes) / 1024 / 1024).toFixed(2);
        await logActivity(client, {
            actorId: actor.id, action: 'file.delete', entityType: 'file', entityId: id,
            summary: `حذف الملف «${file.original_name || path.basename(file.storage_key)}» (${sizeMb} MB)${refs.length ? ` المستخدم في ${refs.length} موضع` : ''}`,
            details: { key: file.storage_key, size: Number(file.size_bytes), usages: refs.map((ref) => ({ usage: ref.usage, ownerType: ref.owner_type, ownerId: ref.owner_id })) },
        });
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
    // Storage last, once the DB no longer points at the file
    await deleteFiles([file.storage_key]);
    return { id };
};
