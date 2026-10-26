import { Router } from 'express';
import * as controller from '../controllers/requests.controller.js';
import { P } from '../config/permissions.js';
import { NGO_ROLE, authenticate, checkRole, requireAnyPermission, requirePermission } from '../middlewares/auth.middleware.js';
import { parseIdParam } from '../middlewares/params.middleware.js';
import { validateBody } from '../middlewares/validate.middleware.js';
import {
    assigneeSchema, deliverablesSchema, missingFileSchema, requestMessageSchema, requestSchema, statusSchema,
} from '../validators/request.validator.js';

/**
 * @openapi
 * components:
 *   schemas:
 *     RequestFile:
 *       type: object
 *       properties:
 *         id: { type: integer }
 *         kind: { type: string, enum: [ngo, completion, deliverable] }
 *         label: { type: string, nullable: true, description: Required-document / missing-item name this file answers }
 *         required: { type: boolean }
 *         name: { type: string }
 *         size: { type: integer }
 *         url: { type: string, description: '/uploads/temp/<uuid>.pdf' }
 *     UploadedFileInput:
 *       type: object
 *       required: [key, name]
 *       properties:
 *         key: { type: string, description: 'key returned by POST /api/upload' }
 *         name: { type: string }
 *         size: { type: integer }
 *         label: { type: string, nullable: true }
 *     ServiceRequest:
 *       type: object
 *       properties:
 *         id: { type: integer }
 *         refCode: { type: string, example: REQ-9A4B12C0 }
 *         type: { type: string, enum: [service, center, general] }
 *         targetId: { type: string, nullable: true }
 *         targetName: { type: string }
 *         needTitle: { type: string }
 *         summary: { type: string }
 *         description: { type: string }
 *         contactMethod: { type: string, enum: [call, meeting, session] }
 *         status: { type: string, enum: [draft, under_study, needs_completion, in_progress, completed] }
 *         completionNote: { type: string, nullable: true }
 *         ngo: { type: object, properties: { id: { type: integer }, name: { type: string } } }
 *         unreadMessages: { type: integer }
 *         attachments: { type: array, items: { $ref: '#/components/schemas/RequestFile' } }
 *         deliverables: { type: array, items: { $ref: '#/components/schemas/RequestFile' } }
 *         missingItems: { type: array, items: { type: object, properties: { id: { type: integer }, name: { type: string }, fulfilledAt: { type: string, nullable: true }, file: { $ref: '#/components/schemas/RequestFile' } } } }
 *         timeline: { type: array, items: { type: object, properties: { key: { type: string }, label: { type: string }, note: { type: string, nullable: true }, actor: { type: string }, date: { type: string } } } }
 *     RequestInput:
 *       type: object
 *       required: [needTitle]
 *       properties:
 *         type: { type: string, enum: [service, center], nullable: true }
 *         targetId: { oneOf: [{ type: integer }, { type: string }], nullable: true }
 *         needTitle: { type: string }
 *         summary: { type: string }
 *         description: { type: string }
 *         contactMethod: { type: string, enum: [call, meeting, session] }
 *         attachments: { type: array, items: { $ref: '#/components/schemas/UploadedFileInput' } }
 *         submit: { type: boolean, description: 'false = save as draft; true = submit (target, texts and mandatory documents required)' }
 * /api/v1/ngo/requests:
 *   get:
 *     tags: [Requests (NGO)]
 *     summary: The NGO's requests, newest activity first
 *     parameters:
 *       - { in: query, name: status, schema: { type: string } }
 *       - { in: query, name: search, schema: { type: string } }
 *     responses: { '200': { description: Requests } }
 *   post:
 *     tags: [Requests (NGO)]
 *     summary: Save a draft or submit a new request (approved NGOs only)
 *     requestBody: { required: true, content: { application/json: { schema: { $ref: '#/components/schemas/RequestInput' } } } }
 *     responses: { '201': { description: Request }, '400': { $ref: '#/components/responses/BadRequest' }, '403': { description: Account not approved } }
 * /api/v1/ngo/requests/{id}:
 *   get:
 *     tags: [Requests (NGO)]
 *     summary: One request with files, missing items and timeline
 *     parameters: [{ $ref: '#/components/parameters/IdParam' }]
 *     responses: { '200': { description: Request }, '404': { $ref: '#/components/responses/NotFound' } }
 *   put:
 *     tags: [Requests (NGO)]
 *     summary: Replace a draft (files included); submit it with submit=true
 *     parameters: [{ $ref: '#/components/parameters/IdParam' }]
 *     requestBody: { required: true, content: { application/json: { schema: { $ref: '#/components/schemas/RequestInput' } } } }
 *     responses: { '200': { description: Request }, '409': { description: Already submitted } }
 *   delete:
 *     tags: [Requests (NGO)]
 *     summary: Delete a draft
 *     parameters: [{ $ref: '#/components/parameters/IdParam' }]
 *     responses: { '200': { description: '{ id }' } }
 * /api/v1/ngo/requests/{id}/missing-items/{itemId}:
 *   put:
 *     tags: [Requests (NGO)]
 *     summary: Upload (or replace) the file for one missing document; the last one moves the request back to under_study
 *     parameters: [{ $ref: '#/components/parameters/IdParam' }, { in: path, name: itemId, required: true, schema: { type: integer } }]
 *     requestBody: { required: true, content: { application/json: { schema: { $ref: '#/components/schemas/UploadedFileInput' } } } }
 *     responses: { '200': { description: 'Request + roundCompleted' }, '409': { description: Not awaiting completion } }
 *   delete:
 *     tags: [Requests (NGO)]
 *     summary: Remove the uploaded file of a missing document (while still awaiting completion)
 *     parameters: [{ $ref: '#/components/parameters/IdParam' }, { in: path, name: itemId, required: true, schema: { type: integer } }]
 *     responses: { '200': { description: Request } }
 * /api/v1/ngo/requests/{id}/messages:
 *   get: { tags: [Requests (NGO)], summary: Conversation about this request, parameters: [{ $ref: '#/components/parameters/IdParam' }], responses: { '200': { description: '{ conversationOpen, messages }' } } }
 *   post: { tags: [Requests (NGO)], summary: Send a message, parameters: [{ $ref: '#/components/parameters/IdParam' }], requestBody: { required: true, content: { application/json: { schema: { type: object, properties: { body: { type: string } } } } } }, responses: { '201': { description: Message } } }
 * /api/v1/admin/requests:
 *   get:
 *     tags: [Requests (Admin)]
 *     summary: Submitted requests of all NGOs (drafts are private)
 *     parameters:
 *       - { in: query, name: status, schema: { type: string } }
 *       - { in: query, name: search, schema: { type: string } }
 *     responses: { '200': { description: Requests } }
 * /api/v1/admin/requests/{id}:
 *   get: { tags: [Requests (Admin)], summary: One request, parameters: [{ $ref: '#/components/parameters/IdParam' }], responses: { '200': { description: Request } } }
 * /api/v1/admin/requests/{id}/assignees:
 *   get: { tags: [Requests (Admin)], summary: 'Staff the request can be assigned to (execute:orders + scope covers it). Needs assign:orders', parameters: [{ $ref: '#/components/parameters/IdParam' }], responses: { '200': { description: '[{ id, name, roleLabel }]' } } }
 * /api/v1/admin/requests/{id}/assignee:
 *   patch: { tags: [Requests (Admin)], summary: 'Assign (or unassign with null). Needs assign:orders', parameters: [{ $ref: '#/components/parameters/IdParam' }], requestBody: { required: true, content: { application/json: { schema: { type: object, required: [assigneeId], properties: { assigneeId: { type: integer, nullable: true } } } } } }, responses: { '200': { description: Request }, '400': { description: ASSIGNEE_NOT_ELIGIBLE } } }
 * /api/v1/admin/requests/{id}/status:
 *   patch:
 *     tags: [Requests (Admin)]
 *     summary: Change the status (or add a timeline note with the same status); needs_completion takes missingItems
 *     parameters: [{ $ref: '#/components/parameters/IdParam' }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [under_study, needs_completion, in_progress, completed] }
 *               label: { type: string, description: 'Timeline text; empty = default for the status' }
 *               note: { type: string }
 *               missingItems: { type: array, items: { type: string } }
 *     responses: { '200': { description: Request } }
 * /api/v1/admin/requests/{id}/deliverables:
 *   post:
 *     tags: [Requests (Admin)]
 *     summary: Upload the final deliverable files (shown to the NGO)
 *     parameters: [{ $ref: '#/components/parameters/IdParam' }]
 *     requestBody: { required: true, content: { application/json: { schema: { type: object, properties: { files: { type: array, items: { $ref: '#/components/schemas/UploadedFileInput' } } } } } } }
 *     responses: { '201': { description: Request } }
 * /api/v1/admin/requests/{id}/deliverables/{fileId}:
 *   delete:
 *     tags: [Requests (Admin)]
 *     summary: Remove a deliverable file
 *     parameters: [{ $ref: '#/components/parameters/IdParam' }, { in: path, name: fileId, required: true, schema: { type: integer } }]
 *     responses: { '200': { description: Request } }
 * /api/v1/admin/requests/{id}/messages:
 *   get: { tags: [Requests (Admin)], summary: Conversation about this request, parameters: [{ $ref: '#/components/parameters/IdParam' }], responses: { '200': { description: '{ conversationOpen, messages }' } } }
 *   post: { tags: [Requests (Admin)], summary: Send a message, parameters: [{ $ref: '#/components/parameters/IdParam' }], requestBody: { required: true, content: { application/json: { schema: { type: object, properties: { body: { type: string } } } } } }, responses: { '201': { description: Message } } }
 */

