import { Router } from 'express';
import * as controller from '../controllers/stats.controller.js';

const router = Router();

/**
 * @openapi
 * /api/stats:
 *   get:
 *     tags: [Stats]
 *     summary: Public website counters (available services, visible centers, registered NGOs)
 *     security: []
 *     responses:
 *       '200':
 *         description: Counters
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: object
 *                   properties:
 *                     services: { type: integer, description: Active services }
 *                     centers: { type: integer, description: Active + coming soon centers }
 *                     ngos: { type: integer, description: All registered NGO accounts }
 */
router.get('/', controller.publicStats);

export default router;
