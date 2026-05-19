import db from '../../../infrastructure/postgres/index.js';
import { NotFoundError, ForbiddenError } from '../../../core/errors/index.js';
import { v4 as uuidv4 } from 'uuid';

class AnalyticsService {
  async getDashboardStats(organizationId, userId) {
    const connection = await db.getConnection();
    try {
      const [orgCheck] = await connection.query(
        `SELECT om.id FROM organization_members om 
         WHERE om.organization_id = ? AND om.user_id = ? AND om.is_active = TRUE`,
        [organizationId, userId]
      );
      if (!orgCheck.length) {
        throw new ForbiddenError('Access denied to this organization');
      }

      const [[tournamentCount]] = await connection.query(
        `SELECT COUNT(*) as count FROM tournaments 
         WHERE organization_id = ? AND deleted_at IS NULL`,
        [organizationId]
      );

      const [[activeTournamentCount]] = await connection.query(
        `SELECT COUNT(*) as count FROM tournaments 
         WHERE organization_id = ? AND status = 'in_progress' AND deleted_at IS NULL`,
        [organizationId]
      );

      const [[teamCount]] = await connection.query(
        `SELECT COUNT(*) as count FROM teams 
         WHERE organization_id = ? AND deleted_at IS NULL`,
        [organizationId]
      );

      const [[playerCount]] = await connection.query(
        `SELECT COUNT(*) as count FROM players 
         WHERE organization_id = ? AND deleted_at IS NULL`,
        [organizationId]
      );

      const [[matchCount]] = await connection.query(
        `SELECT COUNT(*) as count FROM matches m
         JOIN tournaments t ON m.tournament_id = t.id
         WHERE t.organization_id = ? AND m.status IN ('scheduled', 'live') AND m.deleted_at IS NULL`,
        [organizationId]
      );

      const [[completedMatchCount]] = await connection.query(
        `SELECT COUNT(*) as count FROM matches m
         JOIN tournaments t ON m.tournament_id = t.id
         WHERE t.organization_id = ? AND m.status = 'completed' AND m.deleted_at IS NULL`,
        [organizationId]
      );

      const [recentMatches] = await connection.query(
        `SELECT m.id, m.home_score, m.away_score, m.status, m.scheduled_at,
         ht.name as home_team, at.name as away_team, t.name as tournament_name
         FROM matches m
         JOIN tournaments t ON m.tournament_id = t.id
         LEFT JOIN teams ht ON m.home_team_id = ht.id
         LEFT JOIN teams at ON m.away_team_id = at.id
         WHERE t.organization_id = ? AND m.deleted_at IS NULL
         ORDER BY m.updated_at DESC LIMIT 5`,
        [organizationId]
      );

      return {
        tournaments: { total: tournamentCount.count, active: activeTournamentCount.count },
        teams: teamCount.count,
        players: playerCount.count,
        matches: { total: matchCount.count, completed: completedMatchCount.count },
        recent_activity: recentMatches
      };
    } finally {
      connection.release();
    }
  }

  async getTournamentStats(tournamentId, userId) {
    const connection = await db.getConnection();
    try {
      const [tournament] = await connection.query(
        `SELECT t.*, o.id as org_id FROM tournaments t
         JOIN organizations o ON t.organization_id = o.id
         WHERE t.id = ? AND t.deleted_at IS NULL`,
        [tournamentId]
      );
      if (!tournament.length) throw new NotFoundError('Tournament not found');

      const [orgCheck] = await connection.query(
        `SELECT id FROM organization_members 
         WHERE organization_id = ? AND user_id = ? AND is_active = TRUE`,
        [tournament[0].org_id, userId]
      );
      if (!orgCheck.length) throw new ForbiddenError('Access denied');

      const [[matchStats]] = await connection.query(
        `SELECT 
           COUNT(*) as total_matches,
           SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
           SUM(CASE WHEN status = 'live' THEN 1 ELSE 0 END) as live,
           SUM(CASE WHEN status = 'scheduled' THEN 1 ELSE 0 END) as scheduled
         FROM matches 
         WHERE tournament_id = ? AND deleted_at IS NULL`,
        [tournamentId]
      );

      const [[goalStats]] = await connection.query(
        `SELECT 
           SUM(home_score + away_score) as total_goals,
           AVG(home_score + away_score) as avg_goals
         FROM matches 
         WHERE tournament_id = ? AND status = 'completed' AND deleted_at IS NULL`,
        [tournamentId]
      );

      const [topScorers] = await connection.query(
        `SELECT p.id, p.first_name, p.last_name, p.jersey_number,
           COUNT(se.id) as goals, t.name as team_name
         FROM scoring_events se
         JOIN players p ON se.player_id = p.id
         LEFT JOIN player_teams pt ON p.id = pt.player_id AND pt.is_active = TRUE
         LEFT JOIN teams t ON pt.team_id = t.id
         WHERE se.event_type IN ('goal', 'penalty')
         GROUP BY p.id
         ORDER BY goals DESC LIMIT 5`
      );

      const [groupStandings] = await connection.query(
        `SELECT group_name, COUNT(*) as team_count
         FROM tournament_teams tt
         JOIN matches m ON m.tournament_id = tt.tournament_id
         WHERE tt.tournament_id = ? AND m.group_name IS NOT NULL
         GROUP BY group_name`,
        [tournamentId]
      );

      return {
        matches: matchStats,
        goals: goalStats,
        top_scorers: topScorers,
        groups: groupStandings
      };
    } finally {
      connection.release();
    }
  }

