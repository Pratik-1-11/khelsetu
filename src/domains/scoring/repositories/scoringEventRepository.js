import db from '../../../infrastructure/postgres/index.js';
import { generateUUID } from '../../../core/utils/index.js';

export class ScoringEventRepository {
  async findById(id) {
    const sql = `SELECT * FROM scoring_events WHERE id = ?`;
    const rows = await db.query(sql, [id]);
    return rows[0] || null;
  }

  async findByMatch(matchId, options = {}) {
    const { includeReversed = false } = options;
    let sql = `SELECT * FROM scoring_events WHERE match_id = ?`;
    const params = [matchId];

    if (!includeReversed) {
      sql += ' AND is_reversed = FALSE';
    }

    sql += ' ORDER BY sequence_number ASC';

    return db.query(sql, params);
  }

  async findByClientEventId(clientEventId) {
    const sql = `SELECT * FROM scoring_events WHERE client_event_id = ?`;
    const rows = await db.query(sql, [clientEventId]);
    return rows[0] || null;
  }

  async create(data) {
    const id = data.id || generateUUID();
    const sql = `
      INSERT INTO scoring_events (id, match_id, organization_id, client_event_id, event_type, team_id, player_id, minute, extra_minute, metadata, is_reversed, created_by, created_at, sequence_number)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(sequence_number), 0) + 1 FROM scoring_events WHERE match_id = ?))
    `;
    await db.query(sql, [
      id, data.match_id, data.organization_id, data.client_event_id, data.event_type,
      data.team_id, data.player_id, data.minute, data.extra_minute,
      JSON.stringify(data.metadata || {}), data.is_reversed || false, data.created_by,
      data.match_id
    ]);
    return this.findById(id);
  }

  async reverse(id, reversedBy) {
    const sql = `UPDATE scoring_events SET is_reversed = TRUE, reversed_by = ?, reversed_at = NOW() WHERE id = ?`;
    await db.query(sql, [reversedBy, id]);
    return this.findById(id);
  }

  async getLatestSequenceNumber(matchId) {
    const sql = `SELECT COALESCE(MAX(sequence_number), 0) as seq FROM scoring_events WHERE match_id = ?`;
    const rows = await db.query(sql, [matchId]);
    return rows[0].seq;
  }

  async getEventCount(matchId) {
    const sql = `SELECT COUNT(*) as count FROM scoring_events WHERE match_id = ? AND is_reversed = FALSE`;
    const rows = await db.query(sql, [matchId]);
    return rows[0].count;
  }

  async getEventsByPlayer(playerId) {
    const sql = `
      SELECT se.*, m.tournament_id, m.home_team_id, m.away_team_id
      FROM scoring_events se
      JOIN matches m ON se.match_id = m.id
      WHERE se.player_id = ? AND se.is_reversed = FALSE
      ORDER BY se.created_at DESC
    `;
    return db.query(sql, [playerId]);
  }

  async getEventsByTeam(matchId, teamId) {
    const sql = `
      SELECT * FROM scoring_events WHERE match_id = ? AND team_id = ? AND is_reversed = FALSE ORDER BY sequence_number ASC
    `;
    return db.query(sql, [matchId, teamId]);
  }

  async getEventsByType(matchId, eventType) {
    const sql = `SELECT * FROM scoring_events WHERE match_id = ? AND event_type = ? AND is_reversed = FALSE ORDER BY sequence_number ASC`;
    return db.query(sql, [matchId, eventType]);
  }
}

export default new ScoringEventRepository();