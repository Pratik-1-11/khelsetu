import db from '../../../infrastructure/postgres/index.js';
import shotClockRepository from '../repositories/shotClockRepository.js';
import matchRepository from '../../matches/repositories/matchRepository.js';
import possessionService from './possessionService.js';
import scoringEventRepository from '../repositories/scoringEventRepository.js';
import { NotFoundError, ValidationError } from '../../../core/errors/index.js';
import logger from '../../../core/logger/index.js';
import ws from '../../../core/websocket/index.js';

export class ShotClockService {
  constructor(rules = {}) {
    this.initialClock = rules.initialClock || 24;
    this.resetAfterOffensiveRebound = rules.resetAfterOffensiveRebound !== undefined
      ? rules.resetAfterOffensiveRebound
      : 24;
    this.violationLimit = rules.violationLimit || null;
  }

  async getShotClock(matchId) {
    const match = await matchRepository.findById(matchId);
    return match?.shot_clock_seconds || this.initialClock;
  }

  async setShotClock(matchId, seconds, eventType = 'manual', metadata = {}) {
    const match = await matchRepository.findById(matchId);
    if (!match) {
      throw new NotFoundError('Match not found');
    }

    const previousClock = match.shot_clock_seconds || this.initialClock;

    await matchRepository.update(matchId, {
      shot_clock_seconds: seconds
    });

    const seqNum = await this.getNextSequenceNumber(matchId);

    await shotClockRepository.create({
      match_id: matchId,
      event_type: eventType,
      reset_reason: metadata.reset_reason,
      clock_value_before: previousClock,
      clock_value_after: seconds,
      triggered_by_player_id: metadata.player_id,
      quarter: match.current_quarter || 1,
      game_minute: metadata.game_minute || 0,
      game_second: metadata.game_second || 0,
      sequence_number: seqNum
    });

    ws.emitToMatch(matchId, 'basketball:shot_clock_update', {
      matchId,
      clock: seconds,
      eventType,
      previousClock,
      timestamp: new Date().toISOString()
    });

    logger.debug('Shot clock updated', { matchId, clock: seconds, eventType });

    return { clock: seconds, previous: previousClock };
  }

  async resetAfterMadeBasket(matchId, metadata = {}) {
    return this.setShotClock(matchId, this.initialClock, 'reset', {
      ...metadata,
      reset_reason: 'made_basket'
    });
  }

  async resetAfterOffensiveRebound(matchId, metadata = {}) {
    const resetValue = this.resetAfterOffensiveRebound;
    return this.setShotClock(matchId, resetValue, 'reset', {
      ...metadata,
      reset_reason: 'offensive_rebound'
    });
  }

  async resetAfterDeadBall(matchId, metadata = {}) {
    return this.setShotClock(matchId, this.initialClock, 'reset', {
      ...metadata,
      reset_reason: 'dead_ball'
    });
  }

  async handleViolation(matchId, metadata = {}) {
    const match = await matchRepository.findById(matchId);
    const currentClock = match?.shot_clock_seconds || 0;

    if (currentClock > 0) {
      logger.debug('Shot clock not at zero, no violation', { matchId, clock: currentClock });
      return { violation: false, clock: currentClock };
    }

    await this.setShotClock(matchId, this.initialClock, 'violation', metadata);

    const homeTeamId = match.home_team_id;
    const awayTeamId = match.away_team_id;
    const currentPossession = match.current_possession_team_id;
    const turnoverTeamId = currentPossession === homeTeamId ? homeTeamId : awayTeamId;
    const gainingTeamId = currentPossession === homeTeamId ? awayTeamId : homeTeamId;

    await matchRepository.update(matchId, {
      current_possession_team_id: gainingTeamId
    });

    ws.emitToMatch(matchId, 'basketball:shot_clock_violation', {
      matchId,
      turnoverTeamId,
      gainingTeamId: gainingTeamId,
      timestamp: new Date().toISOString()
    });

    logger.info('Shot clock violation', { matchId, turnoverTeam: turnoverTeamId });

    const violationCount = await shotClockRepository.getViolationCount(matchId);

    return {
      violation: true,
      violationCount,
      turnoverTeamId,
      gainingTeamId
    };
  }

  async startClock(matchId, metadata = {}) {
    return this.setShotClock(matchId, this.initialClock, 'start', metadata);
  }

  async stopClock(matchId, metadata = {}) {
    const match = await matchRepository.findById(matchId);
    return this.setShotClock(matchId, match?.shot_clock_seconds || 0, 'stop', metadata);
  }

  async tickDown(matchId) {
    const match = await matchRepository.findById(matchId);
    const currentClock = match?.shot_clock_seconds || this.initialClock;

    if (currentClock <= 0) {
      return this.handleViolation(matchId);
    }

    return this.setShotClock(matchId, currentClock - 1, 'tick');
  }

  async getViolationCount(matchId) {
    return shotClockRepository.getViolationCount(matchId);
  }

  async getShotClockEvents(matchId) {
    return shotClockRepository.findByMatch(matchId);
  }

  async getNextSequenceNumber(matchId) {
    const maxSeq = await scoringEventRepository.getLatestSequenceNumber(matchId);
    return maxSeq + 1;
  }
}

export default new ShotClockService();