  async getMatchStats(matchId, userId) {
    const connection = await db.getConnection();
    try {
      const [match] = await connection.query(
        `SELECT m.*, t.organization_id as org_id FROM matches m
         JOIN tournaments t ON m.tournament_id = t.id
         WHERE m.id = ? AND m.deleted_at IS NULL`,
        [matchId]
      );
      if (!match.length) throw new NotFoundError('Match not found');

      const [orgCheck] = await connection.query(
        `SELECT id FROM organization_members 
         WHERE organization_id = ? AND user_id = ? AND is_active = TRUE`,
        [match[0].org_id, userId]
      );
      if (!orgCheck.length) throw new ForbiddenError('Access denied');

      const [events] = await connection.query(
        `SELECT event_type, team_id, player_id, minute, created_at
         FROM scoring_events 
         WHERE match_id = ? 
         ORDER BY minute ASC, created_at ASC`,
        [matchId]
      );

      const eventStats = {
        goals: events.filter(e => e.event_type === 'goal').length,
        penalties: events.filter(e => e.event_type === 'penalty').length,
        yellow_cards: events.filter(e => e.event_type === 'yellow_card').length,
        red_cards: events.filter(e => e.event_type === 'red_card').length,
        substitutions: events.filter(e => e.event_type === 'substitution').length
      };

      const timeline = events.map(e => ({
        minute: e.minute,
        type: e.event_type,
        team_id: e.team_id,
        player_id: e.player_id,
        timestamp: e.created_at
      }));

      return {
        match: match[0],
        event_summary: eventStats,
        timeline: timeline
      };
    } finally {
      connection.release();
    }
  }

