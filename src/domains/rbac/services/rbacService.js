import db from '../../../infrastructure/postgres/index.js';
import { NotFoundError, ForbiddenError, ValidationError } from '../../../core/errors/index.js';
import { v4 as uuidv4 } from 'uuid';

class RbacService {
  async getAllPermissions(filters = {}) {
    const connection = await db.getConnection();
    try {
      let whereClause = '1=1';
      const params = [];

      if (filters.category) {
        whereClause += ' AND category = ?';
        params.push(filters.category);
      }

      if (filters.search) {
        whereClause += ' AND (name LIKE ? OR description LIKE ?)';
        params.push(`%${filters.search}%`, `%${filters.search}%`);
      }

      const [permissions] = await connection.query(
        `SELECT * FROM permissions WHERE ${whereClause} ORDER BY category, name`,
        params
      );

      const categories = {};
      permissions.forEach(p => {
        if (!categories[p.category]) categories[p.category] = [];
        categories[p.category].push(p);
      });

      return { list: permissions, by_category: categories };
    } finally {
      connection.release();
    }
  }

  async getPermissionById(permissionId) {
    const connection = await db.getConnection();
    try {
      const [permission] = await connection.query(
        `SELECT * FROM permissions WHERE id = ?`,
        [permissionId]
      );
      if (!permission.length) throw new NotFoundError('Permission not found');
      return permission[0];
    } finally {
      connection.release();
    }
  }

  async getAllRoles(filters = {}) {
    const connection = await db.getConnection();
    try {
      let whereClause = '1=1';
      const params = [];

      if (filters.scope) {
        whereClause += ' AND scope = ?';
        params.push(filters.scope);
      }

      if (filters.is_system !== undefined) {
        whereClause += ' AND is_system = ?';
        params.push(filters.is_system);
      }

      if (filters.organization_id) {
        // Filter roles by scope: if org_id provided, show org-scoped + global roles
        // Note: organization_id column on roles table may not exist yet (added by migration 006)
        whereClause += ' AND (r.scope != \'organization\' OR r.scope IS NULL OR r.scope = \'global\')';
      }

      const [roles] = await connection.query(
        `SELECT r.*, 
           (SELECT COUNT(*) FROM role_permissions rp WHERE rp.role_id = r.id) as permission_count
         FROM roles r 
         WHERE ${whereClause} AND r.deleted_at IS NULL
         ORDER BY r.is_system DESC, r.name`,
        params
      );

      return roles;
    } finally {
      connection.release();
    }
  }

  async getRoleById(roleId) {
    const connection = await db.getConnection();
    try {
      const [role] = await connection.query(
        `SELECT * FROM roles WHERE id = ? AND deleted_at IS NULL`,
        [roleId]
      );
      if (!role.length) throw new NotFoundError('Role not found');

      const [permissions] = await connection.query(
        `SELECT p.* FROM permissions p
         JOIN role_permissions rp ON p.id = rp.permission_id
         WHERE rp.role_id = ?`,
        [roleId]
      );

      return { ...role[0], permissions };
    } finally {
      connection.release();
    }
  }

  async createRole(data, createdBy) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      const roleId = uuidv4();
      await connection.query(
        `INSERT INTO roles (id, name, description, scope, is_system)
         VALUES (?, ?, ?, ?, FALSE)`,
        [roleId, data.name, data.description || null, data.scope || 'organization']
      );

      if (data.permission_ids && data.permission_ids.length > 0) {
        for (const permId of data.permission_ids) {
          await connection.query(
            `INSERT INTO role_permissions (id, role_id, permission_id) VALUES (?, ?, ?)`,
            [uuidv4(), roleId, permId]
          );
        }
      }

      await connection.commit();

