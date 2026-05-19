import db from '../../../infrastructure/postgres/index.js';
import { generateUUID } from '../../../core/utils/index.js';

export class MembershipRepository {
  async findById(id) {
    const sql = `SELECT * FROM organization_members WHERE id = ? AND deleted_at IS NULL`;
    const rows = await db.query(sql, [id]);
    return rows[0] || null;
  }

  async findByUserAndOrg(userId, organizationId) {
    const sql = `SELECT * FROM organization_members WHERE user_id = ? AND organization_id = ? AND deleted_at IS NULL`;
    const rows = await db.query(sql, [userId, organizationId]);
    return rows[0] || null;
  }

  async create(data) {
    const id = data.id || generateUUID();
    const sql = `
      INSERT INTO organization_members (id, organization_id, user_id, role, is_active, joined_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, NOW(), NOW(), NOW())
    `;
    await db.query(sql, [
      id,
      data.organization_id,
      data.user_id,
      data.role || 'member',
      data.is_active !== undefined ? data.is_active : true
    ]);
    return this.findById(id);
  }

  async update(id, data) {
    const updateFields = [];
    const params = [];

    if (data.role !== undefined) {
      updateFields.push('role = ?');
      params.push(data.role);
    }
    if (data.is_active !== undefined) {
      updateFields.push('is_active = ?');
      params.push(data.is_active);
    }

    if (updateFields.length === 0) return this.findById(id);

    params.push(id);
    const sql = `UPDATE organization_members SET ${updateFields.join(', ')}, updated_at = NOW() WHERE id = ? AND deleted_at IS NULL`;
    await db.query(sql, params);
    return this.findById(id);
  }

  async softDelete(id) {
    const sql = `UPDATE organization_members SET deleted_at = NOW() WHERE id = ?`;
    const result = await db.query(sql, [id]);
    return result.rowCount > 0;
  }

  async findByOrganization(organizationId, options = {}) {
    const { page = 1, limit = 20, includeInactive = false } = options;
    const offset = (page - 1) * limit;

    let sql = `
      SELECT om.*, u.email, u.first_name, u.last_name, u.avatar
      FROM organization_members om
      JOIN users u ON om.user_id = u.id
      WHERE om.organization_id = ? AND om.deleted_at IS NULL
    `;
    const params = [organizationId];

    if (!includeInactive) {
      sql += ` AND om.is_active = TRUE`;
    }

    sql += ` ORDER BY om.joined_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const rows = await db.query(sql, params);

    const countSql = `SELECT COUNT(*) as total FROM organization_members WHERE organization_id = ? AND deleted_at IS NULL`;
    const countResult = await db.query(countSql, [organizationId]);
    const total = countResult[0].total;

    return {
      data: rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    };
  }

  async removeUser(userId, organizationId) {
    const sql = `UPDATE organization_members SET deleted_at = NOW() WHERE user_id = ? AND organization_id = ? AND deleted_at IS NULL`;
    const result = await db.query(sql, [userId, organizationId]);
    return result.rowCount > 0;
  }
}

export default new MembershipRepository();