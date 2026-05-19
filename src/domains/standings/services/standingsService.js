import db from '../../../infrastructure/postgres/index.js';
import matchRepository from '../../matches/repositories/matchRepository.js';
import { NotFoundError, ValidationError } from '../../../core/errors/index.js';
import { generateUUID } from '../../../core/utils/index.js';
import logger from '../../../core/logger/index.js';

const DEFAULT_TIE_BREAKERS = [
  { name: 'points', order: 1 },
  { name: 'goal_difference', order: 2 },
  { name: 'goals_for', order: 3 },
  { name: 'head_to_head_points', order: 4 },
  { name: 'head_to_head_goal_difference', order: 5 },
  { name: 'head_to_head_goals_for', order: 6 },
  { name: 'goals_for_away', order: 7 },
  { name: 'fair_play_points', order: 8 },
  { name: 'drawing_of_lots', order: 9 }
];

const TIE_BREAKER_CALCULATORS = {
  points: (team) => team.points,
  goal_difference: (team) => team.goal_difference,
  goals_for: (team) => team.goals_for,
  head_to_head_points: (team, h2h) => h2h?.[team.id]?.points || 0,
  head_to_head_goal_difference: (team, h2h) => h2h?.[team.id]?.goal_difference || 0,
  head_to_head_goals_for: (team, h2h) => h2h?.[team.id]?.goals_for || 0,
  goals_for_away: (team) => team.goals_for_away || 0,
  fair_play_points: (team) => team.fair_play_points || 0,
  drawing_of_lots: () => Math.random()
};

export class StandingsService {
  async calculateStandings(tournamentId, groupName = null) {
    const tournament = await db.query('SELECT * FROM tournaments WHERE id = ?', [tournamentId]);
    if (!tournament[0]) {
      throw new NotFoundError('Tournament not found');
    }

    const teams = await db.query(
      `SELECT tt.team_id, t.name as team_name FROM tournament_teams tt JOIN teams t ON tt.team_id = t.id WHERE tt.tournament_id = ? AND tt.status IN ('registered', 'confirmed')`,
      [tournamentId]
    );

    const matches = await db.query(
      `SELECT * FROM matches WHERE tournament_id = ? AND status = 'completed'`,
      [tournamentId]
    );

    const groupMatches = groupName 
      ? matches.filter(m => m.group_name === groupName)
      : matches;

    const teamStats = {};

    for (const team of teams) {
      teamStats[team.team_id] = this.initializeTeamStats(team);
    }

    for (const match of groupMatches) {
      this.updateTeamStats(teamStats, match);
    }

    const standings = Object.values(teamStats);

    const h2hStats = await this.calculateHeadToHead(tournamentId, groupName, standings);

    const tieBreakers = await this.getTieBreakers(tournamentId);

    standings.sort((a, b) => {
      for (const tb of tieBreakers) {
        const valA = TIE_BREAKER_CALCULATORS[tb.name](a, h2hStats);
        const valB = TIE_BREAKER_CALCULATORS[tb.name](b, h2hStats);
        
        if (valA !== valB) {
          return valB - valA;
        }
      }
      return 0;
    });

    for (let i = 0; i < standings.length; i++) {
      standings[i].position = i + 1;
    }

    await this.saveStandings(tournamentId, groupName, standings);

    logger.info('Standings calculated', { tournamentId, groupName, teamCount: standings.length });

    return standings;
  }

  initializeTeamStats(team) {
    return {
      id: generateUUID(),
      team_id: team.team_id,
      team_name: team.team_name,
      played: 0,
      won: 0,
      drawn: 0,
      lost: 0,
      wins_home: 0,
      wins_away: 0,
      draws_home: 0,
      draws_away: 0,
      losses_home: 0,
      losses_away: 0,
      goals_for: 0,
      goals_for_home: 0,
      goals_for_away: 0,
      goals_against: 0,
      goals_against_home: 0,
      goals_against_away: 0,
      goal_difference: 0,
      points: 0,
      fair_play_points: 0
    };
  }

