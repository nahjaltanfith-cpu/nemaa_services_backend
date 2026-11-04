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

// ── Request limits (per NGO; a null limit = none) ─────────────────────────────
const REQUEST_LIMITS = 'request_limits';
export const LIMIT_PERIODS = ['lifetime', 'yearly', 'monthly', 'custom'];
const PERIOD_LABELS = { lifetime: 'مدى الحياة', yearly: 'سنويًا', monthly: 'شهريًا', custom: 'فترة محددة' };

// Keeps only values the limit check understands; a missing row means no limits.
const normalizeRequestLimits = (value = {}) => {
    const limit = (number) => (Number.isInteger(number) && number > 0 ? number : null);
    const dated = value.period === 'custom' && value.periodFrom && value.periodTo;
    return {
        maxFreeServices: limit(value.maxFreeServices),
        maxTotalServices: limit(value.maxTotalServices),
        period: dated || (LIMIT_PERIODS.includes(value.period) && value.period !== 'custom') ? value.period : 'lifetime',
        periodFrom: dated ? value.periodFrom : null,
        periodTo: dated ? value.periodTo : null,
    };
};

export const getRequestLimits = async (client = pool) => {
    const { rows } = await client.query('SELECT value FROM app_settings WHERE key = $1', [REQUEST_LIMITS]);
    return normalizeRequestLimits(rows[0]?.value);
};

export const updateRequestLimits = async (value, actor) => {
    const settings = normalizeRequestLimits(value);
    await pool.query(
        `INSERT INTO app_settings (key, value, updated_at, updated_by_user_id) VALUES ($1, $2, NOW(), $3)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW(), updated_by_user_id = EXCLUDED.updated_by_user_id`,
        [REQUEST_LIMITS, JSON.stringify(settings), actor.id]
    );
    const period = settings.period === 'custom' ? `من ${settings.periodFrom} إلى ${settings.periodTo}` : PERIOD_LABELS[settings.period];
    await logActivity(null, {
        actorId: actor.id, action: 'settings.request_limits', entityType: 'settings', entityId: null,
        summary: `عدّل حدود الطلبات: المجانية ${settings.maxFreeServices ?? 'بدون حد'}، الإجمالي ${settings.maxTotalServices ?? 'بدون حد'}، الفترة: ${period}`,
        details: settings,
    });
    return settings;
};

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
