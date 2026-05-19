import db from '../../../infrastructure/postgres/index.js';
import foulRepository from '../repositories/foulRepository.js';
import teamFoulCounterRepository from '../repositories/foulRepository.js';
import matchRepository from '../../matches/repositories/matchRepository.js';
import { NotFoundError, ValidationError } from '../../../core/errors/index.js';
import logger from '../../../core/logger/index.js';
import ws from '../../../core/websocket/index.js';

const PERSONAL_FOUL_LIMIT_NBA = 6;
const PERSONAL_FOUL_LIMIT_FIBA = 5;
const TEAM_FOUL_BONUS_THRESHOLD = 5;
const TEAM_FOUL_DOUBLE_BONUS_THRESHOLD = 8;

export class FoulService {
  constructor(rules = {}) {
    this.personalFoulLimit = rules.personalFoulLimit || PERSONAL_FOUL_LIMIT_NBA;
    this.rules = rules;
  }

  async initializeForMatch(matchId, homeTeamId, awayTeamId) {
    await teamFoulCounterRepository.initializeForMatch(matchId, homeTeamId, awayTeamId);
    logger.info('Foul counters initialized', { matchId });
  }

  async recordFoul(matchId, data) {
    const match = await matchRepository.findById(matchId);
    if (!match) {
      throw new NotFoundError('Match not found');
    }

    const quarter = data.quarter || match.current_quarter || 1;

    const foulEvent = await foulRepository.create({
      match_id: matchId,
      team_id: data.team_id,
      player_id: data.player_id,
      foul_type: data.foul_type,
      quarter: quarter,
      game_minute: data.game_minute || 0,
      game_second: data.game_second || 0,
      metadata: {
        fouled_player_id: data.fouled_player_id,
        shot_type: data.shot_type,
        is_shooting_foul: data.is_shooting_foul
      },
      created_by: data.created_by
    });

    const playerFoulCount = await this.getPlayerFoulCount(matchId, data.player_id);

    const teamBonusInfo = await teamFoulCounterRepository.incrementFoul(matchId, data.team_id, quarter);

    const isFouledOut = playerFoulCount.personal >= this.personalFoulLimit;

    if (isFouledOut) {
      ws.emitToMatch(matchId, 'basketball:player_fouled_out', {
        matchId,
        playerId: data.player_id,
        teamId: data.team_id,
        foulCount: playerFoulCount.personal,
        limit: this.personalFoulLimit,
        timestamp: new Date().toISOString()
      });

      logger.warn('Player fouled out', { matchId, playerId: data.playerId, fouls: playerFoulCount.personal });
    }

    ws.emitToMatch(matchId, 'basketball:foul_committed', {
      matchId,
      playerId: data.player_id,
      teamId: data.team_id,
      foulType: data.foul_type,
      quarter,
      playerFoulCount: playerFoulCount.personal,
      teamFoulCount: teamBonusInfo.total_fouls,
      bonusStatus: teamBonusInfo.bonus_status,
      isFouledOut,
      timestamp: new Date().toISOString()
    });

    if (teamBonusInfo.bonus_status !== 'none') {
      ws.emitToMatch(matchId, 'basketball:bonus_status', {
        matchId,
        teamId: data.team_id,
        status: teamBonusInfo.bonus_status,
        fouls: teamBonusInfo.total_fouls,
        threshold: teamBonusInfo.bonus_status === 'double_bonus' ? TEAM_FOUL_DOUBLE_BONUS_THRESHOLD : TEAM_FOUL_BONUS_THRESHOLD,
        timestamp: new Date().toISOString()
      });
    }

    logger.debug('Foul recorded', {
      matchId,
      playerId: data.player_id,
      foulType: data.foul_type,
      quarter,
      teamFouls: teamBonusInfo.total_fouls
    });

    return {
      foul: foulEvent,
      playerFoulCount,
      teamBonusInfo,
      isFouledOut,
      requiresFreeThrows: this.requiresFreeThrows(data.foul_type, teamBonusInfo.bonus_status),
      shotType: data.is_shooting_foul ? data.shot_type : null
    };
  }

