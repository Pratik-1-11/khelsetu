import db from '../../../infrastructure/postgres/index.js';
import { generateUUID } from '../../../core/utils/index.js';

export class FreeThrowRepository {
  async findByMatch(matchId) {
    const sql = `
      SELECT ft.*, pshooter.first_name as shooter_first, pshooter.last_name as shooter_last,
             pfouled.first_name as fouled_first, pfouled.last_name as fouled_last
      FROM free_throw_sequences ft
      LEFT JOIN players pshooter ON ft.shooting_player_id = pshooter.id
      LEFT JOIN players pfouled ON ft.fouled_player_id = pfouled.id
      WHERE ft.match_id = ?
      ORDER BY ft.created_at, ft.shot_number
    `;
    return db.query(sql, [matchId]);
  }

  async findPending(matchId, shootingTeamId) {
    const sql = `
      SELECT * FROM free_throw_sequences
      WHERE match_id = ? AND shooting_team_id = ? AND is_completed = FALSE
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const rows = await db.query(sql, [matchId, shootingTeamId]);
    return rows[0] || null;
  }

  async findById(id) {
    const sql = `SELECT * FROM free_throw_sequences WHERE id = ?`;
    const rows = await db.query(sql, [id]);
    return rows[0] || null;
  }

  async create(data) {
    const id = data.id || generateUUID();
    const sql = `
      INSERT INTO free_throw_sequences (
        id, match_id, shooting_team_id, shooting_player_id, fouled_player_id,
        shot_number, total_shots, shot_type, quarter, game_minute, game_second,
        sequence_number, is_completed, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, FALSE, NOW())
    `;
    await db.query(sql, [
      id,
      data.match_id,
      data.shooting_team_id,
      data.shooting_player_id,
      data.fouled_player_id || null,
      data.shot_number,
      data.total_shots,
      data.shot_type,
      data.quarter,
      data.game_minute,
      data.game_second,
      data.sequence_number || 0
    ]);
    return this.findById(id);
  }

  async recordShot(id, made) {
    const ft = await this.findById(id);
    if (!ft) return null;

    const sql = `
      UPDATE free_throw_sequences
      SET made = ?, is_completed = ?
      WHERE id = ?
    `;
    const isCompleted = ft.shot_number >= ft.total_shots;
    await db.query(sql, [made ? 1 : 0, isCompleted ? 1 : 0, id]);

    return this.findById(id);
  }

  async complete(id) {
    const sql = `UPDATE free_throw_sequences SET is_completed = TRUE WHERE id = ?`;
    return db.query(sql, [id]);
  }

  async getTeamFreeThrowStats(matchId, teamId) {
    const sql = `
      SELECT
        COUNT(*) as total_attempts,
        SUM(CASE WHEN made = TRUE THEN 1 ELSE 0 END) as made,
        SUM(CASE WHEN made = FALSE THEN 1 ELSE 0 END) as missed
      FROM free_throw_sequences
      WHERE match_id = ? AND shooting_team_id = ?
    `;
    const rows = await db.query(sql, [matchId, teamId]);
    return rows[0];
  }
}

export default new FreeThrowRepository();