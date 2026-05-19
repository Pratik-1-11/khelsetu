import db from '../../../infrastructure/postgres/index.js';
import { generateUUID } from '../../../core/utils/index.js';

export class MatchRepository {
  async findById(id) {
    const sql = `
      SELECT m.*,
        ht.name as home_team_name, ht.logo as home_team_logo,
        at.name as away_team_name, at.logo as away_team_logo,
        t.name as tournament_name, t.slug as tournament_slug
      FROM matches m
      LEFT JOIN teams ht ON m.home_team_id = ht.id
      LEFT JOIN teams at ON m.away_team_id = at.id
      LEFT JOIN tournaments t ON m.tournament_id = t.id
      WHERE m.id = ? AND m.deleted_at IS NULL
    `;
    const rows = await db.query(sql, [id]);
    return rows[0] || null;
  }

  async findByTournament(tournamentId, options = {}) {
    const { page = 1, limit = 20, status, round_number, group_name } = options;
    const offset = (page - 1) * limit;

    let sql = `
      SELECT m.*, ht.name as home_team_name, at.name as away_team_name
      FROM matches m
      LEFT JOIN teams ht ON m.home_team_id = ht.id
      LEFT JOIN teams at ON m.away_team_id = at.id
      WHERE m.tournament_id = ? AND m.deleted_at IS NULL
    `;
    const params = [tournamentId];

    if (status) {
      sql += ' AND m.status = ?';
      params.push(status);
    }
    if (round_number) {
      sql += ' AND m.round_number = ?';
      params.push(round_number);
    }
    if (group_name) {
      sql += ' AND m.group_name = ?';
      params.push(group_name);
    }

    sql += ' ORDER BY m.scheduled_at, m.match_number LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rows = await db.query(sql, params);

    const countSql = `SELECT COUNT(*) as total FROM matches WHERE tournament_id = ? AND deleted_at IS NULL`;
    const countResult = await db.query(countSql, [tournamentId]);

    return {
      data: rows,
      pagination: { page, limit, total: countResult[0].total, totalPages: Math.ceil(countResult[0].total / limit) }
    };
  }

  async create(data) {
    const id = data.id || generateUUID();
    const sql = `
      INSERT INTO matches (id, organization_id, tournament_id, home_team_id, away_team_id, match_number, round_number, group_name, venue, scheduled_at, status, home_score, away_score, metadata, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `;
    await db.query(sql, [
      id, data.organization_id, data.tournament_id, data.home_team_id, data.away_team_id,
      data.match_number || null, data.round_number || null, data.group_name || null, data.venue || null, data.scheduled_at || null,
      data.status || 'scheduled', data.home_score || 0, data.away_score || 0,
      JSON.stringify(data.metadata || {}), data.created_by || null
    ]);
    return this.findById(id);
  }

  async update(id, data) {
    const updateFields = [];
    const params = [];

    const allowedFields = ['match_number', 'round_number', 'group_name', 'venue', 'scheduled_at', 'started_at', 'ended_at', 'status', 'home_score', 'away_score', 'home_extra_time_score', 'away_extra_time_score', 'home_penalty_score', 'away_penalty_score', 'winner_id', 'metadata'];
    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        updateFields.push(`${field} = ?`);
        params.push(field === 'metadata' ? JSON.stringify(data[field] || {}) : data[field]);
      }
    }

    if (updateFields.length === 0) return this.findById(id);

    params.push(id);
    const sql = `UPDATE matches SET ${updateFields.join(', ')}, updated_at = NOW() WHERE id = ? AND deleted_at IS NULL`;
    await db.query(sql, params);
    return this.findById(id);
  }

  async softDelete(id) {
    const sql = `UPDATE matches SET deleted_at = NOW() WHERE id = ?`;
    const result = await db.query(sql, [id]);
    return result.rowCount > 0;
  }

  async addOfficial(matchId, userId, role) {
    const id = generateUUID();
    const sql = `INSERT INTO match_officials (id, match_id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, NOW(), NOW())`;
    await db.query(sql, [id, matchId, userId, role]);
    return { match_id: matchId, user_id: userId, role };
  }

  async removeOfficial(matchId, userId) {
    const sql = `UPDATE match_officials SET deleted_at = NOW() WHERE match_id = ? AND user_id = ?`;
    const result = await db.query(sql, [matchId, userId]);
    return result.rowCount > 0;
  }

  async getOfficials(matchId) {
    const sql = `
      SELECT mo.*, u.first_name, u.last_name, u.email
      FROM match_officials mo
      LEFT JOIN users u ON mo.user_id = u.id
      WHERE mo.match_id = ? AND mo.deleted_at IS NULL
    `;
    return db.query(sql, [matchId]);
  }
}

export default new MatchRepository();