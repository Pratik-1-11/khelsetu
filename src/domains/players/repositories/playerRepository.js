import db from '../../../infrastructure/postgres/index.js';
import { generateUUID } from '../../../core/utils/index.js';

export class PlayerRepository {
  async findById(id) {
    const sql = `SELECT * FROM players WHERE id = ? AND deleted_at IS NULL`;
    const rows = await db.query(sql, [id]);
    return rows[0] || null;
  }

  async findByOrganization(organizationId, options = {}) {
    const { page = 1, limit = 20, search, team_id } = options;
    const offset = (page - 1) * limit;

    let sql = `SELECT p.* FROM players p WHERE p.organization_id = ? AND p.deleted_at IS NULL`;
    const params = [organizationId];

    if (team_id) {
      sql += ` AND EXISTS (SELECT 1 FROM player_teams pt WHERE pt.player_id = p.id AND pt.team_id = ? AND pt.deleted_at IS NULL)`;
      params.push(team_id);
    }

    if (search) {
      sql += ` AND (p.first_name LIKE ? OR p.last_name LIKE ? OR p.email LIKE ?)`;
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    sql += ` ORDER BY p.first_name, p.last_name LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const rows = await db.query(sql, params);

    const countSql = `SELECT COUNT(*) as total FROM players WHERE organization_id = ? AND deleted_at IS NULL`;
    const countResult = await db.query(countSql, [organizationId]);

    return {
      data: rows,
      pagination: { page, limit, total: countResult[0].total, totalPages: Math.ceil(countResult[0].total / limit) }
    };
  }

  async create(data) {
    const id = data.id || generateUUID();
    const sql = `
      INSERT INTO players (id, organization_id, first_name, last_name, email, phone, date_of_birth, gender, photo, jersey_number, position, metadata, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `;
    await db.query(sql, [
      id, data.organization_id, data.first_name, data.last_name || null, data.email || null, data.phone || null,
      data.date_of_birth || null, data.gender || null, data.photo || null, data.jersey_number || null, data.position || null,
      JSON.stringify(data.metadata || {}), data.created_by || null
    ]);
    return this.findById(id);
  }

  async update(id, data) {
    const updateFields = [];
    const params = [];

    const allowedFields = ['first_name', 'last_name', 'email', 'phone', 'date_of_birth', 'gender', 'photo', 'jersey_number', 'position', 'metadata'];
    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        updateFields.push(`${field} = ?`);
        params.push(field === 'metadata' ? JSON.stringify(data[field] || {}) : data[field]);
      }
    }

    if (updateFields.length === 0) return this.findById(id);

    params.push(id);
    const sql = `UPDATE players SET ${updateFields.join(', ')}, updated_at = NOW() WHERE id = ? AND deleted_at IS NULL`;
    await db.query(sql, params);
    return this.findById(id);
  }

  async softDelete(id) {
    const sql = `UPDATE players SET deleted_at = NOW() WHERE id = ?`;
    const result = await db.query(sql, [id]);
    return result.rowCount > 0;
  }

  async addToTeam(playerId, teamId, role = 'player') {
    const id = generateUUID();
    const sql = `INSERT INTO player_teams (id, player_id, team_id, role, is_active, joined_at, created_at, updated_at) VALUES (?, ?, ?, ?, TRUE, NOW(), NOW(), NOW())`;
    await db.query(sql, [id, playerId, teamId, role]);
    return { player_id: playerId, team_id: teamId, role };
  }

  async removeFromTeam(playerId, teamId) {
    const sql = `UPDATE player_teams SET deleted_at = NOW() WHERE player_id = ? AND team_id = ?`;
    const result = await db.query(sql, [playerId, teamId]);
    return result.rowCount > 0;
  }

  async getTeams(playerId) {
    const sql = `
      SELECT t.*, pt.role as player_role, pt.is_active as player_active, pt.joined_at
      FROM teams t
      JOIN player_teams pt ON t.id = pt.team_id
      WHERE pt.player_id = ? AND pt.deleted_at IS NULL AND t.deleted_at IS NULL
      ORDER BY pt.joined_at DESC
    `;
    return db.query(sql, [playerId]);
  }
}

export default new PlayerRepository();