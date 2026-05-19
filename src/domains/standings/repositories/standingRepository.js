import db from '../../../infrastructure/postgres/index.js';
import { generateUUID } from '../../../core/utils/index.js';

export class StandingRepository {
  async findById(id) {
    const sql = `SELECT * FROM standings WHERE id = ?`;
    const rows = await db.query(sql, [id]);
    return rows[0] || null;
  }

  async findByTournament(tournamentId, groupName = null) {
    let sql = `SELECT s.*, t.name as team_name, t.slug as team_slug, t.logo as team_logo FROM standings s JOIN teams t ON s.team_id = t.id WHERE s.tournament_id = ?`;
    const params = [tournamentId];

    if (groupName) {
      sql += ' AND s.group_name = ?';
      params.push(groupName);
    }

    sql += ' ORDER BY s.position ASC';
    return db.query(sql, params);
  }

  async findByTeam(tournamentId, teamId, groupName = null) {
    let sql = `SELECT * FROM standings WHERE tournament_id = ? AND team_id = ?`;
    const params = [tournamentId, teamId];

    if (groupName) {
      sql += ' AND group_name = ?';
      params.push(groupName);
    }

    const rows = await db.query(sql, params);
    return rows[0] || null;
  }

  async upsert(data) {
    const existing = await this.findByTeam(data.tournament_id, data.team_id, data.group_name);

    if (existing) {
      const sql = `
        UPDATE standings SET
          played = ?, won = ?, drawn = ?, lost = ?,
          goals_for = ?, goals_against = ?, goal_difference = ?,
          points = ?, position = ?, metadata = ?, updated_at = NOW()
        WHERE id = ?
      `;
      await db.query(sql, [
        data.played, data.won, data.drawn, data.lost,
        data.goals_for, data.goals_against, data.goal_difference,
        data.points, data.position, JSON.stringify(data.metadata || {}), existing.id
      ]);
      return this.findById(existing.id);
    }

    const id = data.id || generateUUID();
    const sql = `
      INSERT INTO standings (id, tournament_id, team_id, group_name, played, won, drawn, lost, goals_for, goals_against, goal_difference, points, position, metadata, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `;
    await db.query(sql, [
      id, data.tournament_id, data.team_id, data.group_name,
      data.played || 0, data.won || 0, data.drawn || 0, data.lost || 0,
      data.goals_for || 0, data.goals_against || 0, data.goal_difference || 0,
      data.points || 0, data.position || 0, JSON.stringify(data.metadata || {})
    ]);
    return this.findById(id);
  }

  async recalculateForTournament(tournamentId) {
    const matches = await db.query(`
      SELECT m.*, ht.id as home_team_id, at.id as away_team_id
      FROM matches m
      JOIN teams ht ON m.home_team_id = ht.id
      JOIN teams at ON m.away_team_id = at.id
      WHERE m.tournament_id = ? AND m.status = 'completed'
    `, [tournamentId]);

    const teamStats = new Map();

    for (const match of matches) {
      if (!teamStats.has(match.home_team_id)) {
        teamStats.set(match.home_team_id, { played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0 });
      }
      if (!teamStats.has(match.away_team_id)) {
        teamStats.set(match.away_team_id, { played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0 });
      }

      const homeStats = teamStats.get(match.home_team_id);
      const awayStats = teamStats.get(match.away_team_id);

      homeStats.played++;
      awayStats.played++;

      homeStats.gf += match.home_score;
      homeStats.ga += match.away_score;
      awayStats.gf += match.away_score;
      awayStats.ga += match.home_score;

      if (match.home_score > match.away_score) {
        homeStats.won++;
        awayStats.lost++;
      } else if (match.home_score < match.away_score) {
        awayStats.won++;
        homeStats.lost++;
      } else {
        homeStats.drawn++;
        awayStats.drawn++;
      }
    }

    const results = [];
    for (const [teamId, stats] of teamStats) {
      const points = (stats.won * 3) + (stats.drawn * 1);
      const result = await this.upsert({
        tournament_id: tournamentId,
        team_id: teamId,
        played: stats.played,
        won: stats.won,
        drawn: stats.drawn,
        lost: stats.lost,
        goals_for: stats.gf,
        goals_against: stats.ga,
        goal_difference: stats.gf - stats.ga,
        points,
        position: 0,
        metadata: {}
      });
      results.push(result);
    }

    return this.reorderPositions(tournamentId);
  }

  async reorderPositions(tournamentId, groupName = null) {
    let sql = `SELECT * FROM standings WHERE tournament_id = ?`;
    const params = [tournamentId];

    if (groupName) {
      sql += ' AND group_name = ?';
      params.push(groupName);
    }

    sql += ' ORDER BY points DESC, goal_difference DESC, goals_for DESC';

    const standings = await db.query(sql, params);

    for (let i = 0; i < standings.length; i++) {
      await db.query('UPDATE standings SET position = ? WHERE id = ?', [i + 1, standings[i].id]);
    }

    return this.findByTournament(tournamentId, groupName);
  }

  async createSnapshot(tournamentId, groupName = null) {
    const standings = await this.findByTournament(tournamentId, groupName);
    const id = generateUUID();

    const sql = `INSERT INTO standings_snapshots (id, tournament_id, group_name, snapshot_data, created_at) VALUES (?, ?, ?, ?, NOW())`;
    await db.query(sql, [id, tournamentId, groupName, JSON.stringify(standings)]);

    return { id, tournament_id: tournamentId, standings_count: standings.length };
  }

  async getSnapshots(tournamentId, limit = 10) {
    const sql = `SELECT * FROM standings_snapshots WHERE tournament_id = ? ORDER BY created_at DESC LIMIT ?`;
    return db.query(sql, [tournamentId, limit]);
  }
}

export default new StandingRepository();