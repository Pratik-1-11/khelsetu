import db from '../postgres/index.js';
import { generateUUID } from '../../core/utils/index.js';

export class BaseRepository {
  constructor(tableName) {
    this.tableName = tableName;
  }

  async findById(id, organizationId = null) {
    let sql = `SELECT * FROM ${this.tableName} WHERE id = $1 AND deleted_at IS NULL`;
    const params = [id];

    if (organizationId) {
      sql += ' AND organization_id = $2';
      params.push(organizationId);
    }

    const result = await db.query(sql, params);
    return result.rows[0] || null;
  }

  async findAll(options = {}) {
    const { organizationId, page = 1, limit = 20, sort = 'created_at', order = 'DESC' } = options;

    let sql = `SELECT * FROM ${this.tableName} WHERE deleted_at IS NULL`;
    const params = [];

    if (organizationId) {
      sql += ` AND organization_id = $${params.length + 1}`;
      params.push(organizationId);
    }

    const validSortFields = ['created_at', 'updated_at', 'name', 'id'];
    const sortField = validSortFields.includes(sort) ? sort : 'created_at';
    const sortOrder = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    sql += ` ORDER BY ${sortField} ${sortOrder}`;

    const offset = (page - 1) * limit;
    sql += ` LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await db.query(sql, params);

    let countSql = `SELECT COUNT(*) as total FROM ${this.tableName} WHERE deleted_at IS NULL`;
    const countParams = [];
    if (organizationId) {
      countSql += ` AND organization_id = $1`;
      countParams.push(organizationId);
    }
    const countResult = await db.query(countSql, countParams);
    const total = parseInt(countResult.rows[0].total, 10);

    return {
      data: result.rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    };
  }

  async create(data) {
    const id = data.id || generateUUID();
    const now = new Date();

    const fields = ['id', ...Object.keys(data)];
    const placeholders = fields.map((_, i) => `$${i + 1}`);
    const values = fields.map((key, i) => {
      if (key === 'id') return id;
      if (key === 'created_at' || key === 'updated_at') return now;
      if (key === 'metadata' || key === 'settings') return data[key] || {};
      return data[key];
    });

    const sql = `INSERT INTO ${this.tableName} (${fields.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`;
    const result = await db.query(sql, values);

    return result.rows[0] || this.findById(id);
  }

  async update(id, data, organizationId = null) {
    const updateFields = [];
    const params = [];

    for (const [key, value] of Object.entries(data)) {
      if (key !== 'id' && key !== 'created_at') {
        const paramIndex = params.length + 1;
        updateFields.push(`${key} = $${paramIndex}`);
        if (key === 'metadata' || key === 'settings') {
          params.push(value || {});
        } else {
          params.push(value);
        }
      }
    }

    if (updateFields.length === 0) return this.findById(id, organizationId);

    updateFields.push(`updated_at = NOW()`);
    params.push(id);

    let sql = `UPDATE ${this.tableName} SET ${updateFields.join(', ')} WHERE id = $${params.length} AND deleted_at IS NULL RETURNING *`;

    if (organizationId) {
      sql = `UPDATE ${this.tableName} SET ${updateFields.join(', ')} WHERE id = $${params.length} AND organization_id = $${params.length + 1} AND deleted_at IS NULL RETURNING *`;
      params.push(organizationId);
    }

    const result = await db.query(sql, params);
    return result.rows[0] || this.findById(id, organizationId);
  }

  async softDelete(id, organizationId = null) {
    let sql = `UPDATE ${this.tableName} SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL`;
    const params = [id];

    if (organizationId) {
      sql = `UPDATE ${this.tableName} SET deleted_at = NOW() WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`;
      params.push(organizationId);
    }

    const result = await db.query(sql, params);
    return result.rowCount > 0;
  }

  async hardDelete(id) {
    const sql = `DELETE FROM ${this.tableName} WHERE id = $1`;
    const result = await db.query(sql, [id]);
    return result.rowCount > 0;
  }

  async exists(id) {
    const sql = `SELECT 1 FROM ${this.tableName} WHERE id = $1 AND deleted_at IS NULL`;
    const result = await db.query(sql, [id]);
    return result.rows.length > 0;
  }

  async count(organizationId = null) {
    let sql = `SELECT COUNT(*) as total FROM ${this.tableName} WHERE deleted_at IS NULL`;
    const params = [];

    if (organizationId) {
      sql += ` AND organization_id = $1`;
      params.push(organizationId);
    }

    const result = await db.query(sql, params);
    return parseInt(result.rows[0].total, 10);
  }
}

export default BaseRepository;
