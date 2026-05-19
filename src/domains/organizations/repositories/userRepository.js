import db from '../../../infrastructure/postgres/index.js';
import { generateUUID } from '../../../core/utils/index.js';

export class UserRepository {
  async findById(id) {
    const sql = `SELECT id, email, first_name, last_name, phone, avatar, is_active, email_verified, last_login_at, metadata, created_at, updated_at FROM users WHERE id = ? AND deleted_at IS NULL`;
    const rows = await db.query(sql, [id]);
    return rows[0] || null;
  }

  async findByEmail(email) {
    const sql = `SELECT * FROM users WHERE email = ? AND deleted_at IS NULL`;
    const rows = await db.query(sql, [email.toLowerCase()]);
    return rows[0] || null;
  }

  async create(data) {
    const id = data.id || generateUUID();
    const sql = `
      INSERT INTO users (id, email, password_hash, first_name, last_name, phone, avatar, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `;
    await db.query(sql, [
      id,
      data.email.toLowerCase(),
      data.password_hash,
      data.first_name,
      data.last_name || null,
      data.phone || null,
      data.avatar || null,
      JSON.stringify(data.metadata || {})
    ]);
    return this.findById(id);
  }

  async update(id, data) {
    const updateFields = [];
    const params = [];

    const allowedFields = ['first_name', 'last_name', 'phone', 'avatar', 'is_active', 'email_verified', 'last_login_at', 'metadata'];
    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        updateFields.push(`${field} = ?`);
        if (field === 'metadata') {
          params.push(JSON.stringify(data[field] || {}));
        } else {
          params.push(data[field]);
        }
      }
    }

    if (updateFields.length === 0) return this.findById(id);

    params.push(id);
    const sql = `UPDATE users SET ${updateFields.join(', ')}, updated_at = NOW() WHERE id = ?`;
    await db.query(sql, params);
    return this.findById(id);
  }

  async updatePassword(id, passwordHash) {
    const sql = `UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = ?`;
    await db.query(sql, [passwordHash, id]);
    return this.findById(id);
  }

  async softDelete(id) {
    const sql = `UPDATE users SET deleted_at = NOW() WHERE id = ?`;
    const result = await db.query(sql, [id]);
    return result.rowCount > 0;
  }

  async findAll(options = {}) {
    const { page = 1, limit = 20, search } = options;
    const offset = (page - 1) * limit;

    let sql = `SELECT id, email, first_name, last_name, phone, avatar, is_active, email_verified, created_at FROM users WHERE deleted_at IS NULL`;
    const params = [];

    if (search) {
      sql += ` AND (email LIKE ? OR first_name LIKE ? OR last_name LIKE ?)`;
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const rows = await db.query(sql, params);

    const countSql = `SELECT COUNT(*) as total FROM users WHERE deleted_at IS NULL`;
    const countResult = await db.query(countSql);
    const total = countResult[0].total;

    return {
      data: rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    };
  }

  async getUserOrganizations(userId) {
    const sql = `
      SELECT o.*, om.role as member_role, om.is_active as member_active
      FROM organizations o
      JOIN organization_members om ON o.id = om.organization_id
      WHERE om.user_id = ? AND om.is_active = TRUE AND o.deleted_at IS NULL AND om.deleted_at IS NULL
      ORDER BY om.joined_at DESC
    `;
    return db.query(sql, [userId]);
  }
}

export default new UserRepository();