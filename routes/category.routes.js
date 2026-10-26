import { Router } from 'express';
import * as controller from '../controllers/category.controller.js';
import { P } from '../config/permissions.js';
import { authenticate, requirePermission } from '../middlewares/auth.middleware.js';
import { parseIdParam } from '../middlewares/params.middleware.js';
import { validateBody } from '../middlewares/validate.middleware.js';
import { categorySchema } from '../validators/category.validator.js';

const router = Router();
// Catalog writes: super admins and roles with manage:catalog (e.g. CONTENT_MANAGER).
const adminOnly = [authenticate, requirePermission(P.MANAGE_CATALOG)];

/**
 * @openapi
 * components:
 *   schemas:
 *     Category:
 *       type: object
 *       properties:
 *         id: { type: integer }
 *         name: { type: string }
 *         description: { type: string, nullable: true }
 *         createdAt: { type: string, format: date-time }
 *         updatedAt: { type: string, format: date-time }
 *     CategoryInput:
 *       type: object
 *       required: [name]
 *       properties:
 *         name: { type: string, minLength: 2, maxLength: 100, description: Unique (case-insensitive) }
 *         description: { type: string, maxLength: 1000, nullable: true }
 * /api/categories:
 *   get:
 *     tags: [Categories]
 *     summary: List all categories (public, sorted by name)
 *     security: []
 *     responses:
 *       '200':
 *         description: Array of categories
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data: { type: array, items: { $ref: '#/components/schemas/Category' } }
 *   post:
 *     tags: [Categories]
 *     summary: Create a category (admin)
 *     requestBody:
 *       required: true
 *       content: { application/json: { schema: { $ref: '#/components/schemas/CategoryInput' } } }
 *     responses:
 *       '201': { description: Created category }
 *       '400': { $ref: '#/components/responses/BadRequest' }
 *       '401': { $ref: '#/components/responses/Unauthorized' }
 *       '403': { $ref: '#/components/responses/Forbidden' }
 *       '409': { description: CATEGORY_NAME_TAKEN }
 * /api/categories/{id}:
 *   put:
 *     tags: [Categories]
 *     summary: Update a category's name and description (admin)
 *     parameters: [{ $ref: '#/components/parameters/IdParam' }]
 *     requestBody:
 *       required: true
 *       content: { application/json: { schema: { $ref: '#/components/schemas/CategoryInput' } } }
 *     responses:
 *       '200': { description: Updated category }
 *       '400': { $ref: '#/components/responses/BadRequest' }
 *       '404': { $ref: '#/components/responses/NotFound' }
 *       '409': { description: CATEGORY_NAME_TAKEN }
 *   delete:
 *     tags: [Categories]
 *     summary: Delete a category (admin; 409 CATEGORY_IN_USE once services reference it)
 *     parameters: [{ $ref: '#/components/parameters/IdParam' }]
 *     responses:
 *       '200': { description: '{ id }' }
 *       '404': { $ref: '#/components/responses/NotFound' }
 *       '409': { description: CATEGORY_IN_USE }
 */
// Listing is public: the NGO site will need categories to browse services.
router.get('/', controller.list);
router.post('/', ...adminOnly, validateBody(categorySchema), controller.create);
router.put('/:id', ...adminOnly, parseIdParam(), validateBody(categorySchema), controller.update);
router.delete('/:id', ...adminOnly, parseIdParam(), controller.remove);

export default router;
