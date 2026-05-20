import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../../');

dotenv.config({ path: path.join(projectRoot, '.env') });

const requiredEnvVars = [
  'NODE_ENV',
  'DATABASE_URL',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'CLIENT_URL'
];

const optionalEnvVars = [
  'PG_POOL_MIN',
  'PG_POOL_MAX',
  'PG_POOL_IDLE_TIMEOUT',
  'JWT_EXPIRES_IN',
  'JWT_REFRESH_EXPIRES_IN',
  'CLIENT_API_URL',
  'RATE_LIMIT_WINDOW_MS',
  'RATE_LIMIT_MAX_REQUESTS',
  'STORAGE_PROVIDER',
  'STORAGE_PATH',
  'EMAIL_PROVIDER',
  'EMAIL_FROM',
  'LOG_LEVEL',
  'LOG_FILE_PATH',
  'SWAGGER_ENABLE',
  'SWAGGER_TITLE',
  'SWAGGER_VERSION',
  'SWAGGER_DESCRIPTION'
];

class EnvValidator {
  constructor() {
    this.errors = [];
    this.warnings = [];
  }

  validate() {
    for (const envVar of requiredEnvVars) {
      if (!process.env[envVar]) {
        this.errors.push(`Missing required environment variable: ${envVar}`);
      }
    }

    if (process.env.NODE_ENV === 'production') {
      if (process.env.JWT_SECRET === 'dev-jwt-secret-key-change-in-production') {
        this.errors.push('JWT_SECRET must be changed in production');
      }
      if (process.env.JWT_REFRESH_SECRET === 'dev-refresh-secret-key-change-in-production') {
        this.errors.push('JWT_REFRESH_SECRET must be changed in production');
      }
    }

    if (this.errors.length > 0) {
      throw new Error(`Environment validation failed:\n${this.errors.join('\n')}`);
    }

    if (this.warnings.length > 0) {
      console.warn('Environment warnings:\n', this.warnings.join('\n'));
    }

    return this.getConfig();
  }

  getConfig() {
    const databaseUrl = process.env.DATABASE_URL || '';
    let dbHost = 'unknown';
    try {
      const url = new URL(databaseUrl);
      dbHost = url.hostname;
    } catch {
      dbHost = databaseUrl;
    }

    const config = {
      nodeEnv: process.env.NODE_ENV || 'development',
      port: parseInt(process.env.PORT, 10) || 3000,
      socketPort: parseInt(process.env.SOCKET_PORT, 10) || 3001,
      database: {
        url: databaseUrl,
        host: dbHost,
        pool: {
          min: parseInt(process.env.PG_POOL_MIN, 10) || 2,
          max: parseInt(process.env.PG_POOL_MAX, 10) || 10,
          idleTimeout: parseInt(process.env.PG_POOL_IDLE_TIMEOUT, 10) || 10000
        }
      },
      jwt: {
        secret: process.env.JWT_SECRET,
        refreshSecret: process.env.JWT_REFRESH_SECRET,
        expiresIn: process.env.JWT_EXPIRES_IN || '15m',
        refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d'
      },
      client: {
        url: process.env.CLIENT_URL,
        apiUrl: process.env.CLIENT_API_URL || process.env.CLIENT_URL
      },
      security: {
        rateLimit: {
          windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 900000,
          maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 100
        }
      },
      storage: {
        provider: process.env.STORAGE_PROVIDER || 'local',
        path: process.env.STORAGE_PATH || './uploads'
      },
      email: {
        provider: process.env.EMAIL_PROVIDER || 'console',
        from: process.env.EMAIL_FROM || 'noreply@khelsetu.com'
      },
      logging: {
        level: process.env.LOG_LEVEL || 'info',
        filePath: process.env.LOG_FILE_PATH || './logs/app.log'
      },
      swagger: {
        enable: process.env.SWAGGER_ENABLE === 'true',
        title: process.env.SWAGGER_TITLE || 'KhelSetu API',
        version: process.env.SWAGGER_VERSION || '1.0.0',
        description: process.env.SWAGGER_DESCRIPTION || 'Sports tournament management API'
      }
    };

    return config;
  }
}

export const env = new EnvValidator().validate();
export default env;
