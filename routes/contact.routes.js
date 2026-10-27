import { Router } from 'express';
import * as controller from '../controllers/contact.controller.js';
import { P } from '../config/permissions.js';
import { authenticate, requirePermission } from '../middlewares/auth.middleware.js';
import { parseIdParam } from '../middlewares/params.middleware.js';
import { validateBody } from '../middlewares/validate.middleware.js';
import { contactRequestSchema, contactStatusSchema } from '../validators/contact.validator.js';

const router = Router();
// Reading messages and changing their status: super admins and roles with manage:contact_requests.
const staffOnly = [authenticate, requirePermission(P.MANAGE_CONTACT_REQUESTS)];

/**
 * @openapi
 * components:
 *   schemas:
 *     ContactRequest:
 *       type: object
 *       properties:
 *         id: { type: integer }
 *         type: { type: string, enum: [general, technical, suggestion, partnership] }
 *         fullName: { type: string }
 *         organizationName: { type: string, nullable: true }
 *         email: { type: string }
 *         phone: { type: string, nullable: true, description: Mobile / WhatsApp }
 *         message: { type: string }
 *         status: { type: string, enum: [pending, contacted, completed] }
 *         createdAt: { type: string, format: date-time }
 *         updatedAt: { type: string, format: date-time }
 *     ContactRequestInput:
 *       type: object
 *       required: [fullName, email, message]
 *       properties:
 *         type: { type: string, enum: [general, technical, suggestion, partnership], default: general }
 *         fullName: { type: string, minLength: 2, maxLength: 255 }
 *         organizationName: { type: string, maxLength: 255, nullable: true }
 *         email: { type: string, format: email, maxLength: 255 }
 *         phone: { type: string, pattern: '^\+?\d{7,15}$', nullable: true }
 *         message: { type: string, minLength: 20, maxLength: 2000 }
 * /api/contact:
 *   post:
 *     tags: [Contact]
 *     summary: Send the public contact form (stores it and emails the team inbox, CONTACT_INBOX_EMAIL)
 *     security: []
 *     requestBody:
 *       required: true
 *       content: { application/json: { schema: { $ref: '#/components/schemas/ContactRequestInput' } } }
 *     responses:
 *       '201': { description: Received (data is null) }
 *       '400': { $ref: '#/components/responses/BadRequest' }
 *       '429': { description: TOO_MANY_REQUESTS — 3 messages from the same email within 10 minutes }
 *   get:
 *     tags: [Contact]
 *     summary: List contact messages, newest first (manage:contact_requests)
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [pending, contacted, completed] }
 *     responses:
 *       '200':
 *         description: Array of messages
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data: { type: array, items: { $ref: '#/components/schemas/ContactRequest' } }
 *       '401': { $ref: '#/components/responses/Unauthorized' }
 *       '403': { $ref: '#/components/responses/Forbidden' }
 * /api/contact/{id}:
 *   get:
 *     tags: [Contact]
 *     summary: One contact message (manage:contact_requests)
 *     parameters: [{ $ref: '#/components/parameters/IdParam' }]
 *     responses:
 *       '200': { description: The message }
 *       '404': { $ref: '#/components/responses/NotFound' }
 * /api/contact/{id}/status:
 *   patch:
 *     tags: [Contact]
 *     summary: Set the follow-up status (manage:contact_requests)
 *     parameters: [{ $ref: '#/components/parameters/IdParam' }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status: { type: string, enum: [pending, contacted, completed] }
 *     responses:
 *       '200': { description: Updated message }
 *       '400': { $ref: '#/components/responses/BadRequest' }
 *       '404': { $ref: '#/components/responses/NotFound' }
 */
router.post('/', validateBody(contactRequestSchema), controller.create);
router.get('/', ...staffOnly, controller.list);
router.get('/:id', ...staffOnly, parseIdParam(), controller.get);
router.patch('/:id/status', ...staffOnly, parseIdParam(), validateBody(contactStatusSchema), controller.updateStatus);

export default router;