  async getTeamStats(teamId, userId) {
    const connection = await db.getConnection();
    try {
      const [team] = await connection.query(
        `SELECT t.*, o.id as org_id FROM teams t
         JOIN organizations o ON t.organization_id = o.id
         WHERE t.id = ? AND t.deleted_at IS NULL`,
        [teamId]
      );
      if (!team.length) throw new NotFoundError('Team not found');

      const [orgCheck] = await connection.query(
        `SELECT id FROM organization_members 
         WHERE organization_id = ? AND user_id = ? AND is_active = TRUE`,
        [team[0].org_id, userId]
      );
      if (!orgCheck.length) throw new ForbiddenError('Access denied');

      const [[matchStats]] = await connection.query(
        `SELECT 
           COUNT(*) as played,
           SUM(CASE WHEN (home_team_id = ? AND home_score > away_score) OR 
                        (away_team_id = ? AND away_score > home_score) THEN 1 ELSE 0 END) as wins,
           SUM(CASE WHEN home_score = away_score THEN 1 ELSE 0 END) as draws,
           SUM(CASE WHEN (home_team_id = ? AND home_score < away_score) OR 
                        (away_team_id = ? AND away_score < home_score) THEN 1 ELSE 0 END) as losses
         FROM matches 
         WHERE (home_team_id = ? OR away_team_id = ?) AND status = 'completed' AND deleted_at IS NULL`,
        [teamId, teamId, teamId, teamId, teamId, teamId]
      );

      const [[goalStats]] = await connection.query(
        `SELECT 
           SUM(CASE WHEN home_team_id = ? THEN home_score ELSE 0 END) +
           SUM(CASE WHEN away_team_id = ? THEN away_score ELSE 0 END) as goals_for,
           SUM(CASE WHEN home_team_id = ? THEN away_score ELSE 0 END) +
           SUM(CASE WHEN away_team_id = ? THEN home_score ELSE 0 END) as goals_against
         FROM matches 
         WHERE (home_team_id = ? OR away_team_id = ?) AND status = 'completed' AND deleted_at IS NULL`,
        [teamId, teamId, teamId, teamId, teamId, teamId]
      );

      const winRate = matchStats.played > 0 
        ? Math.round((matchStats.wins / matchStats.played) * 100) 
        : 0;

      const [recentForm] = await connection.query(
        `SELECT m.id, m.home_score, m.away_score, m.status, m.scheduled_at,
           CASE WHEN m.home_team_id = ? THEN 'home' ELSE 'away' END as venue
         FROM matches m
         WHERE (m.home_team_id = ? OR m.away_team_id = ?) AND m.status = 'completed'
         ORDER BY m.scheduled_at DESC LIMIT 5`,
        [teamId, teamId, teamId]
      );

      const formResult = recentForm.map(m => {
        const isHome = m.venue === 'home';
        const teamScore = isHome ? m.home_score : m.away_score;
        const oppScore = isHome ? m.away_score : m.home_score;
        if (teamScore > oppScore) return 'W';
        if (teamScore === oppScore) return 'D';
        return 'L';
      });

      return {
        team: team[0],
        stats: {
          played: matchStats.played || 0,
          wins: matchStats.wins || 0,
          draws: matchStats.draws || 0,
          losses: matchStats.losses || 0,
          win_rate: winRate,
          goals_for: goalStats.goals_for || 0,
          goals_against: goalStats.goals_against || 0
        },
        recent_form: formResult.reverse().join('')
      };
    } finally {
      connection.release();
    }
  }

  async getPlayerStats(playerId, userId) {
    const connection = await db.getConnection();
    try {
      const [player] = await connection.query(
        `SELECT p.*, o.id as org_id FROM players p
         JOIN organizations o ON p.organization_id = o.id
         WHERE p.id = ? AND p.deleted_at IS NULL`,
        [playerId]
      );
      if (!player.length) throw new NotFoundError('Player not found');

      const [orgCheck] = await connection.query(
        `SELECT id FROM organization_members 
         WHERE organization_id = ? AND user_id = ? AND is_active = TRUE`,
        [player[0].org_id, userId]
      );
      if (!orgCheck.length) throw new ForbiddenError('Access denied');

      const [[matchStats]] = await connection.query(
        `SELECT COUNT(*) as appearances FROM scoring_events WHERE player_id = ?`,
        [playerId]
      );

      const [[goalStats]] = await connection.query(
        `SELECT COUNT(*) as goals FROM scoring_events 
         WHERE player_id = ? AND event_type IN ('goal', 'penalty')`,
        [playerId]
      );

      const [[assistStats]] = await connection.query(
        `SELECT COUNT(*) as assists FROM scoring_events 
         WHERE player_id = ? AND event_type = 'assist'`,
        [playerId]
      );

      const [[cardStats]] = await connection.query(
        `SELECT 
           SUM(CASE WHEN event_type = 'yellow_card' THEN 1 ELSE 0 END) as yellow_cards,
           SUM(CASE WHEN event_type = 'red_card' THEN 1 ELSE 0 END) as red_cards
         FROM scoring_events WHERE player_id = ?`,
        [playerId]
      );

      const [recentMatches] = await connection.query(
        `SELECT m.id, m.home_score, m.away_score, m.scheduled_at,
           t.name as tournament_name, ht.name as home_team, at.name as away_team
         FROM scoring_events se
         JOIN matches m ON se.match_id = m.id
         JOIN tournaments t ON m.tournament_id = t.id
         LEFT JOIN teams ht ON m.home_team_id = ht.id
         LEFT JOIN teams at ON m.away_team_id = at.id
         WHERE se.player_id = ?
         ORDER BY m.scheduled_at DESC LIMIT 5`,
        [playerId]
      );

      return {
        player: player[0],
        stats: {
          appearances: matchStats.appearances || 0,
          goals: goalStats.goals || 0,
          assists: assistStats.assists || 0,
          yellow_cards: cardStats.yellow_cards || 0,
          red_cards: cardStats.red_cards || 0,
          total_involvements: (goalStats.goals || 0) + (assistStats.assists || 0)
        },
        recent_matches: recentMatches
      };
    } finally {
      connection.release();
    }
  }

