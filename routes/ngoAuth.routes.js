import { Router } from 'express';
import * as controller from '../controllers/ngoAuth.controller.js';
import { authenticate, checkRole } from '../middlewares/auth.middleware.js';
import { validateBody } from '../middlewares/validate.middleware.js';
import {
    attachDocumentSchema, emailOnlySchema, loginSchema, otpSchema, registerSchema, resetPasswordSchema,
} from '../validators/ngoAuth.validator.js';
import { NGO_ROLE } from '../services/ngoAuth.service.js';

const router = Router();

/**
 * @openapi
 * components:
 *   schemas:
 *     NgoUser:
 *       type: object
 *       properties:
 *         id: { type: integer }
 *         ngoName: { type: string }
 *         regNumber: { type: string }
 *         fieldOfWork: { type: string }
 *         representativeName: { type: string }
 *         position: { type: string, nullable: true }
 *         email: { type: string }
 *         mobile: { type: string }
 *         accountStatus: { type: string, enum: [approved, under_review, needs_documents] }
 *         documents: { type: array, items: { type: object } }
 *     NgoSession:
 *       type: object
 *       properties:
 *         success: { type: boolean }
 *         message: { type: string }
 *         data:
 *           type: object
 *           properties:
 *             token: { type: string }
 *             user: { $ref: '#/components/schemas/NgoUser' }
 *     NgoEmail:
 *       type: object
 *       required: [email]
 *       properties:
 *         email: { type: string, format: email }
 *     NgoOtp:
 *       type: object
 *       required: [email, otp_code]
 *       properties:
 *         email: { type: string, format: email }
 *         otp_code: { type: string, example: '123456', description: 6 digits }
 * /api/v1/auth/ngo/register:
 *   post:
 *     tags: [NGO Auth]
 *     summary: Register an NGO and email a verification OTP
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [ngo, representative]
 *             properties:
 *               ngo:
 *                 type: object
 *                 required: [ngoName, regNumber, fieldOfWork]
 *                 properties:
 *                   ngoName: { type: string, minLength: 3 }
 *                   regNumber: { type: string, description: 4-10 digits }
 *                   fieldOfWork: { type: string }
 *               representative:
 *                 type: object
 *                 required: [representativeName, email, mobile, password]
 *                 properties:
 *                   representativeName: { type: string, minLength: 3 }
 *                   position: { type: string }
 *                   email: { type: string, format: email }
 *                   mobile: { type: string, example: '0555000000', description: Starts with 05, 10 digits }
 *                   password: { type: string, minLength: 8 }
 *               documents:
 *                 type: object
 *                 description: >
 *                   Keys returned by POST /api/upload. Optional; a missing or invalid key leaves
 *                   that document missing and the account in needs_documents.
 *                 properties:
 *                   ngoDocument: { type: string, nullable: true, example: 'temp/<uuid>.pdf' }
 *                   representativeProof: { type: string, nullable: true, example: 'temp/<uuid>.pdf' }
 *     responses:
 *       '201':
 *         description: >
 *           Account created. data = { email, accountStatus, missingDocuments[] };
 *           accountStatus is under_review with both documents, needs_documents otherwise.
 *       '400': { $ref: '#/components/responses/BadRequest' }
 *       '409': { $ref: '#/components/responses/Conflict' }
 * /api/v1/auth/ngo/verify-email:
 *   post:
 *     tags: [NGO Auth]
 *     summary: Confirm the registration OTP and start a session
 *     security: []
 *     requestBody:
 *       required: true
 *       content: { application/json: { schema: { $ref: '#/components/schemas/NgoOtp' } } }
 *     responses:
 *       '200':
 *         description: Email verified
 *         content: { application/json: { schema: { $ref: '#/components/schemas/NgoSession' } } }
 *       '400': { $ref: '#/components/responses/BadRequest' }
 * /api/v1/auth/ngo/resend-verification:
 *   post:
 *     tags: [NGO Auth]
 *     summary: Resend the registration OTP (60 s cooldown; always returns 200)
 *     security: []
 *     requestBody:
 *       required: true
 *       content: { application/json: { schema: { $ref: '#/components/schemas/NgoEmail' } } }
 *     responses:
 *       '200': { description: Generic confirmation }
 * /api/v1/auth/ngo/login:
 *   post:
 *     tags: [NGO Auth]
 *     summary: Login an NGO (403 EMAIL_NOT_VERIFIED until the email is confirmed)
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email }
 *               password: { type: string }
 *     responses:
 *       '200':
 *         description: Login successful
 *         content: { application/json: { schema: { $ref: '#/components/schemas/NgoSession' } } }
 *       '401': { $ref: '#/components/responses/Unauthorized' }
 *       '403': { $ref: '#/components/responses/Forbidden' }
 * /api/v1/auth/ngo/forgot-password:
 *   post:
 *     tags: [NGO Auth]
 *     summary: Email a password-reset OTP (valid 10 min, 60 s cooldown; always returns 200)
 *     security: []
 *     requestBody:
 *       required: true
 *       content: { application/json: { schema: { $ref: '#/components/schemas/NgoEmail' } } }
 *     responses:
 *       '200': { description: Generic confirmation }
 * /api/v1/auth/ngo/verify-otp:
 *   post:
 *     tags: [NGO Auth]
 *     summary: Check a password-reset OTP without consuming it (max 5 attempts per code)
 *     security: []
 *     requestBody:
 *       required: true
 *       content: { application/json: { schema: { $ref: '#/components/schemas/NgoOtp' } } }
 *     responses:
 *       '200': { description: Code is valid }
 *       '400': { $ref: '#/components/responses/BadRequest' }
 * /api/v1/auth/ngo/reset-password:
 *   post:
 *     tags: [NGO Auth]
 *     summary: Set a new password using the reset OTP, then invalidate the OTP
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, otp_code, new_password]
 *             properties:
 *               email: { type: string, format: email }
 *               otp_code: { type: string, example: '123456' }
 *               new_password: { type: string, minLength: 8 }
 *     responses:
 *       '200': { description: Password changed }
 *       '400': { $ref: '#/components/responses/BadRequest' }
 * /api/v1/auth/ngo/profile:
 *   get:
 *     tags: [NGO Auth]
 *     summary: Current NGO profile
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       '200': { description: Profile retrieved }
 *       '401': { $ref: '#/components/responses/Unauthorized' }
 *       '403': { $ref: '#/components/responses/Forbidden' }
 * /api/v1/auth/ngo/documents/{documentType}:
 *   put:
 *     tags: [NGO Auth]
 *     summary: Attach or replace a registration document using a key from POST /api/upload
 *     description: When both documents are present, a needs_documents account moves to under_review.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: documentType
 *         required: true
 *         schema: { type: string, enum: [ngoDocument, representativeProof] }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [key]
 *             properties:
 *               key: { type: string, example: 'temp/<uuid>.pdf' }
 *     responses:
 *       '200': { description: Updated profile (same shape as GET /profile) }
 *       '400': { $ref: '#/components/responses/BadRequest' }
 *       '401': { $ref: '#/components/responses/Unauthorized' }
 *       '404': { $ref: '#/components/responses/NotFound' }
 */
router.post('/register', validateBody(registerSchema), controller.register);
router.post('/verify-email', validateBody(otpSchema), controller.verifyEmail);
router.post('/resend-verification', validateBody(emailOnlySchema), controller.resendVerification);
router.post('/login', validateBody(loginSchema), controller.login);
router.post('/forgot-password', validateBody(emailOnlySchema), controller.forgotPassword);
router.post('/verify-otp', validateBody(otpSchema), controller.verifyOtp);
router.post('/reset-password', validateBody(resetPasswordSchema), controller.resetPassword);
router.get('/profile', authenticate, checkRole(NGO_ROLE), controller.getProfile);
router.put('/documents/:documentType', authenticate, checkRole(NGO_ROLE),
    validateBody(attachDocumentSchema), controller.attachDocument);

export default router;
