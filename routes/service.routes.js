import { Router } from 'express';
import * as controller from '../controllers/service.controller.js';
import { ADMIN_ROLES, authenticate, checkRole, optionalAuth } from '../middlewares/auth.middleware.js';
import { parseIdParam } from '../middlewares/params.middleware.js';
import { validateBody } from '../middlewares/validate.middleware.js';
import { serviceSchema } from '../validators/service.validator.js';

const router = Router();
const adminOnly = [authenticate, checkRole(...ADMIN_ROLES)];

/**
 * @openapi
 * components:
 *   schemas:
 *     Service:
 *       type: object
 *       properties:
 *         id: { type: integer }
 *         title: { type: string }
 *         status: { type: string, enum: [active, inactive, coming_soon] }
 *         imageUrl: { type: string, nullable: true, description: '/uploads/images/... or a website asset such as /images/services/01.png' }
 *         price: { type: number }
 *         requestCount: { type: integer }
 *         rating: { type: number }
 *         responseTime: { type: string, nullable: true }
 *         duration: { type: string, nullable: true }
 *         categoryId: { type: integer, nullable: true }
 *         category: { type: object, nullable: true, properties: { id: { type: integer }, name: { type: string } } }
 *         fullDescription: { type: string }
 *         shortDescription: { type: string }
 *         outputs: { type: array, items: { type: string } }
 *         workMethodology: { type: array, items: { type: object, properties: { title: { type: string }, description: { type: string } } } }
 *         targetAudience: { type: array, items: { type: string } }
 *         includes: { type: array, items: { type: string } }
 *         centers: { type: array, items: { type: object, properties: { id: { type: string }, title: { type: string } } } }
 *     ServiceInput:
 *       type: object
 *       required: [title, fullDescription]
 *       properties:
 *         title: { type: string }
 *         status: { type: string, enum: [active, inactive, coming_soon], default: active }
 *         imageUrl: { type: string, nullable: true }
 *         price: { type: number, minimum: 0 }
 *         responseTime: { type: string }
 *         duration: { type: string }
 *         categoryId: { type: integer, nullable: true }
 *         fullDescription: { type: string, minLength: 10 }
 *         shortDescription: { type: string, description: Empty → first two lines/sentences of fullDescription }
 *         outputs: { type: array, items: { type: string } }
 *         workMethodology:
 *           type: array
 *           items:
 *             oneOf:
 *               - { type: string }
 *               - { type: object, required: [title], properties: { title: { type: string }, description: { type: string } } }
 *         targetAudience: { type: array, items: { type: string } }
 *         includes: { type: array, items: { type: string } }
 *         centerIds: { type: array, items: { type: string } }
 * /api/services:
 *   get:
 *     tags: [Services]
 *     summary: List services. Public callers get active + coming_soon; admins (Bearer token) also see inactive.
 *     security: []
 *     parameters:
 *       - { in: query, name: status, schema: { type: string, enum: [active, inactive, coming_soon] } }
 *       - { in: query, name: categoryId, schema: { type: integer } }
 *       - { in: query, name: search, schema: { type: string } }
 *     responses:
 *       '200':
 *         description: Services
 *         content: { application/json: { schema: { type: object, properties: { data: { type: array, items: { $ref: '#/components/schemas/Service' } } } } } }
 *   post:
 *     tags: [Services]
 *     summary: Create a service (admin)
 *     requestBody:
 *       required: true
 *       content: { application/json: { schema: { $ref: '#/components/schemas/ServiceInput' } } }
 *     responses:
 *       '201': { description: Created service }
 *       '400': { $ref: '#/components/responses/BadRequest' }
 *       '401': { $ref: '#/components/responses/Unauthorized' }
 * /api/services/{id}:
 *   get:
 *     tags: [Services]
 *     summary: One service (inactive ones are 404 for non-admins)
 *     security: []
 *     parameters: [{ $ref: '#/components/parameters/IdParam' }]
 *     responses:
 *       '200': { description: Service }
 *       '404': { $ref: '#/components/responses/NotFound' }
 *   put:
 *     tags: [Services]
 *     summary: Replace a service, including its centers (admin)
 *     parameters: [{ $ref: '#/components/parameters/IdParam' }]
 *     requestBody:
 *       required: true
 *       content: { application/json: { schema: { $ref: '#/components/schemas/ServiceInput' } } }
 *     responses:
 *       '200': { description: Updated service }
 *       '400': { $ref: '#/components/responses/BadRequest' }
 *       '404': { $ref: '#/components/responses/NotFound' }
 *   delete:
 *     tags: [Services]
 *     summary: Delete a service (admin)
 *     parameters: [{ $ref: '#/components/parameters/IdParam' }]
 *     responses:
 *       '200': { description: '{ id }' }
 *       '404': { $ref: '#/components/responses/NotFound' }
 * /api/centers:
 *   get:
 *     tags: [Services]
 *     summary: Centers a service can be linked to (id + title)
 *     security: []
 *     responses:
 *       '200': { description: '[{ id, title }]' }
 */
router.get('/', optionalAuth, controller.list);
router.get('/:id', optionalAuth, parseIdParam(), controller.get);
router.post('/', ...adminOnly, validateBody(serviceSchema), controller.create);
router.put('/:id', ...adminOnly, parseIdParam(), validateBody(serviceSchema), controller.update);
router.delete('/:id', ...adminOnly, parseIdParam(), controller.remove);

export const centersRouter = Router().get('/', controller.listCenters);
export default router;
