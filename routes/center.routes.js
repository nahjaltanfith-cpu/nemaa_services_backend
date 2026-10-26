import { Router } from 'express';
import * as controller from '../controllers/center.controller.js';
import { CATALOG_EDIT, P } from '../config/permissions.js';
import { authenticate, optionalAuth, requireAnyPermission, requirePermission } from '../middlewares/auth.middleware.js';
import { parseSlugParam } from '../middlewares/params.middleware.js';
import { validateBody } from '../middlewares/validate.middleware.js';
import { centerSchema } from '../validators/center.validator.js';

const router = Router();
// Create / delete: manage:catalog. Update: any catalog right — the controller applies only the fields
// the user may change (price: manage:pricing, required attachments: manage:form_configs).
const adminOnly = [authenticate, requirePermission(P.MANAGE_CATALOG)];
const editors = [authenticate, requireAnyPermission(...CATALOG_EDIT)];

/**
 * @openapi
 * components:
 *   parameters:
 *     CenterIdParam:
 *       in: path
 *       name: id
 *       required: true
 *       schema: { type: string, pattern: '^[a-z0-9]+(-[a-z0-9]+)*$', example: training-center }
 *   schemas:
 *     Center:
 *       type: object
 *       properties:
 *         id: { type: string, description: 'Used in /centers/:id. Generated (center-N); the seeded centers have readable slugs.' }
 *         title: { type: string }
 *         status: { type: string, enum: [active, inactive, coming_soon] }
 *         imageUrl: { type: string, nullable: true, description: '/uploads/images/... or a website asset such as /images/center/01.webp' }
 *         price: { type: number }
 *         requestCount: { type: integer }
 *         rating: { type: number }
 *         responseTime: { type: string, nullable: true }
 *         executionDuration: { type: string, nullable: true }
 *         overview: { type: string }
 *         shortDescription: { type: string }
 *         outputs: { type: array, items: { type: string } }
 *         methodology: { type: array, items: { type: object, properties: { title: { type: string }, description: { type: string } } } }
 *         targetAudience: { type: array, items: { type: string } }
 *         services:
 *           type: array
 *           description: Linked services (inactive ones only for admins)
 *           items:
 *             type: object
 *             properties:
 *               id: { type: integer }
 *               title: { type: string }
 *               status: { type: string }
 *               imageUrl: { type: string, nullable: true }
 *               price: { type: number }
 *               rating: { type: number }
 *               shortDescription: { type: string }
 *         serviceIds: { type: array, items: { type: integer } }
 *     CenterInput:
 *       type: object
 *       required: [title, overview]
 *       properties:
 *         title: { type: string }
 *         status: { type: string, enum: [active, inactive, coming_soon], default: active }
 *         imageUrl: { type: string, nullable: true }
 *         price: { type: number, minimum: 0 }
 *         responseTime: { type: string }
 *         executionDuration: { type: string }
 *         overview: { type: string, minLength: 10 }
 *         shortDescription: { type: string, description: Empty → first 8 words of overview }
 *         outputs: { type: array, items: { type: string } }
 *         methodology:
 *           type: array
 *           items:
 *             oneOf:
 *               - { type: string }
 *               - { type: object, required: [title], properties: { title: { type: string }, description: { type: string } } }
 *         targetAudience: { type: array, items: { type: string } }
 *         serviceIds: { type: array, items: { type: integer } }
 * /api/centers:
 *   get:
 *     tags: [Centers]
 *     summary: List enablement centers with their services. Public callers get active + coming_soon; admins (Bearer token) also see inactive.
 *     security: []
 *     parameters:
 *       - { in: query, name: status, schema: { type: string, enum: [active, inactive, coming_soon] } }
 *       - { in: query, name: search, schema: { type: string } }
 *     responses:
 *       '200':
 *         description: Centers
 *         content: { application/json: { schema: { type: object, properties: { data: { type: array, items: { $ref: '#/components/schemas/Center' } } } } } }
 *   post:
 *     tags: [Centers]
 *     summary: Create a center and link its services (admin)
 *     requestBody:
 *       required: true
 *       content: { application/json: { schema: { $ref: '#/components/schemas/CenterInput' } } }
 *     responses:
 *       '201': { description: Created center }
 *       '400': { $ref: '#/components/responses/BadRequest' }
 *       '401': { $ref: '#/components/responses/Unauthorized' }
 * /api/centers/{id}:
 *   get:
 *     tags: [Centers]
 *     summary: One center with its services (inactive centers are 404 for non-admins)
 *     security: []
 *     parameters: [{ $ref: '#/components/parameters/CenterIdParam' }]
 *     responses:
 *       '200': { description: Center }
 *       '404': { $ref: '#/components/responses/NotFound' }
 *   put:
 *     tags: [Centers]
 *     summary: Replace a center, including its services (admin)
 *     parameters: [{ $ref: '#/components/parameters/CenterIdParam' }]
 *     requestBody:
 *       required: true
 *       content: { application/json: { schema: { $ref: '#/components/schemas/CenterInput' } } }
 *     responses:
 *       '200': { description: Updated center }
 *       '400': { $ref: '#/components/responses/BadRequest' }
 *       '404': { $ref: '#/components/responses/NotFound' }
 *   delete:
 *     tags: [Centers]
 *     summary: Delete a center and its service links; the services stay (admin)
 *     parameters: [{ $ref: '#/components/parameters/CenterIdParam' }]
 *     responses:
 *       '200': { description: '{ id }' }
 *       '404': { $ref: '#/components/responses/NotFound' }
 */
router.get('/', optionalAuth, controller.list);
router.get('/:id', optionalAuth, parseSlugParam(), controller.get);
router.post('/', ...adminOnly, validateBody(centerSchema), controller.create);
router.put('/:id', ...editors, parseSlugParam(), validateBody(centerSchema), controller.update);
router.delete('/:id', ...adminOnly, parseSlugParam(), controller.remove);

export default router;