  updateTeamStats(teamStats, match) {
    const homeTeam = match.home_team_id;
    const awayTeam = match.away_team_id;

    if (!teamStats[homeTeam] || !teamStats[awayTeam]) return;

    const homeStats = teamStats[homeTeam];
    const awayStats = teamStats[awayTeam];

    homeStats.played += 1;
    awayStats.played += 1;

    const homeGoals = match.home_score;
    const awayGoals = match.away_score;

    homeStats.goals_for += homeGoals;
    homeStats.goals_against += awayGoals;
    homeStats.goals_for_home += homeGoals;
    homeStats.goals_against_home += awayGoals;

    awayStats.goals_for += awayGoals;
    awayStats.goals_against += homeGoals;
    awayStats.goals_for_away += awayGoals;
    awayStats.goals_against_away += homeGoals;

    if (homeGoals > awayGoals) {
      homeStats.won += 1;
      homeStats.wins_home += 1;
      homeStats.points += 3;
      awayStats.lost += 1;
      awayStats.losses_away += 1;
    } else if (homeGoals < awayGoals) {
      awayStats.won += 1;
      awayStats.wins_away += 1;
      awayStats.points += 3;
      homeStats.lost += 1;
      homeStats.losses_home += 1;
    } else {
      homeStats.drawn += 1;
      homeStats.draws_home += 1;
      awayStats.drawn += 1;
      awayStats.draws_away += 1;
      homeStats.points += 1;
      awayStats.points += 1;
    }

    homeStats.goal_difference = homeStats.goals_for - homeStats.goals_against;
    awayStats.goal_difference = awayStats.goals_for - awayStats.goals_against;
  }

  async calculateHeadToHead(tournamentId, groupName, standings) {
    const matches = await db.query(
      `SELECT * FROM matches WHERE tournament_id = ? AND status = 'completed'`,
      [tournamentId]
    );

    const groupMatches = groupName 
      ? matches.filter(m => m.group_name === groupName)
      : matches;

    const h2hStats = {};

    const teamIds = standings.map(s => s.team_id);
    for (const teamId of teamIds) {
      h2hStats[teamId] = {};
      for (const opponentId of teamIds) {
        if (teamId !== opponentId) {
          h2hStats[teamId][opponentId] = {
            matches_played: 0,
            wins: 0,
            draws: 0,
            losses: 0,
            goals_for: 0,
            goals_against: 0,
            points: 0,
            goal_difference: 0
          };
        }
      }
    }

    for (const match of groupMatches) {
      const homeTeam = match.home_team_id;
      const awayTeam = match.away_team_id;

      if (!h2hStats[homeTeam] || !h2hStats[homeTeam][awayTeam]) continue;

      const h2h = h2hStats[homeTeam][awayTeam];

      h2h.matches_played += 1;
      h2h.goals_for += match.home_score;
      h2h.goals_against += match.away_score;

      if (match.home_score > match.away_score) {
        h2h.wins += 1;
        h2h.points += 3;
      } else if (match.home_score < match.away_score) {
        h2h.losses += 1;
      } else {
        h2h.draws += 1;
        h2h.points += 1;
      }

      h2h.goal_difference = h2h.goals_for - h2h.goals_against;

      const reverseH2h = h2hStats[awayTeam][homeTeam];
      reverseH2h.matches_played += 1;
      reverseH2h.goals_for += match.away_score;
      reverseH2h.goals_against += match.home_score;

      if (match.home_score < match.away_score) {
        reverseH2h.wins += 1;
        reverseH2h.points += 3;
      } else if (match.home_score > match.away_score) {
        reverseH2h.losses += 1;
      } else {
        reverseH2h.draws += 1;
        reverseH2h.points += 1;
      }

      reverseH2h.goal_difference = reverseH2h.goals_for - reverseH2h.goals_against;
    }

    for (const teamId of teamIds) {
      let totalPoints = 0;
      let totalGF = 0;
      let totalGA = 0;

      for (const opponentId of teamIds) {
        if (teamId !== opponentId) {
          const h2h = h2hStats[teamId][opponentId];
          totalPoints += h2h.points;
          totalGF += h2h.goals_for;
          totalGA += h2h.goals_against;
        }
      }

      h2hStats[teamId] = {
        points: totalPoints,
        goal_difference: totalGF - totalGA,
        goals_for: totalGF,
        ...h2hStats[teamId]
      };
    }

    return h2hStats;
  }

  async getTieBreakers(tournamentId) {
    const [custom] = await db.query(
      `SELECT * FROM tournament_tie_breakers WHERE tournament_id = ? AND is_active = TRUE ORDER BY tie_breaker_order`,
      [tournamentId]
    );

    if (custom.length > 0) {
      return custom.map(tb => ({
        name: tb.tie_breaker_name,
        order: tb.tie_breaker_order
      }));
    }

    return DEFAULT_TIE_BREAKERS;
  }

