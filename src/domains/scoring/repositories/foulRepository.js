import db from '../../../infrastructure/postgres/index.js';
import { generateUUID } from '../../../core/utils/index.js';

export class FoulRepository {
  async findByMatch(matchId) {
    const sql = `
      SELECT pf.*, p.first_name, p.last_name
      FROM player_fouls pf
      LEFT JOIN players p ON pf.player_id = p.id
      WHERE pf.match_id = ? AND pf.is_reversed = FALSE
      ORDER BY pf.quarter, pf.game_minute, pf.created_at
    `;
    return db.query(sql, [matchId]);
  }

  async findByPlayer(matchId, playerId) {
    const sql = `
      SELECT * FROM player_fouls
      WHERE match_id = ? AND player_id = ? AND is_reversed = FALSE
      ORDER BY created_at DESC
    `;
    return db.query(sql, [matchId, playerId]);
  }

  async getPlayerFoulCount(matchId, playerId) {
    const sql = `
      SELECT COUNT(*) as total,
        SUM(CASE WHEN foul_type = 'personal' THEN 1 ELSE 0 END) as personal,
        SUM(CASE WHEN foul_type = 'technical' THEN 1 ELSE 0 END) as technical,
        SUM(CASE WHEN foul_type = 'flagrant_1' THEN 1 ELSE 0 END) as flagrant_1,
        SUM(CASE WHEN foul_type = 'flagrant_2' THEN 1 ELSE 0 END) as flagrant_2
      FROM player_fouls
      WHERE match_id = ? AND player_id = ? AND is_reversed = FALSE
    `;
    const rows = await db.query(sql, [matchId, playerId]);
    return rows[0];
  }

  async create(data) {
    const id = data.id || generateUUID();
    const sql = `
      INSERT INTO player_fouls (
        id, match_id, team_id, player_id, foul_type, quarter, game_minute, game_second,
        metadata, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `;
    await db.query(sql, [
      id,
      data.match_id,
      data.team_id,
      data.player_id,
      data.foul_type,
      data.quarter,
      data.game_minute,
      data.game_second,
      JSON.stringify(data.metadata || {}),
      data.created_by
    ]);
    return this.findById(id);
  }

  async findById(id) {
    const sql = `SELECT * FROM player_fouls WHERE id = ?`;
    const rows = await db.query(sql, [id]);
    return rows[0] || null;
  }

  async reverse(id, reversedBy) {
    const sql = `
      UPDATE player_fouls
      SET is_reversed = TRUE, metadata = JSON_SET(COALESCE(metadata, '{}'), '$.reversed_by', ?)
      WHERE id = ?
    `;
    await db.query(sql, [reversedBy, id]);
    return this.findById(id);
  }

  async getTeamFoulsByQuarter(matchId, teamId) {
    const sql = `
      SELECT quarter, COUNT(*) as foul_count
      FROM player_fouls
      WHERE match_id = ? AND team_id = ? AND is_reversed = FALSE AND foul_type IN ('personal', 'shooting', 'offensive')
      GROUP BY quarter
    `;
    return db.query(sql, [matchId, teamId]);
  }
}

export class TeamFoulCounterRepository {
  async findByMatch(matchId) {
    const sql = `SELECT * FROM team_foul_counters WHERE match_id = ?`;
    return db.query(sql, [matchId]);
  }

  async findByTeam(matchId, teamId) {
    const sql = `SELECT * FROM team_foul_counters WHERE match_id = ? AND team_id = ?`;
    const rows = await db.query(sql, [matchId, teamId]);
    return rows[0] || null;
  }

  async create(data) {
    const id = generateUUID();
    const sql = `
      INSERT INTO team_foul_counters (id, match_id, team_id, bonus_status)
      VALUES (?, ?, ?, 'none')
    `;
    await db.query(sql, [id, data.match_id, data.team_id]);
    return this.findByTeam(data.match_id, data.team_id);
  }

  async initializeForMatch(matchId, homeTeamId, awayTeamId) {
    const existing = await this.findByMatch(matchId);
    if (existing.length > 0) return existing;

    await this.create({ match_id: matchId, team_id: homeTeamId });
    await this.create({ match_id: matchId, team_id: awayTeamId });

    return this.findByMatch(matchId);
  }

  async incrementFoul(matchId, teamId, quarter) {
    const teamFoul = await this.findByTeam(matchId, teamId);
    if (!teamFoul) {
      await this.create({ match_id: matchId, team_id: teamId });
    }

    const quarterField = `quarter_${quarter}_fouls`;
    const sql = `
      UPDATE team_foul_counters
      SET ${quarterField} = ${quarterField} + 1
      WHERE match_id = ? AND team_id = ?
    `;
    await db.query(sql, [matchId, teamId]);
    return this.updateBonusStatus(matchId, teamId);
  }

  async decrementFoul(matchId, teamId, quarter) {
    const quarterField = `quarter_${quarter}_fouls`;
    const sql = `
      UPDATE team_foul_counters
      SET ${quarterField} = GREATEST(${quarterField} - 1, 0)
      WHERE match_id = ? AND team_id = ?
    `;
    await db.query(sql, [matchId, teamId]);
    return this.updateBonusStatus(matchId, teamId);
  }

  async updateBonusStatus(matchId, teamId) {
    const teamFoul = await this.findByTeam(matchId, teamId);
    if (!teamFoul) return null;

    let totalFouls = teamFoul.quarter_1_fouls + teamFoul.quarter_2_fouls +
                     teamFoul.quarter_3_fouls + teamFoul.quarter_4_fouls +
                     teamFoul.overtime_1_fouls + teamFoul.overtime_2_fouls + teamFoul.overtime_3_fouls;

    let bonusStatus = 'none';
    if (totalFouls >= 8) {
      bonusStatus = 'double_bonus';
    } else if (totalFouls >= 5) {
      bonusStatus = 'bonus';
    }

    await db.query(
      `UPDATE team_foul_counters SET bonus_status = ? WHERE match_id = ? AND team_id = ?`,
      [bonusStatus, matchId, teamId]
    );

    return { bonus_status: bonusStatus, total_fouls: totalFouls };
  }

  async getBonusStatus(matchId, teamId) {
    const teamFoul = await this.findByTeam(matchId, teamId);
    return teamFoul?.bonus_status || 'none';
  }

  async resetForOvertime(matchId, teamId) {
    const sql = `
      UPDATE team_foul_counters
      SET overtime_1_fouls = 0, overtime_2_fouls = 0, overtime_3_fouls = 0, bonus_status = 'none'
      WHERE match_id = ? AND team_id = ?
    `;
    return db.query(sql, [matchId, teamId]);
  }
}

export default new FoulRepository();