export const ngoRequestsRouter = Router()
    .use(authenticate, checkRole(NGO_ROLE))
    .get('/', controller.ngoList)
    .post('/', validateBody(requestSchema), controller.ngoCreate)
    .get('/:id', parseIdParam(), controller.ngoGet)
    .put('/:id', parseIdParam(), validateBody(requestSchema), controller.ngoUpdate)
    .delete('/:id', parseIdParam(), controller.ngoDelete)
    .put('/:id/missing-items/:itemId', parseIdParam(), parseIdParam('itemId'), validateBody(missingFileSchema), controller.ngoUploadMissing)
    .delete('/:id/missing-items/:itemId', parseIdParam(), parseIdParam('itemId'), controller.ngoRemoveMissing)
    .get('/:id/messages', parseIdParam(), controller.ngoMessages)
    .post('/:id/messages', parseIdParam(), validateBody(requestMessageSchema), controller.ngoSend)
    .post('/:id/messages/read', parseIdParam(), controller.ngoRead);

// Reading needs read:orders; each change needs its own action. Status changes are checked per
// transition in the service (needs_completion → request:order_info, in_progress → approve:service_orders,
// completed → complete:order, a same-status note → document:updates).
const STATUS_ACTIONS = [P.DOCUMENT_UPDATES, P.REQUEST_ORDER_INFO, P.APPROVE_SERVICE_ORDERS, P.COMPLETE_ORDER];

