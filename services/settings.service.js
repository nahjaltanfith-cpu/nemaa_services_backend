import pool from '../db.js';
import { logActivity } from './activityLog.service.js';
import { EXCEPTION_EXTENSIONS, EXCEPTION_HARD_MAX_MB } from './fileSafety.service.js';

/** Platform settings the admin edits from the dashboard (table app_settings, migration 037). */

const UPLOAD_EXCEPTIONS = 'upload_exceptions';
// Used when the row is missing (e.g. before the migration ran): exceptions off
const UPLOAD_DEFAULTS = { enabled: false, maxMb: 20, types: [] };

// Keeps only values the upload code understands, whatever is stored
const normalizeUploads = (value = {}) => ({
    enabled: Boolean(value.enabled),
    maxMb: Math.min(EXCEPTION_HARD_MAX_MB, Math.max(5, Math.round(Number(value.maxMb) || UPLOAD_DEFAULTS.maxMb))),
    types: [...new Set((value.types || []).filter((ext) => EXCEPTION_EXTENSIONS.includes(ext) && ext !== 'pdf'))],
});

export const getUploadExceptions = async () => {
    const { rows } = await pool.query('SELECT value FROM app_settings WHERE key = $1', [UPLOAD_EXCEPTIONS]);
    return normalizeUploads(rows[0]?.value ?? UPLOAD_DEFAULTS);
};

export const updateUploadExceptions = async (value, actor) => {
    const settings = normalizeUploads(value);
    await pool.query(
        `INSERT INTO app_settings (key, value, updated_at, updated_by_user_id) VALUES ($1, $2, NOW(), $3)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW(), updated_by_user_id = EXCLUDED.updated_by_user_id`,
        [UPLOAD_EXCEPTIONS, JSON.stringify(settings), actor.id]
    );
    await logActivity(null, {
        actorId: actor.id, action: 'settings.uploads', entityType: 'file', entityId: null,
        summary: settings.enabled
            ? `عدّل استثناءات رفع الملفات: حتى ${settings.maxMb} ميجابايت، الصيغ: ${settings.types.join('، ') || 'PDF فقط'}`
            : 'أوقف استثناءات رفع الملفات',
        details: settings,
    });
    return settings;
};
