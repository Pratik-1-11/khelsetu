import db from '../../../infrastructure/postgres/index.js';
import { generateUUID } from '../../../core/utils/index.js';

export class SportRepository {
  async findById(id) {
    const sql = `SELECT * FROM sports WHERE id = ? AND deleted_at IS NULL`;
    const rows = await db.query(sql, [id]);
    return rows[0] || null;
  }

  async findBySlug(slug) {
    const sql = `SELECT * FROM sports WHERE slug = ? AND deleted_at IS NULL`;
    const rows = await db.query(sql, [slug]);
    return rows[0] || null;
  }

  async create(data) {
    const id = data.id || generateUUID();
    const sql = `
      INSERT INTO sports (id, name, slug, icon, description, rules, scoring_config, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `;
    await db.query(sql, [
      id,
      data.name,
      data.slug,
      data.icon || null,
      data.description || null,
      JSON.stringify(data.rules),
      JSON.stringify(data.scoring_config),
      data.is_active !== undefined ? data.is_active : true
    ]);
    return this.findById(id);
  }

  async update(id, data) {
    const updateFields = [];
    const params = [];

    const allowedFields = ['name', 'slug', 'icon', 'description', 'rules', 'scoring_config', 'is_active'];
    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        updateFields.push(`${field} = ?`);
        if (field === 'rules' || field === 'scoring_config') {
          params.push(JSON.stringify(data[field]));
        } else {
          params.push(data[field]);
        }
      }
    }

    if (updateFields.length === 0) return this.findById(id);

    params.push(id);
    const sql = `UPDATE sports SET ${updateFields.join(', ')}, updated_at = NOW() WHERE id = ? AND deleted_at IS NULL`;
    await db.query(sql, params);
    return this.findById(id);
  }

  async softDelete(id) {
    const sql = `UPDATE sports SET deleted_at = NOW() WHERE id = ?`;
    const result = await db.query(sql, [id]);
    return result.rowCount > 0;
  }

  async findAll(options = {}) {
    const { page = 1, limit = 20, includeInactive = false } = options;
    const offset = (page - 1) * limit;

    let sql = `SELECT * FROM sports WHERE deleted_at IS NULL`;
    const params = [];

    if (!includeInactive) {
      sql += ` AND is_active = TRUE`;
    }

    sql += ` ORDER BY name ASC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const rows = await db.query(sql, params);

    const countSql = `SELECT COUNT(*) as total FROM sports WHERE deleted_at IS NULL${!includeInactive ? ' AND is_active = TRUE' : ''}`;
    const countResult = await db.query(countSql);
    const total = countResult[0].total;

    return {
      data: rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    };
  }
}

export default new SportRepository();