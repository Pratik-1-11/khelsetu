import db from '../../../infrastructure/postgres/index.js';
import matchRepository from '../../matches/repositories/matchRepository.js';
import { NotFoundError, ValidationError } from '../../../core/errors/index.js';
import { generateUUID } from '../../../core/utils/index.js';
import logger from '../../../core/logger/index.js';

export class StatisticsService {
  async updateMatchStatistics(matchId) {
    const match = await matchRepository.findById(matchId);
    if (!match) {
      throw new NotFoundError('Match not found');
    }

    const events = await db.query(
      `SELECT * FROM scoring_events WHERE match_id = ? AND is_reversed = FALSE`,
      [matchId]
    );

    const homeStats = this.initializeTeamStats();
    const awayStats = this.initializeTeamStats();

    for (const event of events) {
      this.updateTeamStatsFromEvent(homeStats, match.home_team_id, event);
      this.updateTeamStatsFromEvent(awayStats, match.away_team_id, event);
    }

    await this.saveTeamMatchStats(matchId, match.home_team_id, homeStats);
    await this.saveTeamMatchStats(matchId, match.away_team_id, awayStats);

    await this.updatePlayerMatchStatistics(matchId, match.home_team_id, events);
    await this.updatePlayerMatchStatistics(matchId, match.away_team_id, events);

    logger.info('Match statistics updated', { matchId });

    return { home: homeStats, away: awayStats };
  }

  initializeTeamStats() {
    return {
      shots_total: 0,
      shots_on_target: 0,
      shots_off_target: 0,
      shots_blocked: 0,
      corners: 0,
      free_kicks: 0,
      penalties: 0,
      throw_ins: 0,
      offsides: 0,
      fouls: 0,
      yellow_cards: 0,
      red_cards: 0,
      passes_completed: 0,
      passes_failed: 0,
      tackles_won: 0,
      tackles_lost: 0,
      interceptions: 0,
      clearances: 0,
      blocks: 0,
      own_goals: 0,
      goals_conceded: 0
    };
  }

  updateTeamStatsFromEvent(stats, teamId, event) {
    if (event.team_id !== teamId) return;

    if (event.event_type === 'goal' || event.event_type === 'penalty') {
      stats.shots_on_target += 1;
    }

    if (event.event_type === 'yellow_card') {
      stats.yellow_cards += 1;
    }

    if (event.event_type === 'red_card' || event.event_type === 'second_yellow') {
      stats.red_cards += 1;
    }

    if (event.event_type === 'own_goal') {
      stats.own_goals += 1;
      stats.goals_conceded += 1;
    }

    if (event.metadata) {
      const meta = typeof event.metadata === 'string' ? JSON.parse(event.metadata) : event.metadata;
      
      if (meta.shots_total) stats.shots_total += meta.shots_total;
      if (meta.shots_on_target) stats.shots_on_target += meta.shots_on_target;
      if (meta.corners) stats.corners += meta.corners;
      if (meta.free_kicks) stats.free_kicks += meta.free_kicks;
      if (meta.penalties) stats.penalties += meta.penalties;
      if (meta.offsides) stats.offsides += meta.offsides;
      if (meta.fouls) stats.fouls += meta.fouls;
      if (meta.passes_completed) stats.passes_completed += meta.passes_completed;
      if (meta.passes_failed) stats.passes_failed += meta.passes_failed;
      if (meta.tackles_won) stats.tackles_won += meta.tackles_won;
      if (meta.tackles_lost) stats.tackles_lost += meta.tackles_lost;
      if (meta.interceptions) stats.interceptions += meta.interceptions;
      if (meta.clearances) stats.clearances += meta.clearances;
    }
  }

  async saveTeamMatchStats(matchId, teamId, stats) {
    const [existing] = await db.query(
      `SELECT id FROM team_match_stats WHERE match_id = ? AND team_id = ?`,
      [matchId, teamId]
    );

    const statFields = Object.keys(stats).join(', ');
    const placeholders = Object.keys(stats).map(() => '?').join(', ');
    const values = Object.values(stats);

    if (existing.length > 0) {
      const updateSet = Object.keys(stats).map(k => `${k} = ?`).join(', ');
      await db.query(
        `UPDATE team_match_stats SET ${updateSet}, updated_at = NOW() WHERE id = ?`,
        [...values, existing[0].id]
      );
    } else {
      await db.query(
        `INSERT INTO team_match_stats (id, match_id, team_id, ${statFields}) VALUES (?, ?, ?, ${placeholders})`,
        [generateUUID(), matchId, teamId, ...values]
      );
    }
  }

