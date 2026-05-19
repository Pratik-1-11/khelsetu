import matchRepository from '../repositories/matchRepository.js';
import tournamentRepository from '../../tournaments/repositories/tournamentRepository.js';
import teamRepository from '../../teams/repositories/teamRepository.js';
import organizationRepository from '../../organizations/repositories/organizationRepository.js';
import matchPeriodService from '../../scoring/services/matchPeriodService.js';
import substitutionService from '../../scoring/services/substitutionService.js';
import { NotFoundError, ForbiddenError, ValidationError, ConflictError } from '../../../core/errors/index.js';
import logger from '../../../core/logger/index.js';
import ws from '../../../core/websocket/index.js';
import db from '../../../infrastructure/postgres/index.js';
import { generateUUID } from '../../../core/utils/index.js';

const MATCH_STATUS = {
  DRAFT: 'draft',
  SCHEDULED: 'scheduled',
  LIVE: 'live',
  HALFTIME: 'halftime',
  EXTRA_TIME: 'extra_time',
  PENALTIES: 'penalties',
  COMPLETED: 'completed',
  ABANDONED: 'abandoned',
  SUSPENDED: 'suspended',
  POSTPONED: 'postponed',
  CANCELLED: 'cancelled'
};

export class MatchService {
  async create(data, userId) {
    const tournament = await tournamentRepository.findById(data.tournament_id);
    if (!tournament) {
      throw new NotFoundError('Tournament not found');
    }

    const isMember = await organizationRepository.isMember(userId, tournament.organization_id);
    if (!isMember) {
      throw new ForbiddenError('Access denied');
    }

    const homeTeam = await teamRepository.findById(data.home_team_id);
    const awayTeam = await teamRepository.findById(data.away_team_id);
    if (!homeTeam || !awayTeam) {
      throw new NotFoundError('Team not found');
    }

    const match = await matchRepository.create({
      organization_id: tournament.organization_id,
      tournament_id: data.tournament_id,
      home_team_id: data.home_team_id,
      away_team_id: data.away_team_id,
      match_number: data.match_number,
      round_number: data.round_number,
      group_name: data.group_name,
      venue: data.venue,
      scheduled_at: data.scheduled_at,
      status: 'scheduled',
      metadata: data.metadata || {},
      created_by: userId
    });

    await matchPeriodService.initializeMatchPeriods(match.id);

    logger.info('Match created', { matchId: match.id, tournamentId: match.tournament_id });
    return match;
  }

  async getById(id, userId) {
    const match = await matchRepository.findById(id);
    if (!match) {
      throw new NotFoundError('Match not found');
    }

    const isMember = await organizationRepository.isMember(userId, match.organization_id);
    if (!isMember) {
      throw new ForbiddenError('Access denied');
    }

    return match;
  }

  async getByIdWithPeriod(id, userId) {
    const match = await this.getById(id, userId);
    const currentPeriod = await matchPeriodService.getCurrentPeriod(id);
    const periods = await matchPeriodService.getMatchPeriods(id);
    
    const homeSubStatus = await substitutionService.getTeamSubstitutionStatus(id, match.home_team_id);
    const awaySubStatus = await substitutionService.getTeamSubstitutionStatus(id, match.away_team_id);

    return {
      ...match,
      currentPeriod,
      periods,
      substitutionStatus: {
        home: homeSubStatus,
        away: awaySubStatus
      }
    };
  }

  async getByTournament(tournamentId, userId, options = {}) {
    const tournament = await tournamentRepository.findById(tournamentId);
    if (!tournament) {
      throw new NotFoundError('Tournament not found');
    }

    const isMember = await organizationRepository.isMember(userId, tournament.organization_id);
    if (!isMember) {
      throw new ForbiddenError('Access denied');
    }

    return matchRepository.findByTournament(tournamentId, options);
  }

  async update(id, userId, data) {
    const match = await this.getById(id, userId);
    return matchRepository.update(id, data);
  }

  async delete(id, userId) {
    const match = await this.getById(id, userId);

    if (match.status === 'live') {
      throw new ValidationError('Cannot delete a live match');
    }

    return matchRepository.softDelete(id);
  }

  async startMatch(id, userId) {
    const match = await this.getById(id, userId);

    if (match.status !== 'scheduled' && match.status !== 'draft') {
      throw new ValidationError('Match must be in scheduled status to start');
    }

    const [homeLineup] = await db.query(
      `SELECT COUNT(*) as count FROM match_lineups WHERE match_id = ? AND team_id = ? AND is_starting = TRUE`,
      [id, match.home_team_id]
    );

    const [awayLineup] = await db.query(
      `SELECT COUNT(*) as count FROM match_lineups WHERE match_id = ? AND team_id = ? AND is_starting = TRUE`,
      [id, match.away_team_id]
    );

    if (homeLineup.count < 7 || awayLineup.count < 7) {
      logger.warn('Match starting without full lineup', { matchId: id, homePlayers: homeLineup.count, awayPlayers: awayLineup.count });
    }

    const result = await matchPeriodService.startFirstHalf(id, userId);

    logger.info('Match started', { matchId: id, period: 'first_half' });

    return await matchRepository.findById(id);
  }

