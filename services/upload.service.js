import crypto from 'node:crypto';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import multer from 'multer';
import { HttpError } from '../utils/httpError.js';

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const PDF_MIME = 'application/pdf';
// Every real PDF starts with these bytes; the client-sent MIME type alone can be forged.
const PDF_SIGNATURE = Buffer.from('%PDF-');

export const UPLOADS_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'uploads');
export const UPLOADS_PUBLIC_PATH = '/uploads';
const TEMP_DIR = 'temp';

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
// Only keys this module generated are accepted back from clients.
export const TEMP_PDF_KEY_PATTERN = new RegExp(`^temp/${UUID}\\.pdf$`);
// Uploaded images, plus the fixed names used by the seed script (services/seed-01.png).
export const IMAGE_KEY_PATTERN = new RegExp(`^(images/${UUID}|services/seed-\\d{2})\\.(png|jpg|webp)$`);

// Accepted image formats, identified by their file signature (not the client's MIME type).
const IMAGE_TYPES = [
    { mime: 'image/png', ext: 'png', matches: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
    { mime: 'image/jpeg', ext: 'jpg', matches: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
    { mime: 'image/webp', ext: 'webp', matches: (b) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
];
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

// ── Storage backend ─────────────────────────────────────────────────────────
// The only place that knows where files live. To move to S3 / R2, replace the bodies
// of storeFile / fileExists / publicUrl (PutObject, HeadObject, CDN or presigned URL)
// and keep their signatures; routes, controllers and DB rows only ever see keys.
export const publicUrl = (key) => `${UPLOADS_PUBLIC_PATH}/${key}`;

// overwrite is only for seeding fixed keys; uploads always get a fresh UUID key.
export const storeFile = async (key, buffer, { overwrite = false } = {}) => {
    const target = path.join(UPLOADS_ROOT, key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, buffer, { flag: overwrite ? 'w' : 'wx' }); // wx: never overwrite an existing file
    return { key, fileUrl: publicUrl(key) };
};

export const fileExists = async (key, pattern = TEMP_PDF_KEY_PATTERN) => {
    if (!pattern.test(key)) return false;
    try {
        await access(path.join(UPLOADS_ROOT, key));
        return true;
    } catch {
        return false;
    }
};

/**
 * Validates an uploaded PDF and hands it to the storage backend.
 * @returns {Promise<{ key: string, fileUrl: string, size: number, originalName: string }>}
 */
export const saveTempPdf = async (file) => {
    if (!file) throw new HttpError(400, 'لم يتم إرفاق ملف (الحقل file)', 'FILE_REQUIRED');
    if (!file.buffer.subarray(0, PDF_SIGNATURE.length).equals(PDF_SIGNATURE)) {
        throw new HttpError(415, 'الملف ليس PDF صالحًا', 'INVALID_FILE_TYPE');
    }
    // The server-generated UUID is the whole name: nothing from the client reaches the filesystem.
    const key = `${TEMP_DIR}/${crypto.randomUUID()}.pdf`;
    const stored = await storeFile(key, file.buffer);
    return { ...stored, size: file.size, originalName: file.originalname };
};

/** Maps a public URL produced by publicUrl() back to its storage key, or null. */
export const keyFromPublicUrl = (url) =>
    typeof url === 'string' && url.startsWith(`${UPLOADS_PUBLIC_PATH}/`) ? url.slice(UPLOADS_PUBLIC_PATH.length + 1) : null;

/**
 * Validates an uploaded image (PNG / JPEG / WebP by signature) and stores it under images/.
 * @returns {Promise<{ key: string, fileUrl: string, size: number, originalName: string }>}
 */
export const saveImage = async (file) => {
    if (!file) throw new HttpError(400, 'لم يتم إرفاق صورة (الحقل file)', 'FILE_REQUIRED');
    const type = IMAGE_TYPES.find((candidate) => candidate.matches(file.buffer));
    if (!type) throw new HttpError(415, 'الصورة يجب أن تكون PNG أو JPG أو WebP', 'INVALID_FILE_TYPE');
    const stored = await storeFile(`images/${crypto.randomUUID()}.${type.ext}`, file.buffer);
    return { ...stored, size: file.size, originalName: file.originalname };
};

// ── Request parsing ─────────────────────────────────────────────────────────
// Memory storage keeps multer independent of the backend; 5 MB caps the buffer.
const pdfUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 5, parts: 6 },
    fileFilter: (req, file, cb) => {
        const isPdf = file.mimetype === PDF_MIME
            && path.extname(file.originalname || '').toLowerCase() === '.pdf';
        cb(isPdf ? null : new HttpError(415, 'يُسمح بملفات PDF فقط', 'INVALID_FILE_TYPE'), isPdf);
    },
});

const MULTER_ERRORS = {
    LIMIT_FILE_SIZE: [413, `حجم الملف يتجاوز ${MAX_UPLOAD_BYTES / 1024 / 1024} ميجابايت`],
    LIMIT_FILE_COUNT: [400, 'يُسمح بملف واحد فقط'],
    LIMIT_UNEXPECTED_FILE: [400, 'اسم الحقل يجب أن يكون file'],
};

const imageUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 5, parts: 6 },
    fileFilter: (req, file, cb) => {
        const ok = IMAGE_TYPES.some((type) => type.mime === file.mimetype);
        cb(ok ? null : new HttpError(415, 'الصورة يجب أن تكون PNG أو JPG أو WebP', 'INVALID_FILE_TYPE'), ok);
    },
});

// Runs a multer parser and turns its errors into the API's JSON envelope.
const parseSingle = (parser, field, sizeLimit) => (req, res, next) => {
    parser.single(field)(req, res, (error) => {
        if (!error) return next();
        const [status, message] = error instanceof HttpError
            ? [error.status, error.message]
            : error.code === 'LIMIT_FILE_SIZE'
                ? [413, `حجم الملف يتجاوز ${sizeLimit / 1024 / 1024} ميجابايت`]
                : MULTER_ERRORS[error.code] ?? [400, 'تعذّر قراءة الملف المرفوع'];
        return res.status(status).json({ success: false, message, code: error.code, data: null });
    });
};

// Accepts one PDF in the `file` field.
export const singlePdf = (field = 'file') => parseSingle(pdfUpload, field, MAX_UPLOAD_BYTES);
// Accepts one image in the `file` field.
export const singleImage = (field = 'file') => parseSingle(imageUpload, field, MAX_IMAGE_BYTES);
