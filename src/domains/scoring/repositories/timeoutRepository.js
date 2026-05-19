import db from '../../../infrastructure/postgres/index.js';
import { generateUUID } from '../../../core/utils/index.js';

export class TimeoutRepository {
  async findByMatch(matchId) {
    const sql = `
      SELECT te.*, t.name as team_name
      FROM timeout_events te
      LEFT JOIN teams t ON te.team_id = t.id
      WHERE te.match_id = ?
      ORDER BY te.created_at
    `;
    return db.query(sql, [matchId]);
  }

  async findByTeam(matchId, teamId) {
    const sql = `
      SELECT * FROM timeout_events
      WHERE match_id = ? AND team_id = ? AND status = 'completed'
      ORDER BY created_at
    `;
    return db.query(sql, [matchId, teamId]);
  }

  async getTimeoutCount(matchId, teamId) {
    const sql = `
      SELECT COUNT(*) as count FROM timeout_events
      WHERE match_id = ? AND team_id = ? AND status = 'completed' AND timeout_type IN ('full', 'short')
    `;
    const rows = await db.query(sql, [matchId, teamId]);
    return rows[0].count;
  }

  async findById(id) {
    const sql = `SELECT * FROM timeout_events WHERE id = ?`;
    const rows = await db.query(sql, [id]);
    return rows[0] || null;
  }

  async create(data) {
    const id = data.id || generateUUID();
    const sql = `
      INSERT INTO timeout_events (
        id, match_id, team_id, timeout_type, quarter, minute, second,
        remaining_from_original, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'granted', NOW())
    `;
    await db.query(sql, [
      id,
      data.match_id,
      data.team_id,
      data.timeout_type,
      data.quarter,
      data.minute,
      data.second,
      data.remaining_from_original
    ]);
    return this.findById(id);
  }

  async complete(id) {
    const sql = `UPDATE timeout_events SET status = 'completed' WHERE id = ?`;
    return db.query(sql, [id]);
  }

  async cancel(id) {
    const sql = `UPDATE timeout_events SET status = 'cancelled' WHERE id = ?`;
    return db.query(sql, [id]);
  }
}

export default new TimeoutRepository();