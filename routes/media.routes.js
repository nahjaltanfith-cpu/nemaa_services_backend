import { Router } from 'express';
import * as controller from '../controllers/media.controller.js';
import { P } from '../config/permissions.js';
import { authenticate, requirePermission } from '../middlewares/auth.middleware.js';
import { parseIdParam } from '../middlewares/params.middleware.js';

/**
 * @openapi
 * /api/v1/admin/files:
 *   get: { tags: [Files], summary: 'Stored files, one page (search, type, usage, status, sort=size_desc|size_asc|date_desc|date_asc)', responses: { '200': { description: '{ items, total, counts }' } } }
 * /api/v1/admin/files/stats:
 *   get: { tags: [Files], summary: Storage totals (overall, per type, unused, freed), responses: { '200': { description: Stats } } }
 * /api/v1/admin/files/sync:
 *   post: { tags: [Files], summary: Rescan storage and refresh every file's usage, responses: { '200': { description: Stats } } }
 * /api/v1/admin/files/purge-unused:
 *   post: { tags: [Files], summary: 'Remove every unused file (pending / orphaned, older than an hour)', responses: { '200': { description: '{ removed, bytes }' } } }
 * /api/v1/admin/files/{id}:
 *   delete: { tags: [Files], summary: Detach a file from what uses it and remove it from storage, responses: { '200': { description: Deleted } } }
 */
const router = Router();
router.use(authenticate, requirePermission(P.MANAGE_FILES));
router.get('/', controller.list);
router.get('/stats', controller.stats);
router.get('/settings', controller.uploadSettings);
router.put('/settings', controller.saveUploadSettings);
router.post('/sync', controller.sync);
router.post('/purge-unused', controller.purge);
router.delete('/:id', parseIdParam(), controller.remove);

export default router;
