// server.js
import { createServer } from 'node:http';
import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import swaggerUi from 'swagger-ui-express';

import pool from './db.js';
import { swaggerSpec } from './config/swagger.js';

if (!process.env.JWT_SECRET?.trim()) {
  throw new Error('JWT_SECRET must be configured before starting the API.');
}

// ── Route imports ─────────────────────────────────────────────────────────────
import authRoutes from './routes/auth.routes.js';
import ngoAuthRoutes from './routes/ngoAuth.routes.js';
import uploadRoutes from './routes/upload.routes.js';
import adminNgoRoutes from './routes/adminNgo.routes.js';
import ngoPortalRoutes from './routes/ngoPortal.routes.js';
import { initRealtime } from './services/realtime.service.js';
import { UPLOADS_PUBLIC_PATH, UPLOADS_ROOT } from './services/upload.service.js';
// import departmentRoutes from './routes/department.routes.js';
// import employeeRoutes from './routes/employee.routes.js';
// import taskRoutes from './routes/task.routes.js';
// import notificationRoutes from './routes/notification.routes.js';

const app = express();

// ── Global Middleware ─────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ── API Documentation ─────────────────────────────────────────────────────────
app.use(
  '/api/docs',
  swaggerUi.serve,
  swaggerUi.setup(swaggerSpec, {
    customSiteTitle: 'Nahg Manager API Docs',
    swaggerOptions: {
      persistAuthorization: true,   // JWT token persists on page refresh
      displayRequestDuration: true,
    },
  })
);

// Expose raw OpenAPI JSON (useful for code-gen tools)
app.get('/api/docs.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

// ── Health Check ──────────────────────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT 1 AS ping');
    res.json({
      success: true,
      message: 'Database connected.',
      data: { ping: rows[0].ping },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message, data: null });
  }
});

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/v1/auth/ngo', ngoAuthRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/v1/admin/ngos', adminNgoRoutes);
app.use('/api/v1/ngo', ngoPortalRoutes);

// ── Uploaded files (local storage only; drop this once files are served from cloud storage)
app.use(UPLOADS_PUBLIC_PATH, express.static(UPLOADS_ROOT, {
  index: false,
  dotfiles: 'deny',
  setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff'),
}));
// app.use('/api/departments', departmentRoutes);
// app.use('/api/employees', employeeRoutes);
// app.use('/api/tasks', taskRoutes);
// app.use('/api/notifications', notificationRoutes);
// app.use('/api', taskRoutes);

// ── Root ──────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Nahg Manager API Server is running.',
    data: { docs: '/api/docs' },
  });
});

// ── 404 Handler ───────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.method} ${req.path} not found.`, data: null });
});

// ── Global Error Handler ──────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[GlobalError]', err);
  res.status(500).json({ success: false, message: 'An unexpected error occurred.', data: null });
});

const PORT = process.env.PORT || 3000;
// Socket.io shares the HTTP server so REST and real-time events use one port.
const server = createServer(app);
initRealtime(server);
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀  Nahg Manager API running on port: ${PORT}`);
  console.log(`📚  API Docs available at: /api/docs\n`);
});
