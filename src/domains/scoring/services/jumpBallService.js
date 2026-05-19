import db from '../../../infrastructure/postgres/index.js';
import jumpBallRepository from '../repositories/jumpBallRepository.js';
import matchRepository from '../../matches/repositories/matchRepository.js';
import possessionService from './possessionService.js';
import { NotFoundError, ValidationError } from '../../../core/errors/index.js';
import logger from '../../../core/logger/index.js';
import ws from '../../../core/websocket/index.js';

export class JumpBallService {
  async handleInitialJumpBall(matchId, data) {
    const match = await matchRepository.findById(matchId);
    if (!match) {
      throw new NotFoundError('Match not found');
    }

    const jumpBall = await jumpBallRepository.create({
      match_id: matchId,
      quarter: 1,
      minute: 0,
      second: 0,
      jump_ball_type: 'initial',
      team_1_id: match.home_team_id,
      team_2_id: match.away_team_id,
      winner_team_id: data.winner_team_id,
      sequence_number: data.sequence_number
    });

    await possessionService.handleJumpBall(matchId, data.winner_team_id, {
      quarter: 1,
      minute: 0,
      second: 0,
      jump_ball_type: 'initial',
      team_1_id: match.home_team_id,
      team_2_id: match.away_team_id,
      sequence_number: data.sequence_number
    });

    ws.emitToMatch(matchId, 'basketball:initial_jump_ball', {
      matchId,
      winnerTeamId: data.winner_team_id,
      timestamp: new Date().toISOString()
    });

    logger.info('Initial jump ball recorded', { matchId, winner: data.winner_team_id });

    return jumpBall;
  }

  async handleTieUp(matchId, data) {
    const match = await matchRepository.findById(matchId);
    if (!match) {
      throw new NotFoundError('Match not found');
    }

    const currentPossession = match.current_possession_team_id;
    const nonPossessionTeam = currentPossession === match.home_team_id 
      ? match.away_team_id 
      : match.home_team_id;

    const jumpBall = await jumpBallRepository.create({
      match_id: matchId,
      quarter: data.quarter || match.current_quarter || 1,
      minute: data.minute || 0,
      second: data.second || 0,
      jump_ball_type: 'tie_up',
      team_1_id: currentPossession,
      team_2_id: nonPossessionTeam,
      winner_team_id: data.winner_team_id,
      sequence_number: data.sequence_number
    });

    await possessionService.handleJumpBall(matchId, data.winner_team_id, {
      quarter: data.quarter,
      minute: data.minute,
      second: data.second,
      jump_ball_type: 'tie_up',
      team_1_id: currentPossession,
      team_2_id: nonPossessionTeam,
      sequence_number: data.sequence_number
    });

    ws.emitToMatch(matchId, 'basketball:jump_ball', {
      matchId,
      type: 'tie_up',
      winnerTeamId: data.winner_team_id,
      quarter: data.quarter,
      minute: data.minute,
      timestamp: new Date().toISOString()
    });

    return jumpBall;
  }

  async getJumpBallHistory(matchId) {
    return jumpBallRepository.findByMatch(matchId);
  }

  async getJumpBallCount(matchId, teamId) {
    return jumpBallRepository.getJumpBallCount(matchId, teamId);
  }
}

export default new JumpBallService();