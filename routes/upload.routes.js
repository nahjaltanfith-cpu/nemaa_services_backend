import { Router } from 'express';
import { uploadFile, uploadImage } from '../controllers/upload.controller.js';
import { P } from '../config/permissions.js';
import { authenticate, requirePermission } from '../middlewares/auth.middleware.js';
import { singleImage, singlePdf } from '../services/upload.service.js';

const router = Router();

/**
 * @openapi
 * /api/upload:
 *   post:
 *     tags: [Uploads]
 *     summary: Upload one PDF (max 5 MB) to temporary storage
 *     description: >
 *       The stored name is a server-generated UUID; the original filename is only echoed back.
 *       Public so NGOs can attach documents during registration, before they have a token.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file]
 *             properties:
 *               file: { type: string, format: binary }
 *     responses:
 *       '201':
 *         description: File stored
 *         content:
 *           application/json:
 *             example:
 *               success: true
 *               message: تم رفع الملف بنجاح
 *               fileUrl: /uploads/temp/0b6f1c1e-6a0e-4c8e-9a52-1d2f3e4a5b6c.pdf
 *               data:
 *                 key: temp/0b6f1c1e-6a0e-4c8e-9a52-1d2f3e4a5b6c.pdf
 *                 fileUrl: /uploads/temp/0b6f1c1e-6a0e-4c8e-9a52-1d2f3e4a5b6c.pdf
 *                 size: 48213
 *                 originalName: document.pdf
 *       '400': { $ref: '#/components/responses/BadRequest' }
 *       '413': { description: File larger than 5 MB }
 *       '415': { description: Not a PDF (MIME type, extension or file signature) }
 */
/**
 * @openapi
 * /api/upload/image:
 *   post:
 *     tags: [Uploads]
 *     summary: Upload one image (PNG / JPG / WebP, max 3 MB) — admins only, e.g. service thumbnails
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required: [file]
 *             properties:
 *               file: { type: string, format: binary }
 *     responses:
 *       '201': { description: 'fileUrl: /uploads/images/<uuid>.<ext>' }
 *       '401': { $ref: '#/components/responses/Unauthorized' }
 *       '413': { description: Image larger than 3 MB }
 *       '415': { description: Not a PNG, JPG or WebP (checked by file signature) }
 */
router.post('/', singlePdf('file'), uploadFile);
router.post('/image', authenticate, requirePermission(P.MANAGE_CATALOG), singleImage('file'), uploadImage);

export default router;
