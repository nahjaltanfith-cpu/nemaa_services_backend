import { Router } from 'express';
import { uploadFile } from '../controllers/upload.controller.js';
import { singlePdf } from '../services/upload.service.js';

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
router.post('/', singlePdf('file'), uploadFile);

export default router;
