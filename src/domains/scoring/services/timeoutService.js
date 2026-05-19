import db from '../../../infrastructure/postgres/index.js';
import timeoutRepository from '../repositories/timeoutRepository.js';
import matchRepository from '../../matches/repositories/matchRepository.js';
import { NotFoundError, ValidationError } from '../../../core/errors/index.js';
import logger from '../../../core/logger/index.js';
import ws from '../../../core/websocket/index.js';

const TIMEOUT_TYPES = {
  FULL: 'full',
  SHORT: 'short',
  OFFICIAL: 'official',
  INJURY: 'injury'
};

const TIMEOUT_DURATION = {
  full: 60,
  short: 20,
  official: 0,
  injury: 0
};

export class TimeoutService {
  constructor(rules = {}) {
    this.timeoutsPerHalf = rules.timeoutsPerHalf || 2;
    this.timeoutsPerGame = rules.timeoutsPerGame || 6;
  }

  async callTimeout(matchId, teamId, timeoutType = TIMEOUT_TYPES.FULL, metadata = {}) {
    const match = await matchRepository.findById(matchId);
    if (!match) {
      throw new NotFoundError('Match not found');
    }

    if (match.status !== 'live') {
      throw new ValidationError('Can only call timeout in live match');
    }

    const currentQuarter = match.current_quarter || 1;
    const isFirstHalf = currentQuarter <= 2;

    const usedCount = await this.getTimeoutCount(matchId, teamId);
    const maxAllowed = isFirstHalf ? this.timeoutsPerHalf : this.timeoutsPerGame - this.timeoutsPerHalf;

    if (usedCount >= maxAllowed) {
      throw new ValidationError(`No timeouts remaining. Used: ${usedCount}, Max: ${maxAllowed}`);
    }

    const timeout = await timeoutRepository.create({
      match_id: matchId,
      team_id: teamId,
      timeout_type: timeoutType,
      quarter: currentQuarter,
      minute: metadata.minute || 0,
      second: metadata.second || 0,
      remaining_from_original: TIMEOUT_DURATION[timeoutType]
    });

    ws.emitToMatch(matchId, 'basketball:timeout_called', {
      matchId,
      teamId,
      timeoutType,
      quarter: currentQuarter,
      remainingFromOriginal: TIMEOUT_DURATION[timeoutType],
      timestamp: new Date().toISOString()
    });

    logger.info('Timeout called', {
      matchId,
      teamId,
      timeoutType,
      quarter: currentQuarter,
      usedCount: usedCount + 1
    });

    return {
      timeout,
      timeoutsRemaining: maxAllowed - (usedCount + 1),
      timeoutsUsed: usedCount + 1
    };
  }

  async completeTimeout(matchId, timeoutId) {
    const timeout = await timeoutRepository.findById(timeoutId);
    if (!timeout) {
      throw new NotFoundError('Timeout not found');
    }

    await timeoutRepository.complete(timeoutId);

    const remaining = await this.getRemainingTimeouts(matchId, timeout.team_id);

    ws.emitToMatch(matchId, 'basketball:timeout_completed', {
      matchId,
      timeoutId,
      teamId: timeout.team_id,
      remaining,
      timestamp: new Date().toISOString()
    });

    return { success: true, remaining };
  }

  async cancelTimeout(matchId, timeoutId) {
    const timeout = await timeoutRepository.findById(timeoutId);
    if (!timeout) {
      throw new NotFoundError('Timeout not found');
    }

    await timeoutRepository.cancel(timeoutId);

    ws.emitToMatch(matchId, 'basketball:timeout_cancelled', {
      matchId,
      timeoutId,
      teamId: timeout.team_id,
      timestamp: new Date().toISOString()
    });

    return { success: true };
  }

  async getTimeoutCount(matchId, teamId) {
    return timeoutRepository.getTimeoutCount(matchId, teamId);
  }

  async getRemainingTimeouts(matchId, teamId) {
    const match = await matchRepository.findById(matchId);
    const currentQuarter = match?.current_quarter || 1;
    const isFirstHalf = currentQuarter <= 2;

    const usedCount = await this.getTimeoutCount(matchId, teamId);
    const maxAllowed = isFirstHalf ? this.timeoutsPerHalf : this.timeoutsPerGame - this.timeoutsPerHalf;

    return {
      remaining: maxAllowed - usedCount,
      used: usedCount,
      maxAllowed
    };
  }

  async getMatchTimeouts(matchId) {
    return timeoutRepository.findByMatch(matchId);
  }

  async getTeamTimeouts(matchId, teamId) {
    return timeoutRepository.findByTeam(matchId, teamId);
  }

  async validateTimeout(matchId, teamId) {
    const match = await matchRepository.findById(matchId);
    if (!match || match.status !== 'live') {
      return { valid: false, reason: 'Match not live' };
    }

    const remaining = await this.getRemainingTimeouts(matchId, teamId);

    return {
      valid: remaining.remaining > 0,
      ...remaining
    };
  }
}

export default new TimeoutService();