import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import SlowDown from 'express-slow-down';
import env from '../env.js';
import logger from '../logger/index.js';
import { requirePermission, requireAnyPermission, requireAllPermissions, requireRole, requireSuperAdmin } from './requirePermission.js';
import { enforceLimits } from './enforceLimits.js';

export { requirePermission, requireAnyPermission, requireAllPermissions, requireRole, requireSuperAdmin } from './requirePermission.js';
export { enforceLimits } from './enforceLimits.js';

const cspMiddleware = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", "ws:", "wss:", "http://localhost:*", "https://*.up.railway.app"]
    }
  },
  crossOriginEmbedderPolicy: false
});

export const securityMiddleware = (req, res, next) => {
  if (req.path.startsWith('/api-docs')) {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src *; font-src 'self' data:"
    );
    return next();
  }
  return cspMiddleware(req, res, next);
};

export const corsMiddleware = cors({
  origin: (origin, callback) => {
    const allowedOrigins = [
      env.client.url,
      'http://localhost:5173',
      'http://localhost:3000',
      'http://localhost:8080'
    ];

    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    if (origin.endsWith('.up.railway.app')) return callback(null, true);
    if (origin.includes(env.client.apiUrl || '')) return callback(null, true);

    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'x-organization-id']
});

export const compressionMiddleware = compression({
  filter: (req, res) => {
    if (!res) return false;
    if (req.headers['x-no-compression']) return false;
    const type = res.getHeader('Content-Type');
    if (type && type.includes('text/event-stream')) return false;
    return true;
  },
  level: 6
});

export const rateLimiter = rateLimit({
  windowMs: env.security.rateLimit.windowMs,
  max: env.security.rateLimit.maxRequests,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMIT',
      message: 'Too many requests, please try again later'
    }
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/health' || env.nodeEnv === 'development'
});

export const speedLimiter = SlowDown({
  windowMs: env.security.rateLimit.windowMs,
  delayAfter: env.security.rateLimit.maxRequests * 0.8,
  delayMs: () => 500,
  skip: (req) => req.path === '/health' || env.nodeEnv === 'development'
});

export const requestLogger = (req, res, next) => {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const logData = {
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      userAgent: req.get('user-agent')
    };

    if (res.statusCode >= 500) {
      logger.error('Request error', logData);
    } else if (res.statusCode >= 400) {
      logger.warn('Request warning', logData);
    } else {
      logger.info('Request completed', logData);
    }
  });

  next();
};

export const errorMiddleware = (err, req, res, next) => {
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method
  });
  next(err);
};

export default {
  securityMiddleware,
  corsMiddleware,
  compressionMiddleware,
  rateLimiter,
  speedLimiter,
  requestLogger,
  errorMiddleware,
  requirePermission,
  requireAnyPermission,
  requireAllPermissions,
  requireRole,
  requireSuperAdmin,
  enforceLimits
};