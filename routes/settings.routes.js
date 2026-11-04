import { Router } from 'express';
import * as controller from '../controllers/settings.controller.js';
import { P } from '../config/permissions.js';
import { authenticate, requirePermission } from '../middlewares/auth.middleware.js';

/**
 * @openapi
 * /api/v1/admin/settings/request-limits:
 *   get: { tags: [Settings], summary: 'Per-NGO request limits (a null limit = none)', responses: { '200': { description: '{ maxFreeServices, maxTotalServices, period, periodFrom, periodTo }' } } }
 *   put: { tags: [Settings], summary: 'Saves the per-NGO request limits. period=custom needs periodFrom and periodTo', responses: { '200': { description: The saved limits } } }
 */
const router = Router();
router.use(authenticate, requirePermission(P.MANAGE_CATALOG));
router.get('/request-limits', controller.requestLimits);
router.put('/request-limits', controller.saveRequestLimits);

export default router;