export const adminRequestsRouter = Router()
    .use(authenticate, requirePermission(P.READ_ORDERS))
    .get('/', controller.adminList)
    .get('/:id', parseIdParam(), controller.adminGet)
    .patch('/:id/status', parseIdParam(), requireAnyPermission(...STATUS_ACTIONS), validateBody(statusSchema), controller.adminStatus)
    .get('/:id/assignees', parseIdParam(), requirePermission(P.ASSIGN_ORDERS), controller.adminAssignees)
    .patch('/:id/assignee', parseIdParam(), requirePermission(P.ASSIGN_ORDERS), validateBody(assigneeSchema), controller.adminAssign)
    .post('/:id/deliverables', parseIdParam(), requirePermission(P.UPLOAD_RESULTS), validateBody(deliverablesSchema), controller.adminAddDeliverables)
    .delete('/:id/deliverables/:fileId', parseIdParam(), parseIdParam('fileId'), requirePermission(P.UPLOAD_RESULTS), controller.adminRemoveDeliverable)
    .get('/:id/messages', parseIdParam(), controller.adminMessages)
    .post('/:id/messages', parseIdParam(), requirePermission(P.DOCUMENT_UPDATES), validateBody(requestMessageSchema), controller.adminSend)
    .post('/:id/messages/read', parseIdParam(), controller.adminRead);
