import db from '../../../infrastructure/postgres/index.js';
import { generateUUID } from '../../../core/utils/index.js';

export class PossessionRepository {
  async findByMatch(matchId) {
    const sql = `SELECT * FROM match_possession WHERE match_id = ?`;
    const rows = await db.query(sql, [matchId]);
    return rows[0] || null;
  }

  async create(data) {
    const id = data.id || generateUUID();
    const sql = `
      INSERT INTO match_possession (id, match_id, current_possession_team_id, possession_arrow_team_id)
      VALUES (?, ?, ?, ?)
    `;
    await db.query(sql, [
      id,
      data.match_id,
      data.current_possession_team_id,
      data.possession_arrow_team_id
    ]);
    return this.findByMatch(data.match_id);
  }

  async update(matchId, data) {
    const fields = [];
    const params = [];

    if (data.current_possession_team_id !== undefined) {
      fields.push('current_possession_team_id = ?');
      params.push(data.current_possession_team_id);
    }
    if (data.possession_arrow_team_id !== undefined) {
      fields.push('possession_arrow_team_id = ?');
      params.push(data.possession_arrow_team_id);
    }
    if (data.last_possession_event_id !== undefined) {
      fields.push('last_possession_event_id = ?');
      params.push(data.last_possession_event_id);
    }

    if (fields.length === 0) {
      return this.findByMatch(matchId);
    }

    params.push(matchId);
    await db.query(`UPDATE match_possession SET ${fields.join(', ')} WHERE match_id = ?`, params);
    return this.findByMatch(matchId);
  }

  async delete(matchId) {
    const sql = `DELETE FROM match_possession WHERE match_id = ?`;
    return db.query(sql, [matchId]);
  }

  async initialize(matchId, homeTeamId, awayTeamId) {
    const existing = await this.findByMatch(matchId);
    if (existing) return existing;

    return this.create({
      match_id: matchId,
      current_possession_team_id: homeTeamId,
      possession_arrow_team_id: awayTeamId
    });
  }
}

export default new PossessionRepository();