  async updatePlayerMatchStatistics(matchId, teamId, events) {
    const lineup = await db.query(
      `SELECT player_id, is_starting, minutes_played FROM match_lineups WHERE match_id = ? AND team_id = ?`,
      [matchId, teamId]
    );

    const playerEvents = events.filter(e => e.team_id === teamId && e.player_id);

    for (const player of lineup) {
      const playerStats = this.initializePlayerStats(player.is_starting);
      
      const playerEventsForPlayer = playerEvents.filter(e => e.player_id === player.player_id);

      for (const event of playerEventsForPlayer) {
        this.updatePlayerStatsFromEvent(playerStats, event);
      }

      await this.savePlayerMatchStats(matchId, player.player_id, teamId, playerStats);
    }
  }

  initializePlayerStats(isStarting) {
    return {
      minutes_played: 90,
      is_starting: isStarting,
      goals: 0,
      assists: 0,
      shots_total: 0,
      shots_on_target: 0,
      passes_completed: 0,
      passes_failed: 0,
      key_passes: 0,
      tackles_won: 0,
      tackles_lost: 0,
      interceptions: 0,
      clearances: 0,
      yellow_cards: 0,
      red_cards: 0,
      fouls_won: 0,
      fouls_conceded: 0,
      offsides: 0,
      saves: 0
    };
  }

  updatePlayerStatsFromEvent(stats, event) {
    if (event.event_type === 'goal' || event.event_type === 'penalty') {
      stats.goals += 1;
    }

    if (event.event_type === 'yellow_card') {
      stats.yellow_cards += 1;
    }

    if (event.event_type === 'red_card' || event.event_type === 'second_yellow') {
      stats.red_cards += 1;
    }

    if (event.metadata) {
      const meta = typeof event.metadata === 'string' ? JSON.parse(event.metadata) : event.metadata;
      
      if (meta.assists) stats.assists += meta.assists;
      if (meta.shots_total) stats.shots_total += meta.shots_total;
      if (meta.shots_on_target) stats.shots_on_target += meta.shots_on_target;
      if (meta.passes_completed) stats.passes_completed += meta.passes_completed;
      if (meta.passes_failed) stats.passes_failed += meta.passes_failed;
      if (meta.key_passes) stats.key_passes += meta.key_passes;
      if (meta.tackles_won) stats.tackles_won += meta.tackles_won;
      if (meta.tackles_lost) stats.tackles_lost += meta.tackles_lost;
      if (meta.interceptions) stats.interceptions += meta.interceptions;
      if (meta.clearances) stats.clearances += meta.clearances;
      if (meta.fouls_won) stats.fouls_won += meta.fouls_won;
      if (meta.fouls_conceded) stats.fouls_conceded += meta.fouls_conceded;
      if (meta.offsides) stats.offsides += meta.offsides;
      if (meta.saves) stats.saves += meta.saves;
    }
  }

  async savePlayerMatchStats(matchId, playerId, teamId, stats) {
    const [existing] = await db.query(
      `SELECT id FROM player_match_stats WHERE match_id = ? AND player_id = ?`,
      [matchId, playerId]
    );

    const { is_starting, ...restStats } = stats;
    const statFields = Object.keys(restStats).join(', ');
    const placeholders = Object.keys(restStats).map(() => '?').join(', ');
    const values = Object.values(restStats);

    if (existing.length > 0) {
      const updateSet = Object.keys(restStats).map(k => `${k} = ?`).join(', ');
      await db.query(
        `UPDATE player_match_stats SET ${updateSet}, updated_at = NOW() WHERE id = ?`,
        [...values, existing[0].id]
      );
    } else {
      await db.query(
        `INSERT INTO player_match_stats (id, match_id, player_id, team_id, is_starting, ${statFields}) VALUES (?, ?, ?, ?, ?, ${placeholders})`,
        [generateUUID(), matchId, playerId, teamId, is_starting ? 1 : 0, ...values]
      );
    }
  }

  async getTeamStatistics(teamId, tournamentId = null) {
    let query = `
      SELECT 
        COUNT(*) as matches_played,
        SUM(CASE WHEN m.home_team_id = ? THEN m.home_score ELSE m.away_score END) as goals_for,
        SUM(CASE WHEN m.home_team_id = ? THEN m.away_score ELSE m.home_score END) as goals_against,
        SUM(CASE WHEN (m.home_team_id = ? AND m.home_score > m.away_score) OR (m.away_team_id = ? AND m.away_score > m.home_score) THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN m.home_score = m.away_score THEN 1 ELSE 0 END) as draws,
        SUM(CASE WHEN (m.home_team_id = ? AND m.home_score < m.away_score) OR (m.away_team_id = ? AND m.away_score < m.home_score) THEN 1 ELSE 0 END) as losses
      FROM matches m
      WHERE (m.home_team_id = ? OR m.away_team_id = ?) AND m.status = 'completed'
    `;
    const params = [teamId, teamId, teamId, teamId, teamId, teamId, teamId, teamId];

    if (tournamentId) {
      query += ' AND m.tournament_id = ?';
      params.push(tournamentId);
    }

    const [stats] = await db.query(query, params);

    const result = stats[0];
    result.goal_difference = result.goals_for - result.goals_against;
    result.points = (result.wins || 0) * 3 + (result.draws || 0);

    return result;
  }

