import { logActivity } from '../services/activityLog.service.js';
import * as contact from '../services/contact.service.js';
import { notifyContactRequest } from '../services/notifications.service.js';
import { handle } from '../utils/handle.js';
import { HttpError } from '../utils/httpError.js';

// Public form. The response carries no data, so a bot that filled the honeypot can't tell it was dropped.
export const create = handle('contact create', 201, 'شكرًا لتواصلك، تم إرسال رسالتك بنجاح وسنتواصل معك قريبًا', async (req) => {
    const { website, ...data } = req.body;
    if (website) return null;
    const contactRequest = await contact.createContactRequest(data);
    notifyContactRequest(contactRequest);
    return null;
});

export const list = handle('contact list', 200, 'تم جلب الرسائل', (req) => {
    const { status } = req.query;
    if (status && !contact.CONTACT_STATUSES.includes(status)) throw new HttpError(400, 'حالة غير صالحة', 'INVALID_STATUS');
    return contact.listContactRequests({ status });
});

export const get = handle('contact get', 200, 'تم جلب الرسالة',
    (req) => contact.getContactRequest(req.params.id));

export const updateStatus = handle('contact status', 200, 'تم تحديث الحالة', async (req) => {
    const { contactRequest, previousStatus } = await contact.updateContactStatus(req.params.id, req.body.status);
    if (previousStatus !== contactRequest.status) {
        await logActivity(null, {
            actorId: req.user.id,
            action: 'contact.status',
            entityType: 'contact',
            entityId: contactRequest.id,
            summary: `تغيير حالة رسالة «${contactRequest.fullName}» من «${contact.CONTACT_STATUS_LABELS[previousStatus]}» إلى «${contact.CONTACT_STATUS_LABELS[contactRequest.status]}»`,
            details: { from: previousStatus, to: contactRequest.status },
        });
    }
    return contactRequest;
});
