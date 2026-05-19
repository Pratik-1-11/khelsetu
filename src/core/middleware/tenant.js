import db from '../../infrastructure/postgres/index.js';
import { ForbiddenError, ValidationError } from '../../core/errors/index.js';
import logger from '../../core/logger/index.js';

const PUBLIC_PATHS = [
  '/api/public',
  '/api/auth',
  '/health',
  '/api-docs',
];

function isPublicPath(path) {
  return PUBLIC_PATHS.some(p => path.startsWith(p));
}

export async function resolveTenant(req, res, next) {
  if (isPublicPath(req.path)) {
    return next();
  }

  let organizationId =
    req.headers['x-organization-id'] ||
    req.body.organization_id ||
    req.query.organization_id;

  if (!organizationId) {
    if (req.method === 'GET' && !req.path.includes(':id')) {
      return next();
    }
    return next();
  }

  if (req.user) {
    try {
      const result = await db.query(
        `SELECT 1 FROM organization_members
         WHERE organization_id = $1 AND user_id = $2 AND deleted_at IS NULL AND is_active = TRUE`,
        [organizationId, req.user.userId]
      );

      if (result.rows.length === 0) {
        logger.warn('Tenant access denied', {
          userId: req.user.userId,
          organizationId,
          path: req.path,
        });
        throw new ForbiddenError('You are not a member of this organization');
      }
    } catch (error) {
      if (error instanceof ForbiddenError) throw error;
      logger.error('Tenant resolution error', { error: error.message });
      return next();
    }
  }

  req.tenant = { organizationId };
  next();
}

export async function requireTenant(req, res, next) {
  if (isPublicPath(req.path)) {
    return next();
  }

  if (!req.tenant || !req.tenant.organizationId) {
    throw new ValidationError('Organization ID is required. Pass it via x-organization-id header, request body, or query parameter.');
  }

  next();
}

export default { resolveTenant, requireTenant };
