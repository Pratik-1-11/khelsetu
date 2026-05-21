import express from 'express';
import { createServer } from 'http';
import env from '../core/env.js';
import logger from '../core/logger/index.js';
import { errorHandler, notFoundHandler } from '../core/errors/index.js';
import db from '../infrastructure/postgres/index.js';
import ws from '../core/websocket/index.js';
import {
  securityMiddleware,
  corsMiddleware,
  compressionMiddleware,
  rateLimiter,
  speedLimiter,
  requestLogger,
  enforceLimits
} from '../core/middleware/index.js';
import { resolveTenant } from '../core/middleware/tenant.js';
import swaggerSetup from '../docs/swagger.js';
import authRoutes from '../core/auth/routes.js';
import organizationRoutes from '../domains/organizations/routes.js';
import sportRoutes from '../domains/tournaments/routes.js';
import tournamentRoutes from '../domains/tournaments/tournamentRoutes.js';
import teamRoutes from '../domains/teams/routes.js';
import playerRoutes from '../domains/players/routes.js';
import matchRoutes from '../domains/matches/routes.js';
import scoringRoutes from '../domains/scoring/routes.js';
import basketballRoutes from '../domains/scoring/basketballRoutes.js';
import syncRoutes from '../domains/sync/routes.js';
import standingRoutes from '../domains/standings/routes.js';
import notificationRoutes from '../domains/notifications/routes.js';
import overlayRoutes from '../domains/overlays/routes.js';
import visualizationRoutes from '../domains/visualization/routes.js';
import publicRoutes from '../domains/public/routes.js';
import analyticsRoutes from '../domains/analytics/routes.js';
import auditRoutes from '../domains/audit/routes.js';
import rbacRoutes from '../domains/rbac/routes.js';
import billingRoutes from '../domains/billing/routes.js';
import adminRoutes from '../domains/admin/routes.js';
import { auditMiddleware } from '../core/middleware/audit.js';

const app = express();
const server = createServer(app);

app.set('trust proxy', 1);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use((req, res, next) => {
  if (req.path.length > 1 && req.path.endsWith('/') && req.path !== '/api-docs/') {
    const newPath = req.path.slice(0, -1);
    return res.redirect(301, newPath + req.url.slice(req.path.length));
  }
  next();
});

app.use(securityMiddleware);
app.use(corsMiddleware);
app.use(compressionMiddleware);
app.use(rateLimiter);
app.use(speedLimiter);
app.use(requestLogger);

app.use(resolveTenant);

app.get('/', (req, res) => {
  res.json({ service: 'KhelSetu API', version: '1.0.0', status: 'running' });
});

app.get('/health', async (req, res) => {
  const dbHealth = await db.healthCheck();
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    database: dbHealth,
    environment: env.nodeEnv
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/organizations', organizationRoutes);
app.use('/api/sports', sportRoutes);
app.use('/api/tournaments', enforceLimits('tournaments'), tournamentRoutes);
app.use('/api/teams', enforceLimits('teams'), teamRoutes);
app.use('/api/players', enforceLimits('players'), playerRoutes);
app.use('/api/matches', enforceLimits('matches'), matchRoutes);
app.use('/api/scoring', scoringRoutes);
app.use('/api', basketballRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/standings', auditMiddleware, standingRoutes);
app.use('/api/notifications', auditMiddleware, notificationRoutes);
app.use('/api/overlays', auditMiddleware, overlayRoutes);
app.use('/api/visualization', auditMiddleware, visualizationRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/analytics', auditMiddleware, analyticsRoutes);
app.use('/api/audit', auditMiddleware, auditRoutes);
app.use('/api/rbac', auditMiddleware, rbacRoutes);
app.use('/api/billing', auditMiddleware, billingRoutes);
app.use('/api/admin', auditMiddleware, adminRoutes);

if (env.swagger.enable) {
  swaggerSetup(app);
}

app.use(notFoundHandler);
app.use(errorHandler);

const isServerless = process.env.VERCEL;

db.createPool();
logger.info('PostgreSQL pool initialized');

const startServer = async () => {
  try {
    if (!isServerless) {
      ws.initializeWebSocket(server);
    } else {
      logger.info('WebSocket disabled in serverless mode');
    }

    server.listen(env.port, () => {
      logger.info(`Server running on port ${env.port}`);
      logger.info(`Socket.IO running on port ${env.socketPort}`);
      logger.info(`Environment: ${env.nodeEnv}`);
      logger.info(`Swagger UI: http://localhost:${env.port}/api-docs`);
    });
  } catch (error) {
    logger.error('Failed to start server', { error: error.message });
    process.exit(1);
  }
};

if (!isServerless) {
  startServer();
}

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');
  await db.closePool();
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');
  await db.closePool();
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Promise Rejection:', reason);
  if (reason?.stack) {
    console.error(reason.stack);
  }
  logger.error('Unhandled Promise Rejection', { reason: reason?.message || reason, stack: reason?.stack });
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', { error: error.message, stack: error.stack });
  process.exit(1);
});

export default app;
