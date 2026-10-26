import { logActivity } from '../services/activityLog.service.js';
import * as adminNgo from '../services/adminNgo.service.js';
import * as messages from '../services/messages.service.js';
import { notifyNgoAccountStatus } from '../services/notifications.service.js';
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

const NGO_STATUS_LABELS = { new: 'جديد', under_review: 'قيد المراجعة', needs_documents: 'بحاجة إلى مستندات', approved: 'معتمد' };

export const updateStatus = handle('admin-ngo status', 200, 'تم تحديث حالة الجمعية', async (req) => {
    const before = await adminNgo.getNgo(req.params.id);
    const ngo = await adminNgo.updateNgoStatus(req.params.id, req.body);
    const label = (status) => NGO_STATUS_LABELS[status] || status;
    await logActivity(null, {
        actorId: req.user.id, action: ngo.accountStatus === 'approved' ? 'ngo.approve' : 'ngo.status',
        entityType: 'ngo', entityId: ngo.id,
        summary: ngo.accountStatus === 'approved' && before.accountStatus !== 'approved'
            ? `اعتماد جمعية «${ngo.ngoName}»`
            : `جمعية «${ngo.ngoName}»: من «${label(before.accountStatus)}» إلى «${label(ngo.accountStatus)}»`,
        details: { from: before.accountStatus, to: ngo.accountStatus, notes: req.body.notes || null },
    });
    notifyNgoAccountStatus(ngo, before.accountStatus);
    return ngo;
});

export const listMessages = handle('admin-ngo messages', 200, 'تم جلب المحادثة', async (req) => {
    await adminNgo.getNgo(req.params.id); // 404 for unknown or unverified NGOs
    return messages.listThread(req.params.id);
});

// The log records that a reply was sent, not its text (that stays in the conversation).
export const sendMessage = handle('admin-ngo send', 201, 'تم إرسال الرسالة', async (req) => {
    const ngo = await adminNgo.getNgo(req.params.id);
    const message = await messages.sendMessage({
        ngoId: req.params.id, senderType: 'admin', senderUserId: req.user.id, body: req.body.body,
    });
    await logActivity(null, {
        actorId: req.user.id, action: 'ngo.message', entityType: 'ngo', entityId: ngo.id,
        summary: `رد على جمعية «${ngo.ngoName}» في المحادثة`, details: { messageId: message.id },
    });
    return message;
});

export const markRead = handle('admin-ngo read', 200, 'تم تعليم الرسائل كمقروءة',
    (req) => messages.markThreadRead(req.params.id, 'admin'));

export const setConversation = handle('admin-ngo conversation', 200, 'تم تحديث حالة المحادثة', async (req) => {
    const ngo = await adminNgo.getNgo(req.params.id);
    const result = await messages.setConversationOpen(req.params.id, req.body.open);
    await logActivity(null, {
        actorId: req.user.id, action: req.body.open ? 'ngo.conversation_open' : 'ngo.conversation_close',
        entityType: 'ngo', entityId: ngo.id,
        summary: `${req.body.open ? 'فتح' : 'إغلاق'} المحادثة مع جمعية «${ngo.ngoName}»`,
    });
    return result;
});
