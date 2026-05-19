import db from '../../../infrastructure/postgres/index.js';
import { generateUUID } from '../../../core/utils/index.js';

export class JumpBallRepository {
  async findByMatch(matchId) {
    const sql = `
      SELECT jbe.*, tw.name as winner_name, t1.name as team_1_name, t2.name as team_2_name
      FROM jump_ball_events jbe
      LEFT JOIN teams tw ON jbe.winner_team_id = tw.id
      LEFT JOIN teams t1 ON jbe.team_1_id = t1.id
      LEFT JOIN teams t2 ON jbe.team_2_id = t2.id
      WHERE jbe.match_id = ?
      ORDER BY jbe.created_at
    `;
    return db.query(sql, [matchId]);
  }

  async findById(id) {
    const sql = `SELECT * FROM jump_ball_events WHERE id = ?`;
    const rows = await db.query(sql, [id]);
    return rows[0] || null;
  }

  async create(data) {
    const id = data.id || generateUUID();
    const sql = `
      INSERT INTO jump_ball_events (
        id, match_id, quarter, minute, second, jump_ball_type,
        team_1_id, team_2_id, winner_team_id, sequence_number, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `;
    await db.query(sql, [
      id,
      data.match_id,
      data.quarter,
      data.minute,
      data.second,
      data.jump_ball_type,
      data.team_1_id || null,
      data.team_2_id || null,
      data.winner_team_id,
      data.sequence_number || 0
    ]);
    return this.findById(id);
  }

  async getInitialJumpBall(matchId) {
    const sql = `
      SELECT * FROM jump_ball_events
      WHERE match_id = ? AND jump_ball_type = 'initial'
      ORDER BY created_at ASC
      LIMIT 1
    `;
    const rows = await db.query(sql, [matchId]);
    return rows[0] || null;
  }

  async getJumpBallCount(matchId, teamId) {
    const sql = `
      SELECT COUNT(*) as count FROM jump_ball_events
      WHERE match_id = ? AND winner_team_id = ?
    `;
    const rows = await db.query(sql, [matchId, teamId]);
    return rows[0].count;
  }
}

export default new JumpBallRepository();