import { registerMedia } from '../services/media.service.js';
import { saveImage, saveTempPdf } from '../services/upload.service.js';
import { HttpError } from '../utils/httpError.js';

const respondWith = (save) => async (req, res) => {
    try {
        const file = await save(req.file);
        // The registry learns about it now (as 'pending' until something uses it)
        await registerMedia({ ...file, buffer: req.file.buffer }, req.user ? { userId: req.user.id } : {});
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
