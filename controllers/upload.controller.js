import { saveImage, saveTempPdf } from '../services/upload.service.js';
import { HttpError } from '../utils/httpError.js';

const respondWith = (save) => async (req, res) => {
    try {
        const file = await save(req.file);
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
