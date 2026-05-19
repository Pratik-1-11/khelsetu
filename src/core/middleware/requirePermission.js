import rbacService from '../../domains/rbac/services/rbacService.js';
import { ForbiddenError } from '../errors/index.js';

export function requirePermission(permission) {
  return async (req, res, next) => {
    const userId = req.user.userId;
    const orgId = req.tenant?.organizationId || req.body.organization_id || req.query.organization_id;

    const has = await rbacService.hasPermission(userId, permission, orgId);
    if (!has) {
      throw new ForbiddenError(`Permission '${permission}' required`);
    }
    next();
  };
}

export function requireAnyPermission(permissions) {
  return async (req, res, next) => {
    const userId = req.user.userId;
    const orgId = req.tenant?.organizationId || req.body.organization_id || req.query.organization_id;

    for (const perm of permissions) {
      if (await rbacService.hasPermission(userId, perm, orgId)) {
        return next();
      }
    }
    throw new ForbiddenError(`One of these permissions required: ${permissions.join(', ')}`);
  };
}

export function requireAllPermissions(permissions) {
  return async (req, res, next) => {
    const userId = req.user.userId;
    const orgId = req.tenant?.organizationId || req.body.organization_id || req.query.organization_id;

    for (const perm of permissions) {
      const has = await rbacService.hasPermission(userId, perm, orgId);
      if (!has) {
        throw new ForbiddenError(`Permission '${perm}' required`);
      }
    }
    next();
  };
}

export function requireRole(roleName) {
  return async (req, res, next) => {
    const orgId = req.tenant?.organizationId;
    const roles = await rbacService.getEffectiveRoles(req.user.userId, orgId);
    const hasRole = roles.some(r => r.name === roleName);
    if (!hasRole) {
      throw new ForbiddenError(`Role '${roleName}' required`);
    }
    next();
  };
}

export function requireSuperAdmin() {
  return async (req, res, next) => {
    const roles = await rbacService.getUserRoles(req.user.userId);
    const isSuperAdmin = roles.some(r => r.name === 'Super Admin' && !r.organization_id);
    if (!isSuperAdmin) {
      throw new ForbiddenError('Super admin access required');
    }
    next();
  };
}

export default {
  requirePermission,
  requireAnyPermission,
  requireAllPermissions,
  requireRole,
  requireSuperAdmin
};
