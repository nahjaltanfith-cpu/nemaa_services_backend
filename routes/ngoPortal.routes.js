import { Router } from 'express';
import * as controller from '../controllers/ngoPortal.controller.js';
import { NGO_ROLE, authenticate, checkRole } from '../middlewares/auth.middleware.js';
import { validateBody } from '../middlewares/validate.middleware.js';
import { singleImage } from '../services/upload.service.js';
import { messageSchema, profileUpdateSchema } from '../validators/review.validator.js';

const router = Router();
router.use(authenticate, checkRole(NGO_ROLE));

/**
 * @openapi
 * /api/v1/ngo/profile:
 *   put:
 *     tags: [NGO Portal]
 *     summary: Correct the NGO's own data (email, NGO name and registration number are fixed). Notifies admins.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               fieldOfWork: { type: string }
 *               representativeName: { type: string }
 *               position: { type: string }
 *               mobile: { type: string }
 *     responses:
 *       '200': { description: Updated profile }
 *       '400': { $ref: '#/components/responses/BadRequest' }
 *       '409': { $ref: '#/components/responses/Conflict' }
 * /api/v1/ngo/resubmit:
 *   post:
 *     tags: [NGO Portal]
 *     summary: Send the file back to review after a needs_documents request (all documents required)
 *     responses:
 *       '200': { description: Profile with accountStatus under_review }
 *       '400': { $ref: '#/components/responses/BadRequest' }
 *       '409': { $ref: '#/components/responses/Conflict' }
 * /api/v1/ngo/status/seen:
 *   post:
 *     tags: [NGO Portal]
 *     summary: Clear the unseen-status indicator
 *     responses:
 *       '200': { description: Profile }
 * /api/v1/ngo/messages:
 *   get:
 *     tags: [NGO Portal]
 *     summary: Conversation with the Nemaa team
 *     responses:
 *       '200': { description: '{ conversationOpen, messages[] }' }
 *   post:
 *     tags: [NGO Portal]
 *     summary: Send a text message (409 when the conversation is closed)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [body], properties: { body: { type: string, maxLength: 2000 } } }
 *     responses:
 *       '201': { description: Message }
 *       '409': { $ref: '#/components/responses/Conflict' }
 * /api/v1/ngo/messages/read:
 *   post:
 *     tags: [NGO Portal]
 *     summary: Mark the team's messages as read
 *     responses:
 *       '200': { description: '{ marked }' }
 */
router.put('/profile', validateBody(profileUpdateSchema), controller.updateProfile);
// Profile picture (multipart field "file"): shown next to the NGO's chat messages
router.post('/avatar', singleImage('file'), controller.uploadAvatar);
router.delete('/avatar', controller.removeAvatar);
router.post('/resubmit', controller.resubmit);
router.post('/status/seen', controller.markStatusSeen);
router.get('/messages', controller.listMessages);
router.post('/messages', validateBody(messageSchema), controller.sendMessage);
router.post('/messages/read', controller.markRead);

export default router;