  async saveStandings(tournamentId, groupName, standings) {
    for (const team of standings) {
      const [existing] = await db.query(
        `SELECT id FROM standings WHERE tournament_id = ? AND team_id = ? AND COALESCE(group_name, '') = COALESCE(?, '')`,
        [tournamentId, team.team_id, groupName]
      );

      if (existing.length > 0) {
        await db.query(
          `UPDATE standings SET 
            played = ?, won = ?, drawn = ?, lost = ?, 
            goals_for = ?, goals_against = ?, goal_difference = ?, points = ?,
            wins_home = ?, wins_away = ?, draws_home = ?, draws_away = ?,
            losses_home = ?, losses_away = ?, 
            goals_for_home = ?, goals_for_away = ?,
            goals_against_home = ?, goals_against_away = ?,
            fair_play_points = ?, position = ?, updated_at = NOW()
          WHERE id = ?`,
          [
            team.played, team.won, team.drawn, team.lost,
            team.goals_for, team.goals_against, team.goal_difference, team.points,
            team.wins_home, team.wins_away, team.draws_home, team.draws_away,
            team.losses_home, team.losses_away,
            team.goals_for_home, team.goals_for_away,
            team.goals_against_home, team.goals_against_away,
            team.fair_play_points, team.position, existing[0].id
          ]
        );
      } else {
        await db.query(
          `INSERT INTO standings (id, tournament_id, team_id, group_name, played, won, drawn, lost, goals_for, goals_against, goal_difference, points, wins_home, wins_away, draws_home, draws_away, losses_home, losses_away, goals_for_home, goals_for_away, goals_against_home, goals_against_away, fair_play_points, position)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            generateUUID(), tournamentId, team.team_id, groupName,
            team.played, team.won, team.drawn, team.lost,
            team.goals_for, team.goals_against, team.goal_difference, team.points,
            team.wins_home, team.wins_away, team.draws_home, team.draws_away,
            team.losses_home, team.losses_away,
            team.goals_for_home, team.goals_for_away,
            team.goals_against_home, team.goals_against_away,
            team.fair_play_points, team.position
          ]
        );
      }
    }

    await this.createSnapshot(tournamentId, groupName, standings);
  }

  async createSnapshot(tournamentId, groupName, standings) {
    const snapshotData = {
      standings: standings.map(s => ({
        team_id: s.team_id,
        team_name: s.team_name,
        position: s.position,
        played: s.played,
        won: s.won,
        drawn: s.drawn,
        lost: s.lost,
        goals_for: s.goals_for,
        goals_against: s.goals_against,
        goal_difference: s.goal_difference,
        points: s.points
      })),
      generated_at: new Date().toISOString()
    };

    await db.query(
      `INSERT INTO league_table_snapshots (id, tournament_id, group_name, snapshot_data, created_at)
       VALUES (?, ?, ?, ?, NOW())`,
      [generateUUID(), tournamentId, groupName, JSON.stringify(snapshotData)]
    );
  }

  async getStandings(tournamentId, groupName = null) {
    const [standings] = await db.query(
      `SELECT s.*, t.name as team_name, t.logo as team_logo
       FROM standings s
       JOIN teams t ON s.team_id = t.id
       WHERE s.tournament_id = ? AND COALESCE(s.group_name, '') = COALESCE(?, '')
       ORDER BY s.position`,
      [tournamentId, groupName]
    );

    return standings;
  }

  async getHistoricalStandings(tournamentId, groupName = null, limit = 10) {
    const [snapshots] = await db.query(
      `SELECT * FROM league_table_snapshots 
       WHERE tournament_id = ? AND COALESCE(group_name, '') = COALESCE(?, '')
       ORDER BY created_at DESC LIMIT ?`,
      [tournamentId, groupName, limit]
    );

    return snapshots.map(s => ({
      ...JSON.parse(s.snapshot_data),
      snapshot_id: s.id,
      created_at: s.created_at
    }));
  }

  async updateFairPlayPoints(tournamentId) {
    const [cards] = await db.query(
      `SELECT 
         se.team_id,
         SUM(CASE WHEN se.event_type = 'yellow_card' THEN 1 ELSE 0 END) as yellows,
         SUM(CASE WHEN se.event_type IN ('red_card', 'second_yellow') THEN 1 ELSE 0 END) as reds
       FROM scoring_events se
       JOIN matches m ON se.match_id = m.id
       WHERE m.tournament_id = ? AND se.is_reversed = FALSE
       GROUP BY se.team_id`,
      [tournamentId]
    );

    for (const card of cards) {
      const fairPlayPoints = -((card.yellows || 0) * 1 + (card.reds || 0) * 3);

      await db.query(
        `UPDATE standings SET fair_play_points = ? WHERE tournament_id = ? AND team_id = ?`,
        [fairPlayPoints, tournamentId, card.team_id]
      );
    }

    logger.info('Fair play points updated', { tournamentId });
  }

  async recalculateAfterMatch(matchId) {
    const [match] = await db.query('SELECT tournament_id, group_name FROM matches WHERE id = ?', [matchId]);
    if (!match[0]) return;

    await this.calculateStandings(match[0].tournament_id, match[0].group_name);
    await this.updateFairPlayPoints(match[0].tournament_id);

    logger.info('Standings recalculated after match', { matchId, tournamentId: match[0].tournament_id });
  }
}

export default new StandingsService();