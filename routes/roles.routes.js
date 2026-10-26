import { Router } from 'express';
import { P } from '../config/permissions.js';
import * as controller from '../controllers/roles.controller.js';
import { authenticate, requireAnyPermission, requirePermission } from '../middlewares/auth.middleware.js';
import { parseIdParam } from '../middlewares/params.middleware.js';
import { validateBody } from '../middlewares/validate.middleware.js';
import { roleSchema } from '../validators/role.validator.js';

/**
 * @openapi
 * components:
 *   schemas:
 *     RoleInput:
 *       type: object
 *       required: [label]
 *       properties:
 *         label: { type: string, example: مختص الخدمة }
 *         description: { type: string, nullable: true }
 *         permissions: { type: array, items: { type: string, example: 'read:orders' } }
 *         scopeType: { type: string, enum: [all_services, specific_services, specific_centers] }
 *         assignedOnly: { type: boolean, description: Only requests assigned to the user (inside the scope) }
 *         serviceIds: { type: array, items: { type: integer }, description: Required for specific_services }
 *         centerIds: { type: array, items: { type: string }, description: Required for specific_centers }
 * /api/roles:
 *   get:
 *     tags: [Roles]
 *     summary: Staff roles with permissions, scope and member counts (manage:employees or manage:roles)
 *     responses: { '200': { description: Roles } }
 *   post:
 *     tags: [Roles]
 *     summary: New job title with its permissions and scope (manage:roles)
 *     requestBody: { required: true, content: { application/json: { schema: { $ref: '#/components/schemas/RoleInput' } } } }
 *     responses: { '201': { description: Role }, '403': { description: Granting permissions the user lacks }, '409': { description: Label taken } }
 * /api/roles/options:
 *   get:
 *     tags: [Roles]
 *     summary: Permission catalog (grouped) and the services / centers a role can be scoped to (manage:roles)
 *     responses: { '200': { description: '{ permissions, services, centers }' } }
 * /api/roles/{id}:
 *   get: { tags: [Roles], summary: One role (manage:roles), parameters: [{ $ref: '#/components/parameters/IdParam' }], responses: { '200': { description: Role } } }
 *   put:
 *     tags: [Roles]
 *     summary: Replace the role's permissions and scope (built-in roles keep their label)
 *     parameters: [{ $ref: '#/components/parameters/IdParam' }]
 *     requestBody: { required: true, content: { application/json: { schema: { $ref: '#/components/schemas/RoleInput' } } } }
 *     responses: { '200': { description: Role }, '403': { description: Own role, super-admin role, or permissions the user lacks } }
 *   delete:
 *     tags: [Roles]
 *     summary: Delete a custom role nobody holds
 *     parameters: [{ $ref: '#/components/parameters/IdParam' }]
 *     responses: { '200': { description: Deleted }, '409': { description: Built-in role or role in use } }
 * /api/activity-log:
 *   get:
 *     tags: [Roles]
 *     summary: Staff activity, newest first, 50 per page (read:activity_log)
 *     parameters:
 *       - { in: query, name: entityType, schema: { type: string, enum: [request, role, staff, ngo, service, center, category] } }
 *       - { in: query, name: actorId, schema: { type: integer } }
 *       - { in: query, name: before, schema: { type: integer }, description: Last id of the previous page }
 *     responses: { '200': { description: '{ items, hasMore }' } }
 */
const router = Router();
const roleManagers = requirePermission(P.MANAGE_ROLES);

router.use(authenticate);
// The staff form needs the role list too.
router.get('/', requireAnyPermission(P.MANAGE_EMPLOYEES, P.MANAGE_ROLES), controller.list);
router.get('/options', roleManagers, controller.options);
router.get('/:id', roleManagers, parseIdParam(), controller.get);
router.post('/', roleManagers, validateBody(roleSchema), controller.create);
router.put('/:id', roleManagers, parseIdParam(), validateBody(roleSchema), controller.update);
router.delete('/:id', roleManagers, parseIdParam(), controller.remove);

export const activityRouter = Router().get('/', authenticate, requirePermission(P.READ_ACTIVITY_LOG), controller.activity);
export default router;
