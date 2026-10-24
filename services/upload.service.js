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

// Only keys this module generated are accepted back from clients.
export const TEMP_PDF_KEY_PATTERN = /^temp\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.pdf$/;

// ── Storage backend ─────────────────────────────────────────────────────────
// The only place that knows where files live. To move to S3 / R2, replace the bodies
// of storeFile / fileExists / publicUrl (PutObject, HeadObject, CDN or presigned URL)
// and keep their signatures; routes, controllers and DB rows only ever see keys.
export const publicUrl = (key) => `${UPLOADS_PUBLIC_PATH}/${key}`;

const storeFile = async (key, buffer) => {
    const target = path.join(UPLOADS_ROOT, key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, buffer, { flag: 'wx' }); // wx: never overwrite an existing file
    return { key, fileUrl: publicUrl(key) };
};

export const fileExists = async (key) => {
    if (!TEMP_PDF_KEY_PATTERN.test(key)) return false;
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

// Accepts one PDF in the `file` field and turns multer errors into the API's JSON envelope.
export const singlePdf = (field = 'file') => (req, res, next) => {
    pdfUpload.single(field)(req, res, (error) => {
        if (!error) return next();
        const [status, message] = error instanceof HttpError
            ? [error.status, error.message]
            : MULTER_ERRORS[error.code] ?? [400, 'تعذّر قراءة الملف المرفوع'];
        return res.status(status).json({ success: false, message, code: error.code, data: null });
    });
};