      return await this.getRoleById(roleId);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async updateRole(roleId, userId, data) {
    const connection = await db.getConnection();
    try {
      const [role] = await connection.query(
        `SELECT * FROM roles WHERE id = ? AND deleted_at IS NULL`,
        [roleId]
      );
      if (!role.length) throw new NotFoundError('Role not found');
      if (role[0].is_system) throw new ValidationError('Cannot modify system roles');

      await connection.beginTransaction();

      if (data.name || data.description) {
        await connection.query(
          `UPDATE roles SET name = COALESCE(?, name), description = COALESCE(?, description)
           WHERE id = ?`,
          [data.name, data.description, roleId]
        );
      }

      if (data.permission_ids !== undefined) {
        await connection.query(`DELETE FROM role_permissions WHERE role_id = ?`, [roleId]);
        
        for (const permId of data.permission_ids) {
          await connection.query(
            `INSERT INTO role_permissions (id, role_id, permission_id) VALUES (?, ?, ?)`,
            [uuidv4(), roleId, permId]
          );
        }
      }

      await connection.commit();
      return await this.getRoleById(roleId);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async deleteRole(roleId, userId) {
    const connection = await db.getConnection();
    try {
      const [role] = await connection.query(
        `SELECT * FROM roles WHERE id = ? AND deleted_at IS NULL`,
        [roleId]
      );
      if (!role.length) throw new NotFoundError('Role not found');
      if (role[0].is_system) throw new ValidationError('Cannot delete system roles');

      const [assignments] = await connection.query(
        `SELECT COUNT(*) as count FROM user_roles WHERE role_id = ? AND deleted_at IS NULL`,
        [roleId]
      );
      if (assignments[0].count > 0) throw new ValidationError('Cannot delete role with active assignments');

      await connection.query(
        `UPDATE roles SET deleted_at = NOW() WHERE id = ?`,
        [roleId]
      );

      return { message: 'Role deleted successfully' };
    } finally {
      connection.release();
    }
  }

  async addPermissionsToRole(roleId, permissionIds) {
    const connection = await db.getConnection();
    try {
      const [role] = await connection.query(
        `SELECT * FROM roles WHERE id = ? AND deleted_at IS NULL`,
        [roleId]
      );
      if (!role.length) throw new NotFoundError('Role not found');
      if (role[0].is_system) throw new ValidationError('Cannot modify system roles');

      await connection.beginTransaction();

      for (const permId of permissionIds) {
        const [existing] = await connection.query(
          `SELECT id FROM role_permissions WHERE role_id = ? AND permission_id = ?`,
          [roleId, permId]
        );
        if (!existing.length) {
          await connection.query(
            `INSERT INTO role_permissions (id, role_id, permission_id) VALUES (?, ?, ?)`,
            [uuidv4(), roleId, permId]
          );
        }
      }

      await connection.commit();
      return await this.getRoleById(roleId);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async removePermissionFromRole(roleId, permissionId) {
    const connection = await db.getConnection();
    try {
      const [role] = await connection.query(
        `SELECT * FROM roles WHERE id = ? AND deleted_at IS NULL`,
        [roleId]
      );
      if (!role.length) throw new NotFoundError('Role not found');
      if (role[0].is_system) throw new ValidationError('Cannot modify system roles');

      await connection.query(
        `DELETE FROM role_permissions WHERE role_id = ? AND permission_id = ?`,
        [roleId, permissionId]
      );

      return { message: 'Permission removed from role' };
    } finally {
      connection.release();
    }
  }

  async getUserPermissions(userId, organizationId) {
    const connection = await db.getConnection();
    try {
      let query = `
        SELECT DISTINCT p.* FROM permissions p
        JOIN role_permissions rp ON p.id = rp.permission_id
        JOIN user_roles ur ON rp.role_id = ur.role_id
        WHERE ur.user_id = ? AND ur.deleted_at IS NULL
      `;
      const params = [userId];

      if (organizationId) {
        query += ` AND (ur.organization_id = ? OR ur.organization_id IS NULL)`;
        params.push(organizationId);
      }

      const [permissions] = await connection.query(query, params);

      const [directPermissions] = await connection.query(
        `SELECT p.* FROM permissions p
         WHERE p.id IN (SELECT permission_id FROM user_roles WHERE user_id = ? AND deleted_at IS NULL AND permission_id IS NOT NULL)`,
        [userId]
      );

      const allPerms = [...new Map([...permissions, ...directPermissions].map(p => [p.id, p])).values()];

      return {
        from_roles: permissions,
        effective: allPerms
      };
    } finally {
      connection.release();
    }
  }

  async getUserRoles(userId) {
    const connection = await db.getConnection();
    try {
      const [roles] = await connection.query(
        `SELECT r.*, ur.organization_id, ur.tournament_id, ur.match_id, ur.created_at as assigned_at
         FROM roles r
         JOIN user_roles ur ON r.id = ur.role_id
         WHERE ur.user_id = ? AND ur.deleted_at IS NULL AND r.deleted_at IS NULL
         ORDER BY r.is_system DESC, r.name`,
        [userId]
      );

      return roles;
    } finally {
      connection.release();
    }
  }

  async hasPermission(userId, permissionName, organizationId) {
    const perms = await this.getUserPermissions(userId, organizationId);
    return perms.effective.some(p => p.name === permissionName);
  }

  async getEffectiveRoles(userId, organizationId) {
    const allRoles = await this.getUserRoles(userId);
    if (!organizationId) return allRoles;
    return allRoles.filter(r => !r.organization_id || r.organization_id === organizationId);
  }

  async assignRoleToUser(userId, assignedBy, data) {
    const connection = await db.getConnection();
    try {
      const [role] = await connection.query(
        `SELECT * FROM roles WHERE id = ? AND deleted_at IS NULL`,
        [data.role_id]
      );
      if (!role.length) throw new NotFoundError('Role not found');

      const [existing] = await connection.query(
        `SELECT id FROM user_roles WHERE user_id = ? AND role_id = ? AND deleted_at IS NULL`,
        [userId, data.role_id]
      );
      if (existing.length) throw new ValidationError('User already has this role');

      const userRoleId = uuidv4();
      await connection.query(
        `INSERT INTO user_roles (id, user_id, role_id, organization_id, tournament_id, match_id, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [userRoleId, userId, data.role_id, data.organization_id || null, data.tournament_id || null, data.match_id || null, assignedBy]
      );

      return { id: userRoleId, role_id: data.role_id, message: 'Role assigned successfully' };
    } finally {
      connection.release();
    }
  }

  async removeRoleFromUser(userId, roleId, removedBy) {
    const connection = await db.getConnection();
    try {
      const [assignment] = await connection.query(
        `SELECT * FROM user_roles WHERE user_id = ? AND role_id = ? AND deleted_at IS NULL`,
        [userId, roleId]
      );
      if (!assignment.length) throw new NotFoundError('Role assignment not found');

      await connection.query(
        `UPDATE user_roles SET deleted_at = NOW() WHERE user_id = ? AND role_id = ?`,
        [userId, roleId]
      );

      return { message: 'Role removed from user' };
    } finally {
      connection.release();
    }
  }
}

export default new RbacService();