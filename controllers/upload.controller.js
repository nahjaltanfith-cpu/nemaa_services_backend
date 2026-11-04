import { registerMedia } from '../services/media.service.js';
import { MAX_UPLOAD_BYTES, saveExceptionFile, saveImage, saveTempDocument, saveTempPdf } from '../services/upload.service.js';
import { EXCEPTION_TYPES } from '../services/fileSafety.service.js';
import { getUploadExceptions } from '../services/settings.service.js';
import { HttpError } from '../utils/httpError.js';

const respondWith = (save) => async (req, res) => {
    try {
        const file = await save(req.file, req.uploadSettings);
        // The registry learns about it now (as 'pending' until something uses it)
        const uploader = !req.user ? {} : req.user.role === 'ngo' ? { ngoId: req.user.id } : { userId: req.user.id };
        await registerMedia({ ...file, buffer: req.file.buffer }, uploader);
        return res.status(201).json({
            success: true, message: 'تم رفع الملف بنجاح', fileUrl: file.fileUrl, data: file,
        });
    } catch (error) {
        if (error instanceof HttpError) {
            return res.status(error.status).json({
                success: false, message: error.message, code: error.code, data: null,
            });
        }
        console.error('[upload]:', error);
        return res.status(500).json({ success: false, message: 'تعذّر حفظ الملف، حاول مرة أخرى', data: null });
    }
};

export const uploadFile = respondWith(saveTempPdf);
export const uploadImage = respondWith(saveImage);
export const uploadDocument = respondWith(saveTempDocument);
export const uploadException = respondWith(saveExceptionFile);

// What the upload screens may offer as an exception (the default stays PDF up to 5 MB)
export const exceptionSettings = async (req, res, next) => {
    try {
        const settings = await getUploadExceptions();
        return res.json({
            success: true, message: 'تم جلب إعدادات الرفع',
            data: {
                enabled: settings.enabled,
                maxMb: settings.maxMb,
                defaultMb: MAX_UPLOAD_BYTES / 1024 / 1024,
                types: settings.types.map((ext) => ({ ext, label: EXCEPTION_TYPES[ext].label })),
            },
        });
    } catch (error) {
        return next(error);
    }
};