  async endMatch(id, userId, data = {}) {
    const match = await this.getById(id, userId);

    if (!['live', 'halftime', 'extra_time', 'penalties'].includes(match.status)) {
      throw new ValidationError('Match must be in progress to end');
    }

    const winnerId = data.winner_id || (
      match.home_score > match.away_score ? match.home_team_id : 
      match.away_score > match.home_score ? match.away_team_id : null
    );

    const result = await matchPeriodService.endMatch(id, winnerId);

    const finalMatch = await matchRepository.findById(id);

    logger.info('Match ended', { 
      matchId: id, 
      winnerId: winnerId,
      finalScore: { home: finalMatch.home_score, away: finalMatch.away_score }
    });

    return finalMatch;
  }

  async updateScore(id, userId, homeScore, awayScore) {
    const match = await this.getById(id, userId);

    if (match.status !== 'live') {
      throw new ValidationError('Can only update score for live matches');
    }

    const previousScore = { home: match.home_score, away: match.away_score };

    const updatedMatch = await matchRepository.update(id, { 
      home_score: homeScore, 
      away_score: awayScore 
    });

    ws.emitToMatch(id, 'match:score_update', { 
      matchId: id, 
      home_score: homeScore, 
      away_score: awayScore,
      previousScore,
      timestamp: new Date().toISOString() 
    });

    return updatedMatch;
  }

  async transitionPeriod(matchId, userId, action, options = {}) {
    const match = await this.getById(matchId, userId);
    const currentPeriod = await matchPeriodService.getCurrentPeriod(matchId);

    const validTransitions = {
      scheduled: ['start_first_half'],
      first_half: ['end_first_half', 'abandon', 'suspend'],
      halftime: ['start_second_half'],
      second_half: ['end_second_half', 'start_extra_time', 'abandon', 'suspend'],
      extra_time: ['end_extra_time_first', 'start_extra_time_second'],
      extra_time_second: ['end_extra_time', 'start_penalties', 'abandon'],
      penalties: ['end_match']
    };

    const allowedActions = validTransitions[currentPeriod?.period_type] || [];

    if (!allowedActions.includes(action)) {
      throw new ValidationError(`Cannot perform '${action}' from '${currentPeriod?.period_type}'`);
    }

    const actionHandlers = {
      start_first_half: () => matchPeriodService.startFirstHalf(matchId, userId),
      end_first_half: () => matchPeriodService.startHalftime(matchId, options.injuryTime || 0),
      start_second_half: () => matchPeriodService.startSecondHalf(matchId),
      end_second_half: () => matchPeriodService.endSecondHalf(matchId, options.injuryTime || 0),
      start_extra_time: () => matchPeriodService.startExtraTime(matchId),
      end_extra_time_first: () => matchPeriodService.endExtraTime(matchId, options.injuryTime || 0),
      start_extra_time_second: () => matchPeriodService.startExtraTime(matchId),
      end_extra_time: () => matchPeriodService.endExtraTime(matchId, options.injuryTime || 0),
      start_penalties: () => matchPeriodService.startPenalties(matchId),
      end_match: () => matchPeriodService.endMatch(matchId, options.winnerId),
      abandon: () => this.abandonMatch(matchId, userId, options.reason),
      suspend: () => this.suspendMatch(matchId, userId, options.reason)
    };

    const handler = actionHandlers[action];
    if (!handler) {
      throw new ValidationError(`Unknown action: ${action}`);
    }

    return await handler();
  }

  async abandonMatch(matchId, userId, reason) {
    const match = await this.getById(matchId, userId);
    
    if (!['live', 'halftime', 'extra_time', 'penalties'].includes(match.status)) {
      throw new ValidationError('Cannot abandon match from current state');
    }

    const currentPeriod = await matchPeriodService.getCurrentPeriod(matchId);
    const currentMinute = currentPeriod?.actual_minute || 0;

    await db.transaction(async (connection) => {
      await connection.execute(
        `UPDATE match_periods SET status = 'abandoned', end_time = NOW() WHERE match_id = ? AND status = 'in_progress'`,
        [matchId]
      );

      await connection.execute(
        `UPDATE matches SET status = 'abandoned', metadata = JSON_SET(COALESCE(metadata, '{}'), '$.abandonment', JSON_OBJECT('reason', ?, 'minute', ?, 'user_id', ?, 'timestamp', NOW())) WHERE id = ?`,
        [reason, currentMinute, userId, matchId]
      );

      await connection.commit();
    });

    ws.emitToMatch(matchId, 'match:abandoned', {
      matchId,
      reason,
      minute: currentMinute,
      timestamp: new Date().toISOString()
    });

    logger.warn('Match abandoned', { matchId, reason, minute: currentMinute });

    return await matchRepository.findById(matchId);
  }

