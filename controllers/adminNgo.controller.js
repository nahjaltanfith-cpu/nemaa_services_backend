import * as adminNgo from '../services/adminNgo.service.js';
import * as messages from '../services/messages.service.js';
import { handle } from '../utils/handle.js';
import { HttpError } from '../utils/httpError.js';
import { statusFilterSchema } from '../validators/review.validator.js';

export const listNgos = handle('admin-ngo list', 200, 'تم جلب الجمعيات', (req) => {
    const { status } = req.query;
    if (status !== undefined && statusFilterSchema.validate(status).error) {
        throw new HttpError(400, 'حالة غير صالحة', 'INVALID_STATUS');
    }
    return adminNgo.listNgos({ status });
});

export const getNgo = handle('admin-ngo get', 200, 'تم جلب بيانات الجمعية',
    (req) => adminNgo.getNgo(req.params.id));

export const updateStatus = handle('admin-ngo status', 200, 'تم تحديث حالة الجمعية',
    (req) => adminNgo.updateNgoStatus(req.params.id, req.body));

export const listMessages = handle('admin-ngo messages', 200, 'تم جلب المحادثة', async (req) => {
    await adminNgo.getNgo(req.params.id); // 404 for unknown or unverified NGOs
    return messages.listThread(req.params.id);
});

export const sendMessage = handle('admin-ngo send', 201, 'تم إرسال الرسالة', async (req) => {
    await adminNgo.getNgo(req.params.id);
    return messages.sendMessage({
        ngoId: req.params.id, senderType: 'admin', senderUserId: req.user.id, body: req.body.body,
    });
});

export const markRead = handle('admin-ngo read', 200, 'تم تعليم الرسائل كمقروءة',
    (req) => messages.markThreadRead(req.params.id, 'admin'));

export const setConversation = handle('admin-ngo conversation', 200, 'تم تحديث حالة المحادثة',
    (req) => messages.setConversationOpen(req.params.id, req.body.open));
