// config/swagger.js
import swaggerJsdoc from 'swagger-jsdoc';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Nahg Manager API',
      version: '1.0.0',
      description:
        'RESTful API for the Nahg Manager application — handles authentication, departments, employees, and tasks with RBAC.',
      contact: {
        name: 'Nahg Backend Team',
      },
    },
    servers: [
      {
        url: process.env.API_BASE_URL || 'http://localhost:3000',
        description: 'Development server',
      },
    ],
    // ── Security Schemes ──────────────────────────────────────────────────────
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Enter your JWT token obtained from POST /api/auth/login',
        },
      },
      // ── Reusable Parameters ─────────────────────────────────────────────────
      parameters: {
        IdParam: {
          in: 'path',
          name: 'id',
          required: true,
          schema: { type: 'integer' },
          description: 'Resource ID',
        },
      },
      // ── Reusable Responses ──────────────────────────────────────────────────
      responses: {
        BadRequest: {
          description: 'Bad request — validation error',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorResponse' },
              example: { success: false, message: 'Validation error description.', data: null },
            },
          },
        },
        Unauthorized: {
          description: 'Missing or invalid JWT token',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorResponse' },
              example: { success: false, message: 'Access token is missing.', data: null },
            },
          },
        },
        Forbidden: {
          description: 'Insufficient role permissions',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorResponse' },
              example: { success: false, message: 'Access denied. Required role(s): SUPER_ADMIN.', data: null },
            },
          },
        },
        NotFound: {
          description: 'Resource not found',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorResponse' },
              example: { success: false, message: 'Resource not found.', data: null },
            },
          },
        },
        Conflict: {
          description: 'Conflict — duplicate or FK constraint violation',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/ErrorResponse' },
              example: { success: false, message: 'A record with that value already exists.', data: null },
            },
          },
        },
      },
      // ── Reusable Schemas ────────────────────────────────────────────────────
      schemas: {
        // Generic
        SuccessResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            message: { type: 'string', example: 'Operation completed successfully.' },
            data:    { nullable: true },
          },
        },
        ErrorResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            message: { type: 'string', example: 'Error message.' },
            data:    { nullable: true, example: null },
          },
        },
        // Auth
        LoginResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            message: { type: 'string', example: 'Login successful.' },
            data: {
              type: 'object',
              properties: {
                token: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR...' },
                user: {
                  type: 'object',
                  properties: {
                    id:            { type: 'integer', example: 1 },
                    name:          { type: 'string',  example: 'Ahmed Admin' },
                    email:         { type: 'string',  example: 'admin@nahg.com' },
                    role:          { type: 'string',  enum: ['admin', 'user', 'SUPER_ADMIN', 'EMPLOYEE'] },
                    department_id: { type: 'integer', nullable: true, example: null },
                  },
                },
              },
            },
          },
        },
        // Department
        DepartmentBody: {
          type: 'object',
          required: ['name'],
          properties: {
            name:        { type: 'string', example: 'Engineering' },
            description: { type: 'string', nullable: true, example: 'Handles all software tasks.' },
          },
        },
        Department: {
          type: 'object',
          properties: {
            id:             { type: 'integer', example: 1 },
            name:           { type: 'string',  example: 'Engineering' },
            description:    { type: 'string',  nullable: true },
            employee_count: { type: 'integer', example: 5 },
            created_at:     { type: 'string',  format: 'date-time' },
            updated_at:     { type: 'string',  format: 'date-time' },
          },
        },
        DepartmentResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            message: { type: 'string',  example: 'Department created successfully.' },
            data:    { $ref: '#/components/schemas/Department' },
          },
        },
        DepartmentListResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            message: { type: 'string',  example: 'Departments retrieved successfully.' },
            data:    { type: 'array', items: { $ref: '#/components/schemas/Department' } },
          },
        },
        DepartmentDetailResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            message: { type: 'string' },
            data: {
              allOf: [
                { $ref: '#/components/schemas/Department' },
                {
                  type: 'object',
                  properties: {
                    employees: { type: 'array', items: { $ref: '#/components/schemas/Employee' } },
                  },
                },
              ],
            },
          },
        },
        // Employee
        Employee: {
          type: 'object',
          properties: {
            id:            { type: 'integer', example: 3 },
            name:          { type: 'string',  example: 'Khalid Omar' },
            email:         { type: 'string',  example: 'khalid@nahg.com' },
            role:          { type: 'string',  enum: ['SUPER_ADMIN', 'EMPLOYEE'] },
            department_id: { type: 'integer', nullable: true, example: 1 },
            created_at:    { type: 'string',  format: 'date-time' },
          },
        },
        CreateEmployeeBody: {
          type: 'object',
          required: ['name', 'email', 'password'],
          properties: {
            name:          { type: 'string',  example: 'Khalid Omar' },
            email:         { type: 'string',  format: 'email', example: 'khalid@nahg.com' },
            password:      { type: 'string',  example: 'securePass123' },
            department_id: { type: 'integer', nullable: true, example: 1 },
          },
        },
        EmployeeResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            message: { type: 'string',  example: 'Employee created successfully.' },
            data:    { $ref: '#/components/schemas/Employee' },
          },
        },
        EmployeeListResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            message: { type: 'string',  example: 'Employees retrieved successfully.' },
            data:    { type: 'array', items: { $ref: '#/components/schemas/Employee' } },
          },
        },
        // Task
        Task: {
          type: 'object',
          properties: {
            id:               { type: 'integer', example: 10 },
            title:            { type: 'string',  example: 'Fix login bug' },
            description:      { type: 'string',  nullable: true },
            deadline_date:    { type: 'string',  format: 'date', example: '2026-11-01' },
            deadline_time:    { type: 'string',  example: '17:00:00' },
            status:           { type: 'string',  enum: ['New', 'In Progress', 'Pending Review', 'Completed', 'Canceled'] },
            priority:         { type: 'string',  enum: ['Normal', 'Medium', 'High'] },
            department_id:    { type: 'integer', example: 1 },
            assigned_to:      { type: 'integer', example: 3 },
            created_by:       { type: 'integer', example: 1 },
            created_at:       { type: 'string',  format: 'date-time' },
            updated_at:       { type: 'string',  format: 'date-time' },
          },
        },
        CreateTaskBody: {
          type: 'object',
          required: ['title', 'deadline_date', 'deadline_time', 'department_id', 'assigned_to'],
          properties: {
            title:         { type: 'string',  example: 'Fix login bug' },
            description:   { type: 'string',  nullable: true, example: 'User cannot login on mobile.' },
            deadline_date: { type: 'string',  format: 'date',  example: '2026-11-01' },
            deadline_time: { type: 'string',  example: '17:00:00' },
            status:        { type: 'string',  enum: ['New', 'In Progress', 'Pending Review', 'Completed', 'Canceled'], default: 'New' },
            priority:      { type: 'string',  enum: ['Normal', 'Medium', 'High'], default: 'Normal' },
            department_id: { type: 'integer', example: 1 },
            assigned_to:   { type: 'integer', example: 3 },
          },
        },
        UpdateTaskBody: {
          type: 'object',
          properties: {
            title:         { type: 'string' },
            description:   { type: 'string', nullable: true },
            deadline_date: { type: 'string', format: 'date' },
            deadline_time: { type: 'string' },
            status:        { type: 'string', enum: ['New', 'In Progress', 'Pending Review', 'Completed', 'Canceled'] },
            priority:      { type: 'string', enum: ['Normal', 'Medium', 'High'] },
            department_id: { type: 'integer' },
            assigned_to:   { type: 'integer' },
          },
        },
        TaskResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            message: { type: 'string',  example: 'Task retrieved successfully.' },
            data:    { $ref: '#/components/schemas/Task' },
          },
        },
        TaskListResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            message: { type: 'string',  example: 'Tasks retrieved successfully.' },
            data:    { type: 'array', items: { $ref: '#/components/schemas/Task' } },
          },
        },
      },
    },
    // Apply bearerAuth globally so it's available on all tagged routes
    security: [{ bearerAuth: [] }],
  },
  // Explicit absolute paths — glob backslash bug on Windows
  apis: [
    path.join(__dirname, '../routes/auth.routes.js'),
    path.join(__dirname, '../routes/ngoAuth.routes.js'),
    path.join(__dirname, '../routes/upload.routes.js'),
    path.join(__dirname, '../routes/adminNgo.routes.js'),
    path.join(__dirname, '../routes/ngoPortal.routes.js'),
    path.join(__dirname, '../routes/department.routes.js'),
    path.join(__dirname, '../routes/employee.routes.js'),
    path.join(__dirname, '../routes/task.routes.js'),
  ],
};

export const swaggerSpec = swaggerJsdoc(options);
