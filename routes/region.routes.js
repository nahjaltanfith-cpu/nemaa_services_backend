import { Router } from 'express';
import * as controller from '../controllers/region.controller.js';

const router = Router();

/**
 * @openapi
 * /api/regions:
 *   get:
 *     tags: [Regions]
 *     summary: List Saudi Arabia's administrative regions (public; used by the NGO registration form)
 *     security: []
 *     responses:
 *       '200':
 *         description: Array of regions
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items: { type: object, properties: { id: { type: integer }, name: { type: string } } }
 */
router.get('/', controller.list);

export default router;
