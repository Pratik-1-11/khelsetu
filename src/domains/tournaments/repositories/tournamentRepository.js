import db from '../../../infrastructure/postgres/index.js';
import { generateUUID } from '../../../core/utils/index.js';

export class TournamentRepository {
  async findById(id) {
    const sql = `
      SELECT t.*, s.name as sport_name, s.slug as sport_slug
      FROM tournaments t
      LEFT JOIN sports s ON t.sport_id = s.id
      WHERE t.id = ? AND t.deleted_at IS NULL
    `;
    const rows = await db.query(sql, [id]);
    return rows[0] || null;
  }

  async findByOrganization(organizationId, options = {}) {
    const { page = 1, limit = 20, status } = options;
    const offset = (page - 1) * limit;

    let sql = `SELECT t.*, s.name as sport_name FROM tournaments t LEFT JOIN sports s ON t.sport_id = s.id WHERE t.organization_id = ? AND t.deleted_at IS NULL`;
    const params = [organizationId];

    if (status) {
      sql += ' AND t.status = ?';
      params.push(status);
    }

    sql += ' ORDER BY t.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rows = await db.query(sql, params);

    const countSql = `SELECT COUNT(*) as total FROM tournaments WHERE organization_id = ? AND deleted_at IS NULL${status ? ' AND status = ?' : ''}`;
    const countParams = status ? [organizationId, status] : [organizationId];
    const countResult = await db.query(countSql, countParams);

    return {
      data: rows,
      pagination: { page, limit, total: countResult[0].total, totalPages: Math.ceil(countResult[0].total / limit) }
    };
  }

  async create(data) {
    const id = data.id || generateUUID();
    const sql = `
      INSERT INTO tournaments (id, organization_id, sport_id, name, slug, description, format, status, start_date, end_date, registration_deadline, max_teams, min_teams, venue, rules, settings, metadata, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `;
    await db.query(sql, [
      id, data.organization_id, data.sport_id, data.name, data.slug || null, data.description || null, data.format || 'league', data.status || 'draft',
      data.start_date || null, data.end_date || null, data.registration_deadline || null, data.max_teams || null, data.min_teams || null, data.venue || null,
      JSON.stringify(data.rules || {}), JSON.stringify(data.settings || {}), JSON.stringify(data.metadata || {}),
      data.created_by || null
    ]);
    return this.findById(id);
  }

  async update(id, data) {
    const updateFields = [];
    const params = [];

    const allowedFields = ['name', 'slug', 'description', 'format', 'status', 'start_date', 'end_date', 'registration_deadline', 'max_teams', 'min_teams', 'venue', 'rules', 'settings', 'metadata'];
    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        updateFields.push(`${field} = ?`);
        if (field === 'rules' || field === 'settings' || field === 'metadata') {
          params.push(JSON.stringify(data[field]));
        } else {
          params.push(data[field]);
        }
      }
    }

    if (updateFields.length === 0) return this.findById(id);

    params.push(id);
    const sql = `UPDATE tournaments SET ${updateFields.join(', ')}, updated_at = NOW() WHERE id = ? AND deleted_at IS NULL`;
    await db.query(sql, params);
    return this.findById(id);
  }

  async softDelete(id) {
    const sql = `UPDATE tournaments SET deleted_at = NOW() WHERE id = ?`;
    const result = await db.query(sql, [id]);
    return result.rowCount > 0;
  }

  async getRegisteredTeams(tournamentId) {
    const sql = `
      SELECT tt.*, t.name as team_name, t.slug as team_slug, t.logo
      FROM tournament_teams tt
      JOIN teams t ON tt.team_id = t.id
      WHERE tt.tournament_id = ? AND tt.deleted_at IS NULL
      ORDER BY tt.seed_number, tt.created_at
    `;
    return db.query(sql, [tournamentId]);
  }

  async addTeam(tournamentId, teamId, seedNumber = null) {
    const id = generateUUID();
    const sql = `INSERT INTO tournament_teams (id, tournament_id, team_id, seed_number, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'registered', NOW(), NOW())`;
    await db.query(sql, [id, tournamentId, teamId, seedNumber]);
    return { tournament_id: tournamentId, team_id: teamId };
  }

  async removeTeam(tournamentId, teamId) {
    const sql = `UPDATE tournament_teams SET deleted_at = NOW() WHERE tournament_id = ? AND team_id = ?`;
    const result = await db.query(sql, [tournamentId, teamId]);
    return result.rowCount > 0;
  }
}

export default new TournamentRepository();