import db from '../../../infrastructure/postgres/index.js';
import matchRepository from '../../matches/repositories/matchRepository.js';
import foulService from './foulService.js';
import shotClockService from './shotClockService.js';
import { NotFoundError, ValidationError } from '../../../core/errors/index.js';
import logger from '../../../core/logger/index.js';
import ws from '../../../core/websocket/index.js';

export class BasketballPeriodService {
  constructor(rules = {}) {
    this.rules = {
      quarters: rules.quarters || 4,
      quarterDuration: rules.quarterDuration || 720,
      overtimeDuration: rules.overtimeDuration || 300,
      maxOvertimes: rules.maxOvertimes || null
    };
  }

  async initializeMatchPeriods(matchId) {
    const match = await matchRepository.findById(matchId);
    if (!match) {
      throw new NotFoundError('Match not found');
    }

    const existingPeriods = await this.getMatchPeriods(matchId);
    if (existingPeriods.length > 0) {
      return existingPeriods;
    }

    for (let i = 1; i <= this.rules.quarters; i++) {
      await this.createPeriod(matchId, i, `quarter_${i}`, 'pending');
    }

    logger.info('Basketball periods initialized', { matchId, quarters: this.rules.quarters });
    return this.getMatchPeriods(matchId);
  }

  async createPeriod(matchId, periodNumber, periodType, status) {
    const id = require('../../../core/utils/index.js').generateUUID();
    const match = await matchRepository.findById(matchId);

    await db.query(
      `INSERT INTO match_periods (id, match_id, organization_id, period_number, period_type, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [id, matchId, match.organization_id, periodNumber, periodType, status]
    );

    return { id, period_number: periodNumber, period_type: periodType, status };
  }

  async startPeriod(matchId, periodNumber) {
    const match = await matchRepository.findById(matchId);
    if (!match) {
      throw new NotFoundError('Match not found');
    }

    const periodType = periodNumber <= 4 
      ? `quarter_${periodNumber}` 
      : `overtime_${periodNumber - 4}`;

    await db.query(
      `UPDATE match_periods SET status = 'in_progress', start_time = NOW() 
       WHERE match_id = ? AND period_type = ?`,
      [matchId, periodType]
    );

    await matchRepository.update(matchId, {
      status: 'live',
      current_quarter: periodNumber,
      game_clock_seconds: periodNumber <= 4 ? this.rules.quarterDuration : this.rules.overtimeDuration,
      shot_clock_seconds: 24
    });

    ws.emitToMatch(matchId, 'basketball:period_start', {
      matchId,
      periodNumber,
      periodType,
      gameClock: this.rules.quarterDuration,
      timestamp: new Date().toISOString()
    });

    logger.info('Period started', { matchId, periodNumber, periodType });

    return { periodNumber, periodType, gameClock: this.rules.quarterDuration };
  }

  async endPeriod(matchId, periodNumber, injuryTime = 0) {
    const match = await matchRepository.findById(matchId);
    if (!match) {
      throw new NotFoundError('Match not found');
    }

    const periodType = periodNumber <= 4 
      ? `quarter_${periodNumber}` 
      : `overtime_${periodNumber - 4}`;

    await db.query(
      `UPDATE match_periods SET status = 'completed', end_time = NOW(), injury_time_minutes = ? 
       WHERE match_id = ? AND period_type = ?`,
      [injuryTime, matchId, periodType]
    );

    const isLastQuarter = periodNumber === 4;
    const isTied = match.home_score === match.away_score;
    const isKnockout = match.metadata?.is_knockout;

    if (isLastQuarter) {
      if (isTied && isKnockout) {
        await this.startOvertime(matchId, 1);
        return { nextAction: 'overtime', overtimeNumber: 1 };
      } else {
        await this.endMatch(matchId);
        return { nextAction: 'completed', winner: match.home_score > match.away_score ? 'home' : 'away' };
      }
    } else if (periodType.startsWith('overtime')) {
      const otNumber = parseInt(periodType.split('_')[1]);
      
      if (isTied) {
        if (this.rules.maxOvertimes && otNumber >= this.rules.maxOvertimes) {
          await this.endMatch(matchId);
          return { nextAction: 'completed', winner: 'draw' };
        }
        await this.startOvertime(matchId, otNumber + 1);
        return { nextAction: 'overtime', overtimeNumber: otNumber + 1 };
      } else {
        await this.endMatch(matchId);
        return { nextAction: 'completed', winner: match.home_score > match.away_score ? 'home' : 'away' };
      }
    }

    return { nextAction: 'next_period', periodNumber };
  }

  async startOvertime(matchId, overtimeNumber) {
    const match = await matchRepository.findById(matchId);
    if (!match) {
      throw new NotFoundError('Match not found');
    }

    const periodType = `overtime_${overtimeNumber}`;
    const otPeriodNumber = 4 + overtimeNumber;

    const existingPeriod = await db.query(
      `SELECT * FROM match_periods WHERE match_id = ? AND period_type = ?`,
      [matchId, periodType]
    );

    if (existingPeriod.length === 0) {
      await this.createPeriod(matchId, otPeriodNumber, periodType, 'pending');
    }

    await db.query(
      `UPDATE match_periods SET status = 'in_progress', start_time = NOW() 
       WHERE match_id = ? AND period_type = ?`,
      [matchId, periodType]
    );

    await matchRepository.update(matchId, {
      status: 'live',
      current_quarter: otPeriodNumber,
      overtime_count: overtimeNumber,
      game_clock_seconds: this.rules.overtimeDuration,
      shot_clock_seconds: 24
    });

    await foulService.resetForOvertime(matchId, match.home_team_id);
    await foulService.resetForOvertime(matchId, match.away_team_id);

    ws.emitToMatch(matchId, 'basketball:overtime_start', {
      matchId,
      overtimeNumber,
      gameClock: this.rules.overtimeDuration,
      timestamp: new Date().toISOString()
    });

    logger.info('Overtime started', { matchId, overtimeNumber });

    return { overtimeNumber, gameClock: this.rules.overtimeDuration };
  }

  async endMatch(matchId, winnerId = null) {
    const match = await matchRepository.findById(matchId);
    if (!match) {
      throw new NotFoundError('Match not found');
    }

    await db.query(
      `UPDATE match_periods SET status = 'completed', end_time = NOW() 
       WHERE match_id = ? AND status = 'in_progress'`
    );

    const winner = winnerId || (
      match.home_score > match.away_score ? match.home_team_id :
      match.away_score > match.home_score ? match.away_team_id : null
    );

    await matchRepository.update(matchId, {
      status: 'completed',
      ended_at: new Date(),
      winner_id: winner
    });

    ws.emitToMatch(matchId, 'basketball:game_end', {
      matchId,
      finalScore: { home: match.home_score, away: match.away_score },
      winnerId: winner,
      overtime: match.overtime_count > 0,
      overtimeCount: match.overtime_count,
      timestamp: new Date().toISOString()
    });

    logger.info('Match ended', { matchId, winner, score: `${match.home_score}-${match.away_score}` });

    return { success: true, winnerId: winner };
  }

  async getCurrentPeriod(matchId) {
    const [periods] = await db.query(
      `SELECT * FROM match_periods WHERE match_id = ? AND status = 'in_progress' ORDER BY period_number DESC LIMIT 1`,
      [matchId]
    );
    return periods[0] || null;
  }

  async getMatchPeriods(matchId) {
    return db.query(
      `SELECT * FROM match_periods WHERE match_id = ? ORDER BY period_number ASC`,
      [matchId]
    );
  }

  async updateGameClock(matchId, clockSeconds) {
    await matchRepository.update(matchId, {
      game_clock_seconds: clockSeconds
    });

    ws.emitToMatch(matchId, 'basketball:game_clock_update', {
      matchId,
      clock: clockSeconds,
      timestamp: new Date().toISOString()
    });

    return { clock: clockSeconds };
  }
}

export default new BasketballPeriodService();