  async getPlayerStatistics(playerId, tournamentId = null) {
    let query = `
      SELECT 
        pms.*, m.tournament_id, m.home_team_id, m.away_team_id
      FROM player_match_stats pms
      JOIN matches m ON pms.match_id = m.id
      WHERE pms.player_id = ?
    `;
    const params = [playerId];

    if (tournamentId) {
      query += ' AND m.tournament_id = ?';
      params.push(tournamentId);
    }

    const [matches] = await db.query(query, params);

    const totals = {
      matches: matches.length,
      minutes_played: 0,
      goals: 0,
      assists: 0,
      shots_total: 0,
      shots_on_target: 0,
      passes_completed: 0,
      passes_failed: 0,
      tackles_won: 0,
      interceptions: 0,
      yellow_cards: 0,
      red_cards: 0,
      man_of_match: 0
    };

    for (const match of matches) {
      totals.minutes_played += match.minutes_played || 0;
      totals.goals += match.goals || 0;
      totals.assists += match.assists || 0;
      totals.shots_total += match.shots_total || 0;
      totals.shots_on_target += match.shots_on_target || 0;
      totals.passes_completed += match.passes_completed || 0;
      totals.passes_failed += match.passes_failed || 0;
      totals.tackles_won += match.tackles_won || 0;
      totals.interceptions += match.interceptions || 0;
      totals.yellow_cards += match.yellow_cards || 0;
      totals.red_cards += match.red_cards || 0;
      if (match.is_man_of_match) totals.man_of_match += 1;
    }

    return totals;
  }

  async getTopScorers(tournamentId, limit = 10) {
    const [scorers] = await db.query(
      `SELECT 
         p.id as player_id,
         CONCAT(p.first_name, ' ', p.last_name) as player_name,
         t.id as team_id,
         t.name as team_name,
         COUNT(CASE WHEN se.event_type IN ('goal', 'penalty') THEN 1 END) as goals
       FROM scoring_events se
       JOIN players p ON se.player_id = p.id
       JOIN matches m ON se.match_id = m.id
       JOIN teams t ON se.team_id = t.id
       WHERE m.tournament_id = ? AND se.is_reversed = FALSE
       GROUP BY p.id, t.id
       ORDER BY goals DESC
       LIMIT ?`,
      [tournamentId, limit]
    );

    return scorers;
  }

  async getTopAssists(tournamentId, limit = 10) {
    const [assists] = await db.query(
      `SELECT 
         p.id as player_id,
         CONCAT(p.first_name, ' ', p.last_name) as player_name,
         t.id as team_id,
         t.name as team_name,
         SUM(CASE WHEN se.metadata LIKE '%"assists":1%' THEN 1 ELSE 0 END) as assists
       FROM scoring_events se
       JOIN players p ON se.player_id = p.id
       JOIN matches m ON se.match_id = m.id
       JOIN teams t ON se.team_id = t.id
       WHERE m.tournament_id = ? AND se.is_reversed = FALSE
       GROUP BY p.id, t.id
       ORDER BY assists DESC
       LIMIT ?`,
      [tournamentId, limit]
    );

    return assists;
  }

  async getCleanSheets(teamId, tournamentId = null) {
    let query = `
      SELECT m.id, m.home_team_id, m.away_team_id, m.home_score, m.away_score
      FROM matches m
      WHERE ((m.home_team_id = ? AND m.away_score = 0) OR (m.away_team_id = ? AND m.home_score = 0))
      AND m.status = 'completed'
    `;
    const params = [teamId, teamId];

    if (tournamentId) {
      query += ' AND m.tournament_id = ?';
      params.push(tournamentId);
    }

    const [matches] = await db.query(query, params);

    return matches.length;
  }

  async getTeamForm(teamId, matchCount = 5) {
    const [matches] = await db.query(
      `SELECT * FROM matches 
       WHERE (home_team_id = ? OR away_team_id = ?) AND status = 'completed'
       ORDER BY ended_at DESC
       LIMIT ?`,
      [teamId, teamId, matchCount]
    );

    const form = matches.map(m => {
      const isHome = m.home_team_id === teamId;
      const goalsFor = isHome ? m.home_score : m.away_score;
      const goalsAgainst = isHome ? m.away_score : m.home_score;

      if (goalsFor > goalsAgainst) return 'W';
      if (goalsFor === goalsAgainst) return 'D';
      return 'L';
    });

    return form;
  }
}

export default new StatisticsService();