import { Router } from 'express';
import * as controller from '../controllers/staff.controller.js';
import { P } from '../config/permissions.js';
import { authenticate, requirePermission } from '../middlewares/auth.middleware.js';
import { parseIdParam } from '../middlewares/params.middleware.js';
import { validateBody } from '../middlewares/validate.middleware.js';
import { createStaffSchema, updateStaffSchema } from '../validators/staff.validator.js';

// Staff accounts: manage:employees. Super-admin accounts and roles stay with super admins
// (enforced in services/staff.service.js).
const employeeManagers = [authenticate, requirePermission(P.MANAGE_EMPLOYEES)];

/**
 * @openapi
 * components:
 *   schemas:
 *     StaffRole:
 *       type: object
 *       properties:
 *         id: { type: integer }
 *         name: { type: string, example: REVIEWER }
 *         label: { type: string, example: مراجع الطلبات }
 *         description: { type: string }
 *         isSuperAdmin: { type: boolean }
 *         isSystem: { type: boolean }
 *         activeMembers: { type: integer }
 *         permissions: { type: array, items: { type: object, properties: { key: { type: string }, label: { type: string } } } }
 *     Staff:
 *       type: object
 *       properties:
 *         id: { type: integer }
 *         name: { type: string }
 *         email: { type: string }
 *         isActive: { type: boolean }
 *         role: { type: object, properties: { id: { type: integer }, name: { type: string }, label: { type: string }, isSuperAdmin: { type: boolean } } }
 *         lastLoginAt: { type: string, nullable: true }
 *         createdBy: { type: string, nullable: true }
 *         createdAt: { type: string }
 * /api/staff:
 *   get:
 *     tags: [Staff]
 *     summary: Staff accounts with their roles (manage:employees)
 *     parameters:
 *       - { in: query, name: status, schema: { type: string, enum: [active, inactive] } }
 *       - { in: query, name: roleId, schema: { type: integer } }
 *       - { in: query, name: search, schema: { type: string } }
 *     responses: { '200': { description: Staff }, '403': { description: Not a super admin } }
 *   post:
 *     tags: [Staff]
 *     summary: Add a staff member with a role and login credentials
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, email, password, roleId]
 *             properties:
 *               name: { type: string }
 *               email: { type: string }
 *               password: { type: string, minLength: 8 }
 *               roleId: { type: integer }
 *     responses: { '201': { description: Staff }, '409': { description: Email already used } }
 * /api/staff/{id}:
 *   get:
 *     tags: [Staff]
 *     summary: One staff member
 *     parameters: [{ $ref: '#/components/parameters/IdParam' }]
 *     responses: { '200': { description: Staff } }
 *   put:
 *     tags: [Staff]
 *     summary: Update details, role, active state or password (empty password = unchanged)
 *     parameters: [{ $ref: '#/components/parameters/IdParam' }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               email: { type: string }
 *               roleId: { type: integer }
 *               isActive: { type: boolean }
 *               password: { type: string }
 *     responses: { '200': { description: Staff }, '409': { description: Self lock-out or last super admin } }
 *   delete:
 *     tags: [Staff]
 *     summary: Deactivate the account (sign-in and current tokens stop working; re-activate with PUT isActive=true)
 *     parameters: [{ $ref: '#/components/parameters/IdParam' }]
 *     responses: { '200': { description: Staff }, '409': { description: Self lock-out or last super admin } }
 */
const router = Router();
router.get('/', ...employeeManagers, controller.list);
router.post('/', ...employeeManagers, validateBody(createStaffSchema), controller.create);
router.get('/:id', ...employeeManagers, parseIdParam(), controller.get);
router.put('/:id', ...employeeManagers, parseIdParam(), validateBody(updateStaffSchema), controller.update);
router.delete('/:id', ...employeeManagers, parseIdParam(), controller.remove);

export default router;
