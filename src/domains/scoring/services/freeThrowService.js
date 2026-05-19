import db from '../../../infrastructure/postgres/index.js';
import freeThrowRepository from '../repositories/freeThrowRepository.js';
import matchRepository from '../../matches/repositories/matchRepository.js';
import { NotFoundError, ValidationError } from '../../../core/errors/index.js';
import logger from '../../../core/logger/index.js';
import ws from '../../../core/websocket/index.js';

export class FreeThrowService {
  async startFreeThrowSequence(matchId, data) {
    const match = await matchRepository.findById(matchId);
    if (!match) {
      throw new NotFoundError('Match not found');
    }

    const existingPending = await freeThrowRepository.findPending(matchId, data.shooting_team_id);
    if (existingPending) {
      throw new ValidationError('Free throw sequence already in progress');
    }

    const sequence = await freeThrowRepository.create({
      match_id: matchId,
      shooting_team_id: data.shooting_team_id,
      shooting_player_id: data.shooting_player_id,
      fouled_player_id: data.fouled_player_id,
      shot_number: 1,
      total_shots: data.total_shots,
      shot_type: data.shot_type,
      quarter: data.quarter || match.current_quarter || 1,
      game_minute: data.game_minute || 0,
      game_second: data.game_second || 0,
      sequence_number: data.sequence_number
    });

    ws.emitToMatch(matchId, 'basketball:free_throw_start', {
      matchId,
      sequenceId: sequence.id,
      shootingTeamId: data.shooting_team_id,
      shootingPlayerId: data.shooting_player_id,
      totalShots: data.total_shots,
      shotType: data.shot_type,
      isAndOne: data.shot_type === 'and_one',
      timestamp: new Date().toISOString()
    });

    logger.info('Free throw sequence started', {
      matchId,
      sequenceId: sequence.id,
      shots: data.total_shots
    });

    return sequence;
  }

  async recordFreeThrow(matchId, sequenceId, made) {
    const sequence = await freeThrowRepository.findById(sequenceId);
    if (!sequence) {
      throw new NotFoundError('Free throw sequence not found');
    }

    if (sequence.is_completed) {
      throw new ValidationError('Free throw sequence already completed');
    }

    await freeThrowRepository.recordShot(sequenceId, made);

    const updatedSequence = await freeThrowRepository.findById(sequenceId);

    ws.emitToMatch(matchId, 'basketball:free_throw_result', {
      matchId,
      sequenceId,
      shotNumber: updatedSequence.shot_number,
      made,
      remainingShots: updatedSequence.total_shots - updatedSequence.shot_number,
      timestamp: new Date().toISOString()
    });

    if (updatedSequence.is_completed) {
      ws.emitToMatch(matchId, 'basketball:free_throw_complete', {
        matchId,
        sequenceId,
        totalShots: updatedSequence.total_shots,
        made: updatedSequence.made,
        shotType: updatedSequence.shot_type,
        timestamp: new Date().toISOString()
      });

      logger.info('Free throw sequence completed', {
        matchId,
        sequenceId,
        made: updatedSequence.made,
        totalShots: updatedSequence.total_shots
      });
    }

    return updatedSequence;
  }

  async cancelFreeThrowSequence(matchId, sequenceId) {
    const sequence = await freeThrowRepository.findById(sequenceId);
    if (!sequence) {
      throw new NotFoundError('Free throw sequence not found');
    }

    await freeThrowRepository.complete(sequenceId);

    ws.emitToMatch(matchId, 'basketball:free_throw_cancelled', {
      matchId,
      sequenceId,
      reason: 'cancellation',
      timestamp: new Date().toISOString()
    });

    return { success: true };
  }

  async getPendingSequence(matchId, teamId) {
    return freeThrowRepository.findPending(matchId, teamId);
  }

  async getMatchFreeThrows(matchId) {
    return freeThrowRepository.findByMatch(matchId);
  }

  async getTeamFreeThrowStats(matchId, teamId) {
    return freeThrowRepository.getTeamFreeThrowStats(matchId, teamId);
  }

  calculateShotType(foulType, bonusStatus, isAndOne, isThreePointAttempt) {
    if (foulType === 'technical') return 'technical';
    if (foulType === 'flagrant_1' || foulType === 'flagrant_2') return 'flagrant';
    if (foulType === 'clear_path') return 'clear_path';

    if (isAndOne) return 'and_one';
    if (bonusStatus === 'bonus') return 'bonus';
    if (bonusStatus === 'double_bonus') return 'bonus';

    return 'regular';
  }

  calculateShotCount(foulType, bonusStatus, shotType) {
    if (foulType === 'flagrant_2') return 2;
    if (foulType === 'flagrant_1' || foulType === 'clear_path') return 2;
    if (foulType === 'technical') return 1;

    if (bonusStatus === 'double_bonus') return 2;
    if (bonusStatus === 'bonus') return 1;

    return 0;
  }
}

export default new FreeThrowService();