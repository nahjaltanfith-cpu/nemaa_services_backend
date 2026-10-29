import * as ngoAuth from '../services/ngoAuth.service.js';
import * as messages from '../services/messages.service.js';
import { saveImage } from '../services/upload.service.js';
import { handle } from '../utils/handle.js';
import { HttpError } from '../utils/httpError.js';

export const updateProfile = handle('ngo-portal profile', 200, 'تم حفظ بيانات الجمعية',
    (req) => ngoAuth.updateNgoProfile(req.user.id, req.body));

// Profile picture: same image checks as the catalog upload (PNG/JPG/WebP by signature, 3 MB).
export const uploadAvatar = handle('ngo-portal avatar', 200, 'تم تحديث صورة الجمعية', async (req) => {
    if (!req.file) throw new HttpError(400, 'اختر صورة لرفعها', 'FILE_REQUIRED');
    const image = await saveImage(req.file);
    return ngoAuth.setNgoAvatar(req.user.id, image.fileUrl);
});

export const removeAvatar = handle('ngo-portal avatar remove', 200, 'تم حذف صورة الجمعية',
    (req) => ngoAuth.setNgoAvatar(req.user.id, null));

export const resubmit = handle('ngo-portal resubmit', 200, 'تم إرسال الملف للمراجعة',
    (req) => ngoAuth.resubmitForReview(req.user.id));

export const markStatusSeen = handle('ngo-portal status-seen', 200, 'تم',
    (req) => ngoAuth.markStatusSeen(req.user.id));

export const listMessages = handle('ngo-portal messages', 200, 'تم جلب المحادثة',
    (req) => messages.listThread(req.user.id));

export const sendMessage = handle('ngo-portal send', 201, 'تم إرسال الرسالة',
    (req) => messages.sendMessage({ ngoId: req.user.id, senderType: 'ngo', body: req.body.body }));

export const markRead = handle('ngo-portal read', 200, 'تم تعليم الرسائل كمقروءة',
    (req) => messages.markThreadRead(req.user.id, 'ngo'));