  async suspendMatch(matchId, userId, reason) {
    const match = await this.getById(matchId, userId);
    
    if (!['live', 'halftime', 'extra_time', 'penalties'].includes(match.status)) {
      throw new ValidationError('Cannot suspend match from current state');
    }

    const currentPeriod = await matchPeriodService.getCurrentPeriod(matchId);

    await db.transaction(async (connection) => {
      await connection.execute(
        `UPDATE match_periods SET status = 'completed', end_time = NOW() WHERE match_id = ? AND status = 'in_progress'`,
        [matchId]
      );

      await connection.execute(
        `UPDATE matches SET status = 'suspended', metadata = JSON_SET(COALESCE(metadata, '{}'), '$.suspension', JSON_OBJECT('reason', ?, 'user_id', ?, 'timestamp', NOW())) WHERE id = ?`,
        [reason, userId, matchId]
      );

      await connection.commit();
    });

    ws.emitToMatch(matchId, 'match:suspended', {
      matchId,
      reason,
      timestamp: new Date().toISOString()
    });

    logger.info('Match suspended', { matchId, reason });

    return await matchRepository.findById(matchId);
  }

  async resumeMatch(matchId, userId) {
    const match = await this.getById(matchId, userId);
    
    if (match.status !== 'suspended') {
      throw new ValidationError('Match must be suspended to resume');
    }

    const [periods] = await db.query(
      `SELECT * FROM match_periods WHERE match_id = ? AND status = 'completed' ORDER BY period_number DESC`,
      [matchId]
    );

    const lastPeriod = periods[0];
    let nextPeriodType;

    switch (lastPeriod?.period_type) {
      case 'first_half':
        nextPeriodType = 'second_half';
        break;
      case 'second_half':
        nextPeriodType = match.metadata?.is_knockout && match.home_score === match.away_score ? 'extra_time_first' : 'completed';
        break;
      case 'extra_time_first':
        nextPeriodType = 'extra_time_second';
        break;
      case 'extra_time_second':
        nextPeriodType = match.home_score === match.away_score ? 'penalties' : 'completed';
        break;
      default:
        throw new ValidationError('Cannot determine next period after suspension');
    }

    if (nextPeriodType === 'completed') {
      return await this.endMatch(matchId, userId);
    }

    await db.transaction(async (connection) => {
      const [matchData] = await connection.query('SELECT organization_id FROM matches WHERE id = ?', [matchId]);
      
      const newPeriodId = generateUUID();
      const nextPeriodNumber = lastPeriod ? lastPeriod.period_number + 1 : 1;

      await connection.execute(
        `INSERT INTO match_periods (id, match_id, organization_id, period_number, period_type, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'in_progress', NOW())`,
        [newPeriodId, matchId, matchData[0].organization_id, nextPeriodNumber, nextPeriodType]
      );

      await connection.execute(
        `UPDATE matches SET status = 'live', metadata = JSON_REMOVE(metadata, '$.suspension') WHERE id = ?`,
        [matchId]
      );

      await connection.commit();
    });

    ws.emitToMatch(matchId, 'match:resumed', {
      matchId,
      nextPeriod: nextPeriodType,
      timestamp: new Date().toISOString()
    });

    logger.info('Match resumed', { matchId, nextPeriod: nextPeriodType });

    return await matchRepository.findById(matchId);
  }

  async scheduleMatch(id, userId, scheduledAt) {
    const match = await this.getById(id, userId);
    
    if (match.status !== 'draft' && match.status !== 'postponed') {
      throw new ValidationError('Match must be in draft or postponed status to schedule');
    }

    await matchPeriodService.initializeMatchPeriods(id);
    
    return await matchRepository.update(id, { 
      scheduled_at: scheduledAt, 
      status: 'scheduled' 
    });
  }

  async postponeMatch(id, userId, newDate, reason) {
    const match = await this.getById(id, userId);
    
    if (!['scheduled', 'live', 'halftime'].includes(match.status)) {
      throw new ValidationError('Cannot postpone match from current state');
    }

    await db.transaction(async (connection) => {
      if (match.status === 'live' || match.status === 'halftime') {
        await connection.execute(
          `UPDATE match_periods SET status = 'abandoned', end_time = NOW() WHERE match_id = ? AND status = 'in_progress'`,
          [id]
        );
      }

      await connection.execute(
        `UPDATE matches SET status = 'postponed', scheduled_at = ?, metadata = JSON_SET(COALESCE(metadata, '{}'), '$.postponement', JSON_OBJECT('reason', ?, 'original_date', ?, 'user_id', ?)) WHERE id = ?`,
        [newDate, reason, match.scheduled_at, userId, id]
      );

      await connection.commit();
    });

    ws.emitToMatch(id, 'match:postponed', {
      matchId: id,
      newDate,
      reason,
      timestamp: new Date().toISOString()
    });

    logger.info('Match postponed', { matchId: id, newDate, reason });

    return await matchRepository.findById(id);
  }

  async addOfficial(matchId, userId, targetUserId, role) {
    await this.getById(matchId, userId);
    return matchRepository.addOfficial(matchId, targetUserId, role);
  }

  async removeOfficial(matchId, userId, targetUserId) {
    await this.getById(matchId, userId);
    return matchRepository.removeOfficial(matchId, targetUserId);
  }

  async getOfficials(matchId, userId) {
    const match = await this.getById(matchId, userId);
    return matchRepository.getOfficials(matchId);
  }
}

export default new MatchService();