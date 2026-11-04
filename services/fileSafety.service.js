import zlib from 'node:zlib';
import { HttpError } from '../utils/httpError.js';

/**
 * Upload exceptions: file types an admin may allow beyond the default PDF (see app_settings
 * 'upload_exceptions'). Each type is recognised by its content, never by the name or the
 * client's MIME type, and Office files are opened (without being extracted) to refuse macros,
 * embedded programs and zip bombs. Formats that can carry code by design (SVG, HTML, legacy
 * .doc / .xls with macros, ZIP archives, executables) are not offered at all.
 */

const MB = 1024 * 1024;
// Memory ceiling for one exception upload, whatever the admin sets
export const EXCEPTION_HARD_MAX_MB = 50;

const startsWith = (buffer, text) => buffer.subarray(0, text.length).toString('latin1') === text;
const ZIP_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/** The types an admin can choose from: extension → label, MIME type and content check. */
export const EXCEPTION_TYPES = {
    pdf: { label: 'PDF', mime: 'application/pdf', check: (b) => startsWith(b, '%PDF-') },
    docx: { label: 'Word', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', check: (b) => checkOffice(b, 'word/') },
    xlsx: { label: 'Excel', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', check: (b) => checkOffice(b, 'xl/') },
    pptx: { label: 'PowerPoint', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', check: (b) => checkOffice(b, 'ppt/') },
    // Illustrator files are PDF-compatible (modern) or PostScript (older versions)
    ai: { label: 'Illustrator', mime: 'application/postscript', check: (b) => startsWith(b, '%PDF-') || startsWith(b, '%!PS-Adobe') },
    psd: { label: 'Photoshop', mime: 'image/vnd.adobe.photoshop', check: (b) => startsWith(b, '8BPS') },
    png: { label: 'PNG', mime: 'image/png', check: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
    jpg: { label: 'JPG', mime: 'image/jpeg', check: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
};
export const EXCEPTION_EXTENSIONS = Object.keys(EXCEPTION_TYPES);

// ── Office Open XML (docx / xlsx / pptx = a ZIP with a fixed layout) ────────
// Anything that can run: VBA macros, ActiveX controls, embedded OLE objects / programs and scripts.
const DANGEROUS_ENTRY = /(^|\/)(vbaProject\.bin|vbaData\.xml)$|(^|\/)activeX\/|oleObject\d*\.bin$|\.(exe|dll|com|scr|msi|bat|cmd|ps1|vbs|vbe|js|jse|wsf|hta|jar|lnk)$/i;
const MAX_ENTRIES = 5000;
const MAX_UNCOMPRESSED = 500 * MB;
const MAX_RATIO = 200;

const unsafe = (message) => new HttpError(415, message, 'UNSAFE_FILE');

// Lists the ZIP's entries from its central directory (nothing is extracted).
const zipEntries = (buffer) => {
    const searchFrom = Math.max(0, buffer.length - 65557);
    let eocd = -1;
    for (let i = buffer.length - 22; i >= searchFrom; i -= 1) {
        if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw unsafe('الملف تالف أو ليس ملف Office صالحًا');
    const count = buffer.readUInt16LE(eocd + 10);
    const offset = buffer.readUInt32LE(eocd + 16);
    // ZIP64 and multi-part archives are never produced by Office for normal documents
    if (count === 0xffff || offset === 0xffffffff || count > MAX_ENTRIES) throw unsafe('بنية الملف غير مدعومة');
    const entries = [];
    let at = offset;
    for (let i = 0; i < count; i += 1) {
        if (at + 46 > buffer.length || buffer.readUInt32LE(at) !== 0x02014b50) throw unsafe('الملف تالف أو ليس ملف Office صالحًا');
        const nameLength = buffer.readUInt16LE(at + 28);
        entries.push({
            method: buffer.readUInt16LE(at + 10),
            compressed: buffer.readUInt32LE(at + 20),
            size: buffer.readUInt32LE(at + 24),
            localOffset: buffer.readUInt32LE(at + 42),
            name: buffer.toString('utf8', at + 46, at + 46 + nameLength),
        });
        at += 46 + nameLength + buffer.readUInt16LE(at + 30) + buffer.readUInt16LE(at + 32);
    }
    return entries;
};

// Reads one small entry (stored or deflated), capped so a forged size can't blow up memory.
const readEntry = (buffer, entry) => {
    const at = entry.localOffset;
    if (at + 30 > buffer.length || buffer.readUInt32LE(at) !== 0x04034b50) throw unsafe('الملف تالف');
    const start = at + 30 + buffer.readUInt16LE(at + 26) + buffer.readUInt16LE(at + 28);
    const data = buffer.subarray(start, start + entry.compressed);
    if (entry.method === 0) return data.toString('utf8');
    if (entry.method === 8) return zlib.inflateRawSync(data, { maxOutputLength: 2 * MB }).toString('utf8');
    throw unsafe('بنية الملف غير مدعومة');
};

function checkOffice(buffer, folder) {
    if (!buffer.subarray(0, 4).equals(ZIP_SIGNATURE)) return false;
    const entries = zipEntries(buffer);
    const names = entries.map((entry) => entry.name);
    const contentTypes = entries.find((entry) => entry.name === '[Content_Types].xml');
    if (!contentTypes || !names.some((name) => name.startsWith(folder))) return false;
    const dangerous = names.find((name) => DANGEROUS_ENTRY.test(name));
    if (dangerous) throw unsafe('الملف يحتوي على ماكرو أو برنامج مضمّن، ولا يُسمح برفعه. احفظه بدون ماكرو وأعد المحاولة');
    // Zip bomb: a small upload that expands to gigabytes
    const total = entries.reduce((sum, entry) => sum + entry.size, 0);
    if (total > MAX_UNCOMPRESSED || total > buffer.length * MAX_RATIO) throw unsafe('بنية الملف غير آمنة');
    // Macro-enabled documents renamed to .docx / .xlsx / .pptx
    if (/macroEnabled|vbaProject/i.test(readEntry(buffer, contentTypes))) {
        throw unsafe('الملف يحتوي على ماكرو، ولا يُسمح برفعه. احفظه بدون ماكرو وأعد المحاولة');
    }
    return true;
}

/**
 * Checks an exception upload against the admin's settings and its real content.
 * @returns {{ ext: string, mime: string }}
 */
export const inspectExceptionFile = (file, settings) => {
    const ext = (file.originalname || '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || '';
    const type = EXCEPTION_TYPES[ext === 'jpeg' ? 'jpg' : ext];
    const normalized = ext === 'jpeg' ? 'jpg' : ext;
    if (!type || (normalized !== 'pdf' && !settings.types.includes(normalized))) {
        throw new HttpError(415, `صيغة الملف غير مسموحة. المسموح: ${allowedLabel(settings)}`, 'INVALID_FILE_TYPE');
    }
    if (file.size > settings.maxMb * MB) {
        throw new HttpError(413, `حجم الملف يتجاوز ${settings.maxMb} ميجابايت`, 'LIMIT_FILE_SIZE');
    }
    if (!type.check(file.buffer)) {
        throw new HttpError(415, `محتوى الملف لا يطابق صيغة ${type.label}`, 'INVALID_FILE_TYPE');
    }
    return { ext: normalized, mime: type.mime };
};

export const allowedLabel = (settings) =>
    ['pdf', ...settings.types.filter((ext) => ext !== 'pdf')].map((ext) => EXCEPTION_TYPES[ext]?.label || ext).join('، ');
