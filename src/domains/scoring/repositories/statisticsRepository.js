import db from '../../../infrastructure/postgres/index.js';
import { generateUUID } from '../../../core/utils/index.js';

export class StatisticsRepository {
  async findPlayerStats(matchId, playerId) {
    const sql = `SELECT * FROM player_match_stats WHERE match_id = ? AND player_id = ?`;
    const rows = await db.query(sql, [matchId, playerId]);
    return rows[0] || null;
  }

  async findTeamStats(matchId, teamId) {
    const sql = `SELECT * FROM team_match_stats WHERE match_id = ? AND team_id = ?`;
    const rows = await db.query(sql, [matchId, teamId]);
    return rows[0] || null;
  }

  async getAllPlayerStats(matchId) {
    const sql = `
      SELECT pms.*, p.first_name, p.last_name, p.jersey_number, t.name as team_name
      FROM player_match_stats pms
      LEFT JOIN players p ON pms.player_id = p.id
      LEFT JOIN teams t ON pms.team_id = t.id
      WHERE pms.match_id = ?
      ORDER BY pms.points DESC
    `;
    return db.query(sql, [matchId]);
  }

  async getAllTeamStats(matchId) {
    const sql = `
      SELECT tms.*, t.name as team_name, t.logo
      FROM team_match_stats tms
      LEFT JOIN teams t ON tms.team_id = t.id
      WHERE tms.match_id = ?
    `;
    return db.query(sql, [matchId]);
  }

  async initializePlayerStats(matchId, playerId, teamId) {
    const existing = await this.findPlayerStats(matchId, playerId);
    if (existing) return existing;

    const id = generateUUID();
    const sql = `
      INSERT INTO player_match_stats (id, match_id, player_id, team_id)
      VALUES (?, ?, ?, ?)
    `;
    await db.query(sql, [id, matchId, playerId, teamId]);
    return this.findPlayerStats(matchId, playerId);
  }

  async initializeTeamStats(matchId, teamId) {
    const existing = await this.findTeamStats(matchId, teamId);
    if (existing) return existing;

    const id = generateUUID();
    const sql = `
      INSERT INTO team_match_stats (id, match_id, team_id)
      VALUES (?, ?, ?)
    `;
    await db.query(sql, [id, matchId, teamId]);
    return this.findTeamStats(matchId, teamId);
  }

  async updatePlayerStats(matchId, playerId, stats) {
    const fields = [];
    const params = [];

    const validFields = [
      'points', 'field_goals_made', 'field_goals_attempted',
      'three_pointers_made', 'three_pointers_attempted',
      'free_throws_made', 'free_throws_attempted',
      'offensive_rebounds', 'defensive_rebounds', 'total_rebounds',
      'assists', 'steals', 'blocks', 'turnovers',
      'personal_fouls', 'technical_fouls', 'plus_minus'
    ];

    for (const [key, value] of Object.entries(stats)) {
      if (validFields.includes(key) && value !== undefined) {
        fields.push(`${key} = ${key} + ?`);
        params.push(value);
      }
    }

    if (fields.length === 0) return this.findPlayerStats(matchId, playerId);

    params.push(matchId, playerId);
    const sql = `UPDATE player_match_stats SET ${fields.join(', ')} WHERE match_id = ? AND player_id = ?`;
    await db.query(sql, params);

    return this.findPlayerStats(matchId, playerId);
  }

  async updateTeamStats(matchId, teamId, stats) {
    const fields = [];
    const params = [];

    const validFields = [
      'points', 'field_goals_made', 'field_goals_attempted',
      'three_pointers_made', 'three_pointers_attempted',
      'free_throws_made', 'free_throws_attempted',
      'offensive_rebounds', 'defensive_rebounds', 'total_rebounds',
      'assists', 'steals', 'blocks', 'turnovers',
      'personal_fouls', 'technical_fouls'
    ];

    for (const [key, value] of Object.entries(stats)) {
      if (validFields.includes(key) && value !== undefined) {
        fields.push(`${key} = ${key} + ?`);
        params.push(value);
      }
    }

    if (fields.length === 0) return this.findTeamStats(matchId, teamId);

    params.push(matchId, teamId);
    const sql = `UPDATE team_match_stats SET ${fields.join(', ')} WHERE match_id = ? AND team_id = ?`;
    await db.query(sql, params);

    return this.findTeamStats(matchId, teamId);
  }

  async resetPlayerStats(matchId, playerId) {
    const sql = `
      UPDATE player_match_stats SET
        points = 0, field_goals_made = 0, field_goals_attempted = 0,
        three_pointers_made = 0, three_pointers_attempted = 0,
        free_throws_made = 0, free_throws_attempted = 0,
        offensive_rebounds = 0, defensive_rebounds = 0, total_rebounds = 0,
        assists = 0, steals = 0, blocks = 0, turnovers = 0,
        personal_fouls = 0, technical_fouls = 0, plus_minus = 0
      WHERE match_id = ? AND player_id = ?
    `;
    return db.query(sql, [matchId, playerId]);
  }
}

export default new StatisticsRepository();