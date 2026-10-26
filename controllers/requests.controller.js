import { hasPermission } from '../middlewares/auth.middleware.js';
import { logActivity } from '../services/activityLog.service.js';
import * as requests from '../services/requests.service.js';
import { viewerOf } from '../services/requestScope.js';
import { handle } from '../utils/handle.js';
import { HttpError } from '../utils/httpError.js';
import { requestFilterSchema } from '../validators/request.validator.js';

const filters = (query) => {
    const { value, error } = requestFilterSchema.validate(query, { convert: true, stripUnknown: true });
    if (error) throw new HttpError(400, 'معايير البحث غير صالحة', 'INVALID_FILTER');
    return value;
};

// ── NGO (req.user.id is the NGO id) ─────────────────────────────────────────
export const ngoList = handle('requests ngo-list', 200, 'تم جلب الطلبات',
    (req) => requests.listRequestsForNgo(req.user.id, filters(req.query)));

// Opening the request clears its "new update" mark.
export const ngoGet = handle('requests ngo-get', 200, 'تم جلب الطلب', async (req) => {
    await requests.markSeenByNgo(req.user.id, req.params.id);
    return requests.getRequestForNgo(req.user.id, req.params.id);
});

export const ngoCreate = handle('requests ngo-create', 201, 'تم حفظ الطلب',
    (req) => requests.createRequest(req.user.id, req.body));

export const ngoUpdate = handle('requests ngo-update', 200, 'تم حفظ الطلب',
    (req) => requests.updateDraft(req.user.id, req.params.id, req.body));

export const ngoDelete = handle('requests ngo-delete', 200, 'تم حذف المسودة',
    (req) => requests.deleteDraft(req.user.id, req.params.id));

// data.roundCompleted = that was the last missing document: the request is back under study.
export const ngoUploadMissing = handle('requests ngo-missing-upload', 200, 'تم رفع المستند', async (req) => {
    const { request, roundCompleted } = await requests.uploadMissingItem(req.user.id, req.params.id, req.params.itemId, req.body);
    return { ...request, roundCompleted };
});

export const ngoRemoveMissing = handle('requests ngo-missing-remove', 200, 'تم حذف الملف',
    (req) => requests.removeMissingItemFile(req.user.id, req.params.id, req.params.itemId));

export const ngoMessages = handle('requests ngo-messages', 200, 'تم جلب المحادثة',
    (req) => requests.listMessages(req.params.id, { ngoId: req.user.id }));

export const ngoSend = handle('requests ngo-send', 201, 'تم إرسال الرسالة',
    (req) => requests.sendMessage(req.params.id, { ngoId: req.user.id, senderType: 'ngo', body: req.body.body }));

export const ngoRead = handle('requests ngo-read', 200, 'تم تعليم الرسائل كمقروءة',
    (req) => requests.markMessagesRead(req.params.id, 'ngo', { ngoId: req.user.id }));

// ── Admin (req.user.id is the users.id) ─────────────────────────────────────
// Every admin call is limited to the user's request scope (see services/requestScope.js); a request
// outside it answers 404. actor.can checks the finer rules inside the service (status transitions).
const actorOf = (req) => ({ ...viewerOf(req.user), can: (key) => hasPermission(req.user, key) });

export const adminList = handle('requests admin-list', 200, 'تم جلب الطلبات',
    (req) => requests.listRequestsForAdmin(filters(req.query), viewerOf(req.user)));

export const adminGet = handle('requests admin-get', 200, 'تم جلب الطلب',
    (req) => requests.getRequestForAdmin(req.params.id, viewerOf(req.user)));

export const adminStatus = handle('requests admin-status', 200, 'تم تحديث حالة الطلب',
    (req) => requests.changeStatus(req.params.id, actorOf(req), req.body));

export const adminAssignees = handle('requests admin-assignees', 200, 'تم جلب الموظفين المتاحين للإسناد',
    (req) => requests.listAssignees(req.params.id, actorOf(req)));

export const adminAssign = handle('requests admin-assign', 200, 'تم تحديث إسناد الطلب',
    (req) => requests.assignRequest(req.params.id, actorOf(req), req.body.assigneeId));

export const adminAddDeliverables = handle('requests admin-deliverables', 201, 'تم رفع ملفات التسليم',
    (req) => requests.addDeliverables(req.params.id, actorOf(req), req.body.files));

export const adminRemoveDeliverable = handle('requests admin-deliverable-delete', 200, 'تم حذف الملف',
    (req) => requests.removeDeliverable(req.params.id, actorOf(req), req.params.fileId));

export const adminMessages = handle('requests admin-messages', 200, 'تم جلب المحادثة',
    (req) => requests.listMessages(req.params.id, { viewer: viewerOf(req.user) }));

// The log records that a reply was sent, not its text (that stays in the conversation).
export const adminSend = handle('requests admin-send', 201, 'تم إرسال الرسالة', async (req) => {
    const message = await requests.sendMessage(req.params.id, {
        viewer: viewerOf(req.user), senderType: 'admin', senderUserId: req.user.id, body: req.body.body,
    });
    const request = await requests.getRequestForAdmin(req.params.id);
    await logActivity(null, {
        actorId: req.user.id, action: 'request.message', entityType: 'request', entityId: request.id,
        summary: `${request.refCode}: رد على جمعية «${request.ngo.name}» في محادثة الطلب`, details: { messageId: message.id },
    });
    return message;
});

export const adminRead = handle('requests admin-read', 200, 'تم تعليم الرسائل كمقروءة',
    (req) => requests.markMessagesRead(req.params.id, 'admin', { viewer: viewerOf(req.user) }));