  requiresFreeThrows(foulType, bonusStatus) {
    const shootingFouls = ['shooting_foul', 'flagrant_1', 'flagrant_2', 'clear_path'];
    if (shootingFouls.includes(foulType)) return true;
    if (bonusStatus !== 'none' && foulType !== 'technical') return true;
    return false;
  }

  async getPlayerFoulCount(matchId, playerId) {
    return foulRepository.getPlayerFoulCount(matchId, playerId);
  }

  async getTeamFoulCount(matchId, teamId) {
    const quarterFouls = await foulRepository.getTeamFoulsByQuarter(matchId, teamId);
    const teamCounter = await teamFoulCounterRepository.findByTeam(matchId, teamId);

    const foulsByQuarter = { 1: 0, 2: 0, 3: 0, 4: 0, ot1: 0, ot2: 0, ot3: 0 };
    for (const q of quarterFouls) {
      foulsByQuarter[q.quarter] = q.foul_count;
    }

    return {
      byQuarter: foulsByQuarter,
      total: teamCounter?.quarter_1_fouls + teamCounter?.quarter_2_fouls +
             teamCounter?.quarter_3_fouls + teamCounter?.quarter_4_fouls +
             teamCounter?.overtime_1_fouls + teamCounter?.overtime_2_fouls + teamCounter?.overtime_3_fouls || 0,
      bonus_status: teamCounter?.bonus_status || 'none'
    };
  }

  async getBonusStatus(matchId, teamId) {
    return teamFoulCounterRepository.getBonusStatus(matchId, teamId);
  }

  async calculateFreeThrowCount(foulType, bonusStatus, shotType) {
    if (foulType === 'flagrant_2') return 2;
    if (foulType === 'flagrant_1' || foulType === 'clear_path') return 2;
    if (foulType === 'technical') return 1;

    if (bonusStatus === 'double_bonus') return 2;
    if (bonusStatus === 'bonus') return 1;

    return 0;
  }

  async handleTechnicalFoul(matchId, teamId, playerId, data) {
    const result = await this.recordFoul(matchId, {
      ...data,
      team_id: teamId,
      player_id: playerId,
      foul_type: 'technical'
    });

    ws.emitToMatch(matchId, 'basketball:technical_foul', {
      matchId,
      teamId,
      playerId,
      reason: data.reason,
      timestamp: new Date().toISOString()
    });

    return result;
  }

  async handleFlagrantFoul(matchId, teamId, playerId, data) {
    const result = await this.recordFoul(matchId, {
      ...data,
      team_id: teamId,
      player_id: playerId,
      foul_type: data.flagrant_type || 'flagrant_1'
    });

    return result;
  }

  async reverseFoul(foulId, userId) {
    const foul = await foulRepository.findById(foulId);
    if (!foul) {
      throw new NotFoundError('Foul not found');
    }

    if (foul.is_reversed) {
      throw new ValidationError('Foul already reversed');
    }

    await foulRepository.reverse(foulId, userId);

    await teamFoulCounterRepository.decrementFoul(foul.match_id, foul.team_id, foul.quarter);

    ws.emitToMatch(foul.match_id, 'basketball:foul_reversed', {
      matchId: foul.match_id,
      foulId,
      playerId: foul.player_id,
      timestamp: new Date().toISOString()
    });

    logger.info('Foul reversed', { matchId: foul.match_id, foulId });

    return { success: true };
  }

  async getMatchFouls(matchId) {
    return foulRepository.findByMatch(matchId);
  }

  async resetForOvertime(matchId, teamId) {
    await teamFoulCounterRepository.resetForOvertime(matchId, teamId);
  }
}

export default new FoulService();