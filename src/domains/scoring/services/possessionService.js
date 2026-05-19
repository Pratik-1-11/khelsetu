import db from '../../../infrastructure/postgres/index.js';
import possessionRepository from '../repositories/possessionRepository.js';
import jumpBallRepository from '../repositories/jumpBallRepository.js';
import matchRepository from '../../matches/repositories/matchRepository.js';
import { NotFoundError, ValidationError } from '../../../core/errors/index.js';
import { generateUUID } from '../../../core/utils/index.js';
import logger from '../../../core/logger/index.js';
import ws from '../../../core/websocket/index.js';

export class PossessionService {
  async initialize(matchId, homeTeamId, awayTeamId) {
    const match = await matchRepository.findById(matchId);
    if (!match) {
      throw new NotFoundError('Match not found');
    }

    await possessionRepository.initialize(matchId, homeTeamId, awayTeamId);

    logger.info('Possession initialized', { matchId, homeTeamId, awayTeamId });
    return this.getPossession(matchId);
  }

  async getPossession(matchId) {
    const possession = await possessionRepository.findByMatch(matchId);
    if (!possession) {
      const match = await matchRepository.findById(matchId);
      if (match) {
        return this.initialize(matchId, match.home_team_id, match.away_team_id);
      }
      throw new NotFoundError('Match not found');
    }
    return possession;
  }

  async handleMadeBasket(matchId, scoringTeamId, metadata = {}) {
    const possession = await this.getPossession(matchId);
    const nonScoringTeamId = scoringTeamId === possession.current_possession_team_id
      ? (scoringTeamId === metadata.homeTeamId ? metadata.awayTeamId : metadata.homeTeamId)
      : possession.current_possession_team_id;

    const eventId = generateUUID();
    await possessionRepository.update(matchId, {
      current_possession_team_id: nonScoringTeamId,
      last_possession_event_id: eventId
    });

    ws.emitToMatch(matchId, 'basketball:possession_change', {
      matchId,
      teamId: nonScoringTeamId,
      reason: 'made_basket',
      timestamp: new Date().toISOString()
    });

    logger.debug('Possession changed after made basket', { matchId, newTeam: nonScoringTeamId });
    return this.getPossession(matchId);
  }

  async handleTurnover(matchId, turnoverTeamId, metadata = {}) {
    const possession = await this.getPossession(matchId);
    const gainingTeamId = turnoverTeamId === possession.current_possession_team_id
      ? (turnoverTeamId === metadata.homeTeamId ? metadata.awayTeamId : metadata.homeTeamId)
      : possession.current_possession_team_id;

    const eventId = generateUUID();
    await possessionRepository.update(matchId, {
      current_possession_team_id: gainingTeamId,
      last_possession_event_id: eventId
    });

    ws.emitToMatch(matchId, 'basketball:possession_change', {
      matchId,
      teamId: gainingTeamId,
      reason: 'turnover',
      timestamp: new Date().toISOString()
    });

    logger.debug('Possession changed after turnover', { matchId, newTeam: gainingTeamId });
    return this.getPossession(matchId);
  }

  async handleDeadBallFoul(matchId, foulingTeamId, isInBonus, metadata = {}) {
    const possession = await this.getPossession(matchId);

    if (isInBonus) {
      logger.debug('In bonus - possession arrow unchanged', { matchId, foulingTeamId });
      return possession;
    }

    const nonFoulingTeamId = foulingTeamId === metadata.homeTeamId ? metadata.awayTeamId : metadata.homeTeamId;

    const eventId = generateUUID();
    await possessionRepository.update(matchId, {
      current_possession_team_id: nonFoulingTeamId,
      last_possession_event_id: eventId
    });

    ws.emitToMatch(matchId, 'basketball:possession_change', {
      matchId,
      teamId: nonFoulingTeamId,
      reason: 'dead_ball_foul',
      timestamp: new Date().toISOString()
    });

    return this.getPossession(matchId);
  }

  async handleJumpBall(matchId, winningTeamId, jumpBallData) {
    const match = await matchRepository.findById(matchId);

    await jumpBallRepository.create({
      match_id: matchId,
      quarter: jumpBallData.quarter,
      minute: jumpBallData.minute,
      second: jumpBallData.second,
      jump_ball_type: jumpBallData.jump_ball_type || 'initial',
      team_1_id: jumpBallData.team_1_id,
      team_2_id: jumpBallData.team_2_id,
      winner_team_id: winningTeamId,
      sequence_number: jumpBallData.sequence_number
    });

    const eventId = generateUUID();
    await possessionRepository.update(matchId, {
      current_possession_team_id: winningTeamId,
      possession_arrow_team_id: winningTeamId === match.home_team_id ? match.away_team_id : match.home_team_id,
      last_possession_event_id: eventId
    });

    ws.emitToMatch(matchId, 'basketball:jump_ball_result', {
      matchId,
      winnerTeamId: winningTeamId,
      jumpBallType: jumpBallData.jump_ball_type,
      timestamp: new Date().toISOString()
    });

    return this.getPossession(matchId);
  }

  async alternatePossessionArrow(matchId) {
    const possession = await this.getPossession(matchId);
    const match = await matchRepository.findById(matchId);

    const newArrow = possession.possession_arrow_team_id === match.home_team_id
      ? match.away_team_id
      : match.home_team_id;

    await possessionRepository.update(matchId, {
      possession_arrow_team_id: newArrow
    });

    return this.getPossession(matchId);
  }

  async setPossession(matchId, teamId, reason = 'manual') {
    const eventId = generateUUID();
    await possessionRepository.update(matchId, {
      current_possession_team_id: teamId,
      last_possession_event_id: eventId
    });

    ws.emitToMatch(matchId, 'basketball:possession_change', {
      matchId,
      teamId,
      reason,
      timestamp: new Date().toISOString()
    });

    return this.getPossession(matchId);
  }
}

export default new PossessionService();