import db from '../../infrastructure/postgres/index.js';

export class PermissionService {
  async getUserPermissions(userId, organizationId = null) {
    let sql = `
      SELECT DISTINCT p.name
      FROM permissions p
      JOIN role_permissions rp ON p.id = rp.permission_id
      JOIN user_roles ur ON rp.role_id = ur.role_id
      WHERE ur.user_id = ?
        AND ur.deleted_at IS NULL
        AND (ur.organization_id = ? OR ur.organization_id IS NULL)
    `;

    const rows = await db.query(sql, [userId, organizationId]);
    return rows.map(r => r.name);
  }

  async hasPermission(userId, permission, organizationId = null) {
    const permissions = await this.getUserPermissions(userId, organizationId);
    return permissions.includes(permission);
  }

  async hasAnyPermission(userId, permissions, organizationId = null) {
    const userPermissions = await this.getUserPermissions(userId, organizationId);
    return permissions.some(p => userPermissions.includes(p));
  }

  async hasAllPermissions(userId, permissions, organizationId = null) {
    const userPermissions = await this.getUserPermissions(userId, organizationId);
    return permissions.every(p => userPermissions.includes(p));
  }

  async getUserRoles(userId, organizationId = null) {
    let sql = `
      SELECT r.*, ur.organization_id as scope_org, ur.tournament_id as scope_tournament, ur.match_id as scope_match
      FROM roles r
      JOIN user_roles ur ON r.id = ur.role_id
      WHERE ur.user_id = ?
        AND ur.deleted_at IS NULL
    `;
    const params = [userId];

    if (organizationId) {
      sql += ' AND (ur.organization_id = ? OR ur.organization_id IS NULL)';
      params.push(organizationId);
    }

    const rows = await db.query(sql, params);
    return rows;
  }

  async getRolePermissions(roleId) {
    const sql = `
      SELECT p.*
      FROM permissions p
      JOIN role_permissions rp ON p.id = rp.permission_id
      WHERE rp.role_id = ?
    `;
    return db.query(sql, [roleId]);
  }
}

export const permissionService = new PermissionService();

export const requirePermission = (permission) => {
  return async (req, res, next) => {
    try {
      const organizationId = req.headers['x-organization-id'] || null;
      const hasPermission = await permissionService.hasPermission(req.user.userId, permission, organizationId);

      if (!hasPermission) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: `Permission denied: ${permission}`
          }
        });
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

export const requireAnyPermission = (permissions) => {
  return async (req, res, next) => {
    try {
      const organizationId = req.headers['x-organization-id'] || null;
      const hasPermission = await permissionService.hasAnyPermission(req.user.userId, permissions, organizationId);

      if (!hasPermission) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'None of the required permissions granted'
          }
        });
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

export const requireAllPermissions = (permissions) => {
  return async (req, res, next) => {
    try {
      const organizationId = req.headers['x-organization-id'] || null;
      const hasPermission = await permissionService.hasAllPermissions(req.user.userId, permissions, organizationId);

      if (!hasPermission) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'All required permissions not granted'
          }
        });
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

export const requireRole = (roleName) => {
  return async (req, res, next) => {
    try {
      const organizationId = req.headers['x-organization-id'] || null;
      const roles = await permissionService.getUserRoles(req.user.userId, organizationId);
      const hasRole = roles.some(r => r.name === roleName);

      if (!hasRole) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: `Role required: ${roleName}`
          }
        });
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

export default {
  permissionService,
  requirePermission,
  requireAnyPermission,
  requireAllPermissions,
  requireRole
};