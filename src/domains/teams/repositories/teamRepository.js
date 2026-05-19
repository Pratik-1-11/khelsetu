import db from '../../../infrastructure/postgres/index.js';
import { generateUUID } from '../../../core/utils/index.js';

export class TeamRepository {
  async findById(id) {
    const sql = `SELECT * FROM teams WHERE id = ? AND deleted_at IS NULL`;
    const rows = await db.query(sql, [id]);
    return rows[0] || null;
  }

  async findByOrganization(organizationId, options = {}) {
    const { page = 1, limit = 20, search } = options;
    const offset = (page - 1) * limit;

    let sql = `SELECT * FROM teams WHERE organization_id = ? AND deleted_at IS NULL`;
    const params = [organizationId];

    if (search) {
      sql += ` AND (name LIKE ? OR slug LIKE ?)`;
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm);
    }

    sql += ` ORDER BY name ASC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const rows = await db.query(sql, params);

    const countSql = `SELECT COUNT(*) as total FROM teams WHERE organization_id = ? AND deleted_at IS NULL`;
    const countResult = await db.query(countSql, [organizationId]);

    return {
      data: rows,
      pagination: { page, limit, total: countResult[0].total, totalPages: Math.ceil(countResult[0].total / limit) }
    };
  }

  async create(data) {
    const id = data.id || generateUUID();
    const sql = `
      INSERT INTO teams (id, organization_id, name, slug, logo, description, home_venue, primary_color, secondary_color, metadata, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `;
    await db.query(sql, [
      id, data.organization_id, data.name, data.slug || null, data.logo || null, data.description || null,
      data.home_venue || null, data.primary_color || null, data.secondary_color || null,
      JSON.stringify(data.metadata || {}), data.created_by || null
    ]);
    return this.findById(id);
  }

  async update(id, data) {
    const updateFields = [];
    const params = [];

    const allowedFields = ['name', 'slug', 'logo', 'description', 'home_venue', 'primary_color', 'secondary_color', 'metadata'];
    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        updateFields.push(`${field} = ?`);
        params.push(field === 'metadata' ? JSON.stringify(data[field] || {}) : data[field]);
      }
    }

    if (updateFields.length === 0) return this.findById(id);

    params.push(id);
    const sql = `UPDATE teams SET ${updateFields.join(', ')}, updated_at = NOW() WHERE id = ? AND deleted_at IS NULL`;
    await db.query(sql, params);
    return this.findById(id);
  }

  async softDelete(id) {
    const sql = `UPDATE teams SET deleted_at = NOW() WHERE id = ?`;
    const result = await db.query(sql, [id]);
    return result.rowCount > 0;
  }

  async getPlayers(teamId) {
    const sql = `
      SELECT p.*, pt.role as player_role, pt.is_active as player_active, pt.joined_at
      FROM players p
      JOIN player_teams pt ON p.id = pt.player_id
      WHERE pt.team_id = ? AND pt.deleted_at IS NULL AND p.deleted_at IS NULL
      ORDER BY pt.joined_at DESC
    `;
    return db.query(sql, [teamId]);
  }
}

export default new TeamRepository();