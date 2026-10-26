import { Router } from 'express';
import * as controller from '../controllers/adminNgo.controller.js';
import { P } from '../config/permissions.js';
import { authenticate, requirePermission } from '../middlewares/auth.middleware.js';
import { parseIdParam } from '../middlewares/params.middleware.js';
import { validateBody } from '../middlewares/validate.middleware.js';
import { conversationSchema, messageSchema, statusUpdateSchema } from '../validators/review.validator.js';

const router = Router();
// Reading NGO files and conversations: read:org_docs. Changing the account status and talking to
// the NGO (part of the approval workflow): approve:org_accounts.
router.use(authenticate, requirePermission(P.READ_ORG_DOCS));
const approver = requirePermission(P.APPROVE_ORG_ACCOUNTS);

/**
 * @openapi
 * /api/v1/admin/ngos:
 *   get:
 *     tags: [Admin NGOs]
 *     summary: List verified NGOs (newest first); unreadMessages counts NGO messages unread by staff
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [new, under_review, needs_documents, approved] }
 *     responses:
 *       '200': { description: Array of NgoUser plus adminNotes, createdAt, unreadMessages, conversationOpen }
 *       '401': { $ref: '#/components/responses/Unauthorized' }
 *       '403': { $ref: '#/components/responses/Forbidden' }
 * /api/v1/admin/ngos/{id}:
 *   get:
 *     tags: [Admin NGOs]
 *     summary: One NGO with documents and review state
 *     parameters: [{ $ref: '#/components/parameters/IdParam' }]
 *     responses:
 *       '200': { description: NGO }
 *       '404': { $ref: '#/components/responses/NotFound' }
 * /api/v1/admin/ngos/{id}/status:
 *   patch:
 *     tags: [Admin NGOs]
 *     summary: Set review status; notes are required for needs_documents. Pushes ngo:status in real time.
 *     parameters: [{ $ref: '#/components/parameters/IdParam' }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [new, under_review, needs_documents, approved] }
 *               notes: { type: string, maxLength: 2000 }
 *     responses:
 *       '200': { description: Updated NGO }
 *       '400': { $ref: '#/components/responses/BadRequest' }
 *       '404': { $ref: '#/components/responses/NotFound' }
 * /api/v1/admin/ngos/{id}/messages:
 *   get:
 *     tags: [Admin NGOs]
 *     summary: Conversation with the NGO (oldest first, latest 500)
 *     parameters: [{ $ref: '#/components/parameters/IdParam' }]
 *     responses:
 *       '200': { description: '{ conversationOpen, messages[] }' }
 *   post:
 *     tags: [Admin NGOs]
 *     summary: Send a text message (409 when the conversation is closed). Pushes message:new.
 *     parameters: [{ $ref: '#/components/parameters/IdParam' }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [body], properties: { body: { type: string, maxLength: 2000 } } }
 *     responses:
 *       '201': { description: Message }
 *       '409': { $ref: '#/components/responses/Conflict' }
 * /api/v1/admin/ngos/{id}/messages/read:
 *   post:
 *     tags: [Admin NGOs]
 *     summary: Mark the NGO's messages as read by staff. Pushes messages:read.
 *     parameters: [{ $ref: '#/components/parameters/IdParam' }]
 *     responses:
 *       '200': { description: '{ marked }' }
 * /api/v1/admin/ngos/{id}/conversation:
 *   patch:
 *     tags: [Admin NGOs]
 *     summary: Open or close the conversation. Pushes conversation:state.
 *     parameters: [{ $ref: '#/components/parameters/IdParam' }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [open], properties: { open: { type: boolean } } }
 *     responses:
 *       '200': { description: '{ conversationOpen }' }
 */
router.get('/', controller.listNgos);
router.get('/:id', parseIdParam(), controller.getNgo);
router.patch('/:id/status', parseIdParam(), approver, validateBody(statusUpdateSchema), controller.updateStatus);
router.get('/:id/messages', parseIdParam(), controller.listMessages);
router.post('/:id/messages', parseIdParam(), approver, validateBody(messageSchema), controller.sendMessage);
router.post('/:id/messages/read', parseIdParam(), controller.markRead);
router.patch('/:id/conversation', parseIdParam(), approver, validateBody(conversationSchema), controller.setConversation);

export default router;
