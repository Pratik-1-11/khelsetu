import db from '../../../infrastructure/postgres/index.js';
import { generateUUID } from '../../../core/utils/index.js';

export class ShotClockRepository {
  async findByMatch(matchId, limit = 100) {
    const sql = `
      SELECT * FROM shot_clock_events
      WHERE match_id = ?
      ORDER BY sequence_number DESC
      LIMIT ?
    `;
    return db.query(sql, [matchId, limit]);
  }

  async getLatest(matchId) {
    const sql = `
      SELECT * FROM shot_clock_events
      WHERE match_id = ?
      ORDER BY sequence_number DESC
      LIMIT 1
    `;
    const rows = await db.query(sql, [matchId]);
    return rows[0] || null;
  }

  async create(data) {
    const id = data.id || generateUUID();
    const sql = `
      INSERT INTO shot_clock_events (
        id, match_id, event_type, reset_reason, clock_value_before, clock_value_after,
        triggered_by_player_id, quarter, game_minute, game_second, sequence_number, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `;
    await db.query(sql, [
      id,
      data.match_id,
      data.event_type,
      data.reset_reason || null,
      data.clock_value_before,
      data.clock_value_after,
      data.triggered_by_player_id || null,
      data.quarter,
      data.game_minute,
      data.game_second,
      data.sequence_number || 0
    ]);
    return this.findById(id);
  }

  async findById(id) {
    const sql = `SELECT * FROM shot_clock_events WHERE id = ?`;
    const rows = await db.query(sql, [id]);
    return rows[0] || null;
  }

  async getEventsByType(matchId, eventType) {
    const sql = `
      SELECT * FROM shot_clock_events
      WHERE match_id = ? AND event_type = ?
      ORDER BY sequence_number ASC
    `;
    return db.query(sql, [matchId, eventType]);
  }

  async getViolationCount(matchId) {
    const sql = `
      SELECT COUNT(*) as count FROM shot_clock_events
      WHERE match_id = ? AND event_type = 'violation'
    `;
    const rows = await db.query(sql, [matchId]);
    return rows[0].count;
  }
}

export default new ShotClockRepository();