  async generateCustomReport({ organization_id, start_date, end_date, tournament_id, export_format }) {
    const connection = await db.getConnection();
    try {
      let dateFilter = '';
      const params = [organization_id];

      if (start_date && end_date) {
        dateFilter = ' AND m.scheduled_at BETWEEN ? AND ?';
        params.push(start_date, end_date);
      }

      let tournamentFilter = '';
      if (tournament_id) {
        tournamentFilter = ' AND m.tournament_id = ?';
        params.push(tournament_id);
      }

      const [matches] = await connection.query(
        `SELECT m.*, t.name as tournament_name, t.format as tournament_format,
           ht.name as home_team, at.name as away_team
         FROM matches m
         JOIN tournaments t ON m.tournament_id = t.id
         LEFT JOIN teams ht ON m.home_team_id = ht.id
         LEFT JOIN teams at ON m.away_team_id = at.id
         WHERE t.organization_id = ? ${dateFilter} ${tournamentFilter}
         AND m.status = 'completed' AND m.deleted_at IS NULL
         ORDER BY m.scheduled_at DESC`,
        params
      );

      const [[teamStats]] = await connection.query(
        `SELECT 
           COUNT(DISTINCT team_id) as total_teams,
           COUNT(DISTINCT tournament_id) as total_tournaments
         FROM tournament_teams tt
         JOIN tournaments t ON tt.tournament_id = t.id
         WHERE t.organization_id = ?`,
        [organization_id]
      );

      const report = {
        generated_at: new Date().toISOString(),
        filters: { start_date, end_date, tournament_id },
        summary: {
          total_matches: matches.length,
          total_teams: teamStats.total_teams,
          total_tournaments: teamStats.total_tournaments
        },
        matches: matches.map(m => ({
          id: m.id,
          tournament: m.tournament_name,
          format: m.tournament_format,
          home_team: m.home_team,
          away_team: m.away_team,
          score: `${m.home_score} - ${m.away_score}`,
          date: m.scheduled_at
        }))
      };

      if (export_format === 'csv') {
        const csvRows = ['Match ID,Tournament,Format,Home Team,Away Team,Score,Date'];
        matches.forEach(m => {
          csvRows.push(`${m.id},${m.tournament_name},${m.tournament_format},${m.home_team},${m.away_team},${m.home_score}-${m.away_score},${m.scheduled_at}`);
        });
        return { format: 'csv', data: csvRows.join('\n') };
      }

      return report;
    } finally {
      connection.release();
    }
  }

  async getLeaderboards({ organization_id, tournament_id, metric, limit }) {
    const connection = await db.getConnection();
    try {
      let whereClause = 't.organization_id = ?';
      const params = [organization_id];

      if (tournament_id) {
        whereClause += ' AND se.match_id IN (SELECT id FROM matches WHERE tournament_id = ?)';
        params.push(tournament_id);
      }

      let orderBy = 'goals DESC';
      if (metric === 'assists') orderBy = 'assists DESC';
      else if (metric === 'wins') orderBy = 'wins DESC';

      const [leaderboard] = await connection.query(
        `SELECT p.id, p.first_name, p.last_name, p.jersey_number, t.name as team_name,
           COUNT(CASE WHEN se.event_type IN ('goal', 'penalty') THEN 1 END) as goals,
           COUNT(CASE WHEN se.event_type = 'assist' THEN 1 END) as assists
         FROM scoring_events se
         JOIN players p ON se.player_id = p.id
         LEFT JOIN player_teams pt ON p.id = pt.player_id AND pt.is_active = TRUE
         LEFT JOIN teams t ON pt.team_id = t.id
         JOIN matches m ON se.match_id = m.id
         JOIN tournaments t2 ON m.tournament_id = t2.id
         WHERE ${whereClause}
         GROUP BY p.id
         ORDER BY ${orderBy}
         LIMIT ?`,
        [...params, limit]
      );

      return leaderboard.map((entry, index) => ({
        rank: index + 1,
        player_id: entry.id,
        name: `${entry.first_name} ${entry.last_name || ''}`.trim(),
        jersey_number: entry.jersey_number,
        team: entry.team_name,
        goals: entry.goals,
        assists: entry.assists,
        points: entry.goals + entry.assists
      }));
    } finally {
      connection.release();
    }
  }
}

export default new AnalyticsService();