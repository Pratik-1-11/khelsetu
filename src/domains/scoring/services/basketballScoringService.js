import db from '../../../infrastructure/postgres/index.js';
import matchRepository from '../../matches/repositories/matchRepository.js';
import scoringEventRepository from '../repositories/scoringEventRepository.js';
import possessionService from './possessionService.js';
import foulService from './foulService.js';
import shotClockService from './shotClockService.js';
import freeThrowService from './freeThrowService.js';
import timeoutService from './timeoutService.js';
import statisticsRepository from '../repositories/statisticsRepository.js';
import { NotFoundError, ValidationError } from '../../../core/errors/index.js';
import { generateUUID } from '../../../core/utils/index.js';
import logger from '../../../core/logger/index.js';
import ws from '../../../core/websocket/index.js';

const BASKETBALL_EVENT_TYPES = {
  FIELD_GOAL_MADE: 'field_goal_made',
  FIELD_GOAL_MISSED: 'field_goal_missed',
  THREE_POINTER_MADE: 'three_pointer_made',
  THREE_POINTER_MISSED: 'three_pointer_missed',
  FREE_THROW_MADE: 'free_throw_made',
  FREE_THROW_MISSED: 'free_throw_missed',
  OFFENSIVE_REBOUND: 'offensive_rebound',
  DEFENSIVE_REBOUND: 'defensive_rebound',
  ASSIST: 'assist',
  STEAL: 'steal',
  TURNOVER: 'turnover',
  BLOCK: 'block',
  PERSONAL_FOUL: 'personal_foul',
  SHOOTING_FOUL: 'shooting_foul',
  OFFENSIVE_FOUL: 'offensive_foul',
  TECHNICAL_FOUL: 'technical_foul',
  FLAGRANT_FOUL_1: 'flagrant_foul_1',
  FLAGRANT_FOUL_2: 'flagrant_foul_2',
  JUMP_BALL: 'jump_ball',
  VIOLATION: 'violation',
  TIMEOUT: 'timeout',
  SUBSTITUTION: 'substitution'
};

export class BasketballScoringService {
  constructor(rules = {}) {
    this.rules = rules;
    this.shotClockService = shotClockService;
  }

  async initializeMatch(matchId) {
    const match = await matchRepository.findById(matchId);
    if (!match) {
      throw new NotFoundError('Match not found');
    }

    await possessionService.initialize(matchId, match.home_team_id, match.away_team_id);
    await foulService.initializeForMatch(matchId, match.home_team_id, match.away_team_id);
    await statisticsRepository.initializeTeamStats(matchId, match.home_team_id);
    await statisticsRepository.initializeTeamStats(matchId, match.away_team_id);

    await matchRepository.update(matchId, {
      shot_clock_seconds: 24,
      game_clock_seconds: 720,
      current_quarter: 1,
      overtime_count: 0
    });

    logger.info('Basketball match initialized', { matchId });
    return { success: true };
  }

  async handleFieldGoal(matchId, data) {
    return await db.transaction(async (connection) => {
      const match = await matchRepository.findById(matchId);
      if (!match) throw new NotFoundError('Match not found');

      const points = data.is_three_pointer ? 3 : 2;
      const eventType = data.is_three_pointer 
        ? BASKETBALL_EVENT_TYPES.THREE_POINTER_MADE 
        : BASKETBALL_EVENT_TYPES.FIELD_GOAL_MADE;

      const event = await this.createScoringEvent(matchId, match.organization_id, {
        event_type: eventType,
        team_id: data.team_id,
        player_id: data.player_id,
        metadata: {
          points,
          shot_type: data.shot_type,
          zone: data.zone,
          distance: data.distance,
          quarter: match.current_quarter,
          game_clock: data.game_clock,
          is_and_one: data.is_and_one
        },
        created_by: data.created_by
      });

      const newScore = await this.computeScore(matchId);
      await matchRepository.update(matchId, {
        home_score: newScore.home,
        away_score: newScore.away
      });

      await this.updatePlayerStats(matchId, data.player_id, data.team_id, {
        points,
        field_goals_made: 1,
        field_goals_attempted: 1,
        three_pointers_made: data.is_three_pointer ? 1 : 0,
        three_pointers_attempted: data.is_three_pointer ? 1 : 0
      });

      await this.updateTeamStats(matchId, data.team_id, {
        points,
        field_goals_made: 1,
        field_goals_attempted: 1,
        three_pointers_made: data.is_three_pointer ? 1 : 0,
        three_pointers_attempted: data.is_three_pointer ? 1 : 0
      });

      if (data.is_shooting_foul) {
        const foulResult = await foulService.recordFoul(matchId, {
          team_id: data.fouling_team_id,
          player_id: data.fouled_player_id,
          foul_type: 'shooting_foul',
          quarter: match.current_quarter,
          game_minute: data.game_minute,
          game_second: data.game_second,
          is_shooting_foul: true,
          shot_type: data.is_three_pointer ? 'three_point' : 'two_point',
          created_by: data.created_by
        });

        if (foulResult.requiresFreeThrows) {
          const bonusStatus = await foulService.getBonusStatus(matchId, data.fouling_team_id);
          const shotType = freeThrowService.calculateShotType(
            'shooting_foul',
            bonusStatus.bonus_status,
            data.is_and_one,
            data.is_three_pointer
          );
          const shotCount = foulResult.shotType ? 2 : (bonusStatus.bonus_status === 'double_bonus' ? 2 : 1);

          await freeThrowService.startFreeThrowSequence(matchId, {
            shooting_team_id: data.team_id,
            shooting_player_id: data.player_id,
            fouled_player_id: data.fouled_player_id,
            total_shots: shotCount,
            shot_type: data.is_and_one ? 'and_one' : shotType,
            quarter: match.current_quarter,
            game_minute: data.game_minute,
            game_second: data.game_second,
            sequence_number: event.sequence_number
          });
        }
      } else {
        await possessionService.handleMadeBasket(matchId, data.team_id, {
          homeTeamId: match.home_team_id,
          awayTeamId: match.away_team_id
        });
      }

      await shotClockService.resetAfterMadeBasket(matchId, {
        player_id: data.player_id,
        quarter: match.current_quarter,
        game_minute: data.game_minute,
        game_second: data.game_second
      });

      ws.emitToMatch(matchId, 'basketball:field_goal', {
        matchId,
        eventId: event.id,
        teamId: data.team_id,
        playerId: data.player_id,
        points,
        isThreePointer: data.is_three_pointer,
        score: newScore,
        timestamp: new Date().toISOString()
      });

      logger.info('Field goal recorded', { matchId, playerId: data.player_id, points });

      return { event, score: newScore };
    });
  }

  async handleFreeThrow(matchId, data) {
    const match = await matchRepository.findById(matchId);
    if (!match) throw new NotFoundError('Match not found');

    const eventType = data.made 
      ? BASKETBALL_EVENT_TYPES.FREE_THROW_MADE 
      : BASKETBALL_EVENT_TYPES.FREE_THROW_MISSED;

    const points = data.made ? 1 : 0;

    const event = await this.createScoringEvent(matchId, match.organization_id, {
      event_type: eventType,
      team_id: data.team_id,
      player_id: data.player_id,
      metadata: {
        points,
        quarter: match.current_quarter,
        game_clock: data.game_clock,
        sequence_id: data.sequence_id
      },
      created_by: data.created_by
    });

    await freeThrowService.recordFreeThrow(matchId, data.sequence_id, data.made);

    const newScore = await this.computeScore(matchId);
    await matchRepository.update(matchId, {
      home_score: newScore.home,
      away_score: newScore.away
    });

    await this.updatePlayerStats(matchId, data.player_id, data.team_id, {
      points,
      free_throws_made: data.made ? 1 : 0,
      free_throws_attempted: 1
    });

    await this.updateTeamStats(matchId, data.team_id, {
      points,
      free_throws_made: data.made ? 1 : 0,
      free_throws_attempted: 1
    });

    ws.emitToMatch(matchId, 'basketball:free_throw_update', {
      matchId,
      teamId: data.team_id,
      playerId: data.player_id,
      made: data.made,
      score: newScore,
      timestamp: new Date().toISOString()
    });

    return { event, score: newScore };
  }

  async handleRebound(matchId, data) {
    const match = await matchRepository.findById(matchId);
    if (!match) throw new NotFoundError('Match not found');

    const eventType = data.rebound_type === 'offensive'
      ? BASKETBALL_EVENT_TYPES.OFFENSIVE_REBOUND
      : BASKETBALL_EVENT_TYPES.DEFENSIVE_REBOUND;

    const event = await this.createScoringEvent(matchId, match.organization_id, {
      event_type: eventType,
      team_id: data.team_id,
      player_id: data.player_id,
      metadata: {
        quarter: match.current_quarter,
        game_clock: data.game_clock
      },
      created_by: data.created_by
    });

    await this.updatePlayerStats(matchId, data.player_id, data.team_id, {
      offensive_rebounds: data.rebound_type === 'offensive' ? 1 : 0,
      defensive_rebounds: data.rebound_type === 'defensive' ? 1 : 0,
      total_rebounds: 1
    });

    const teamStatKey = data.rebound_type === 'offensive' ? 'offensive_rebounds' : 'defensive_rebounds';
    await this.updateTeamStats(matchId, data.team_id, {
      [teamStatKey]: 1,
      total_rebounds: 1
    });

    if (data.rebound_type === 'offensive') {
      await shotClockService.resetAfterOffensiveRebound(matchId, {
        player_id: data.player_id,
        quarter: match.current_quarter,
        game_minute: data.game_minute,
        game_second: data.game_second
      });
    }

    ws.emitToMatch(matchId, 'basketball:rebound', {
      matchId,
      playerId: data.player_id,
      teamId: data.team_id,
      reboundType: data.rebound_type,
      timestamp: new Date().toISOString()
    });

    return { event };
  }

  async handleAssist(matchId, data) {
    const match = await matchRepository.findById(matchId);
    if (!match) throw new NotFoundError('Match not found');

    const event = await this.createScoringEvent(matchId, match.organization_id, {
      event_type: BASKETBALL_EVENT_TYPES.ASSIST,
      team_id: data.team_id,
      player_id: data.player_id,
      metadata: {
        assisted_player_id: data.assisted_player_id,
        quarter: match.current_quarter,
        game_clock: data.game_clock
      },
      created_by: data.created_by
    });

    await this.updatePlayerStats(matchId, data.player_id, data.team_id, {
      assists: 1
    });

    await this.updateTeamStats(matchId, data.team_id, {
      assists: 1
    });

    return { event };
  }

  async handleSteal(matchId, data) {
    const match = await matchRepository.findById(matchId);
    if (!match) throw new NotFoundError('Match not found');

    const event = await this.createScoringEvent(matchId, match.organization_id, {
      event_type: BASKETBALL_EVENT_TYPES.STEAL,
      team_id: data.team_id,
      player_id: data.player_id,
      metadata: {
        stolen_from_player_id: data.stolen_from_player_id,
        quarter: match.current_quarter,
        game_clock: data.game_clock
      },
      created_by: data.created_by
    });

    await this.updatePlayerStats(matchId, data.player_id, data.team_id, {
      steals: 1
    });

    await this.updateTeamStats(matchId, data.team_id, {
      steals: 1
    });

    await possessionService.handleTurnover(matchId, data.stolen_from_team_id, {
      homeTeamId: match.home_team_id,
      awayTeamId: match.away_team_id
    });

    await shotClockService.resetAfterMadeBasket(matchId, {
      player_id: data.player_id,
      quarter: match.current_quarter,
      game_minute: data.game_minute,
      game_second: data.game_second
    });

    return { event };
  }

  async handleTurnover(matchId, data) {
    const match = await matchRepository.findById(matchId);
    if (!match) throw new NotFoundError('Match not found');

    const event = await this.createScoringEvent(matchId, match.organization_id, {
      event_type: BASKETBALL_EVENT_TYPES.TURNOVER,
      team_id: data.team_id,
      player_id: data.player_id,
      metadata: {
        turnover_type: data.turnover_type,
        quarter: match.current_quarter,
        game_clock: data.game_clock
      },
      created_by: data.created_by
    });

    await this.updatePlayerStats(matchId, data.player_id, data.team_id, {
      turnovers: 1
    });

    await this.updateTeamStats(matchId, data.team_id, {
      turnovers: 1
    });

    await possessionService.handleTurnover(matchId, data.team_id, {
      homeTeamId: match.home_team_id,
      awayTeamId: match.away_team_id
    });

    await shotClockService.resetAfterMadeBasket(matchId, {
      quarter: match.current_quarter,
      game_minute: data.game_minute,
      game_second: data.game_second
    });

    ws.emitToMatch(matchId, 'basketball:turnover', {
      matchId,
      playerId: data.player_id,
      teamId: data.team_id,
      turnoverType: data.turnover_type,
      timestamp: new Date().toISOString()
    });

    return { event };
  }

  async handleBlock(matchId, data) {
    const match = await matchRepository.findById(matchId);
    if (!match) throw new NotFoundError('Match not found');

    const event = await this.createScoringEvent(matchId, match.organization_id, {
      event_type: BASKETBALL_EVENT_TYPES.BLOCK,
      team_id: data.team_id,
      player_id: data.player_id,
      metadata: {
        blocked_player_id: data.blocked_player_id,
        quarter: match.current_quarter,
        game_clock: data.game_clock
      },
      created_by: data.created_by
    });

    await this.updatePlayerStats(matchId, data.player_id, data.team_id, {
      blocks: 1
    });

    await this.updateTeamStats(matchId, data.team_id, {
      blocks: 1
    });

    return { event };
  }

  async handleFoul(matchId, data) {
    const match = await matchRepository.findById(matchId);
    if (!match) throw new NotFoundError('Match not found');

    const foulResult = await foulService.recordFoul(matchId, {
      team_id: data.team_id,
      player_id: data.player_id,
      foul_type: data.foul_type,
      fouled_player_id: data.fouled_player_id,
      quarter: match.current_quarter,
      game_minute: data.game_minute,
      game_second: data.game_second,
      is_shooting_foul: data.is_shooting_foul,
      shot_type: data.shot_type,
      created_by: data.created_by
    });

    if (data.is_shooting_foul && data.fouled_player_id) {
      const bonusStatus = await foulService.getBonusStatus(matchId, data.team_id);
      const shotCount = await foulService.calculateFreeThrowCount(
        data.foul_type,
        bonusStatus.bonus_status,
        data.shot_type
      );

      if (shotCount > 0) {
        await freeThrowService.startFreeThrowSequence(matchId, {
          shooting_team_id: data.fouled_team_id,
          shooting_player_id: data.fouled_player_id,
          fouled_player_id: data.fouled_player_id,
          total_shots: shotCount,
          shot_type: 'bonus',
          quarter: match.current_quarter,
          game_minute: data.game_minute,
          game_second: data.game_second,
          sequence_number: await this.getNextSequenceNumber(matchId)
        });
      }
    } else if (!data.is_shooting_foul) {
      const bonusStatus = await foulService.getBonusStatus(matchId, data.team_id);
      if (bonusStatus.bonus_status === 'none') {
        await possessionService.handleDeadBallFoul(matchId, data.team_id, false, {
          homeTeamId: match.home_team_id,
          awayTeamId: match.away_team_id
        });
      }
    }

    await shotClockService.resetAfterDeadBall(matchId, {
      quarter: match.current_quarter,
      game_minute: data.game_minute,
      game_second: data.game_second
    });

    ws.emitToMatch(matchId, 'basketball:foul', {
      matchId,
      playerId: data.player_id,
      teamId: data.team_id,
      foulType: data.foul_type,
      isFouledOut: foulResult.isFouledOut,
      bonusStatus: foulResult.teamBonusInfo?.bonus_status,
      timestamp: new Date().toISOString()
    });

    return foulResult;
  }

  async handleTimeout(matchId, data) {
    return timeoutService.callTimeout(matchId, data.team_id, data.timeout_type, {
      minute: data.minute,
      second: data.second
    });
  }

  async createScoringEvent(matchId, organizationId, data) {
    const id = generateUUID();
    const sequenceNumber = await this.getNextSequenceNumber(matchId);

    const sql = `
      INSERT INTO scoring_events (
        id, match_id, organization_id, client_event_id, event_type, team_id, player_id,
        minute, metadata, is_reversed, created_by, created_at, sequence_number
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, FALSE, ?, NOW(), ?)
    `;

    await db.query(sql, [
      id,
      matchId,
      organizationId,
      data.client_event_id || generateUUID(),
      data.event_type,
      data.team_id,
      data.player_id,
      data.minute || 0,
      JSON.stringify(data.metadata || {}),
      data.created_by,
      sequenceNumber
    ]);

    return scoringEventRepository.findById(id);
  }

  async computeScore(matchId) {
    const match = await matchRepository.findById(matchId);
    const events = await scoringEventRepository.findByMatch(matchId, { includeReversed: false });

    let homeScore = 0;
    let awayScore = 0;

    for (const event of events) {
      if (event.event_type === BASKETBALL_EVENT_TYPES.FIELD_GOAL_MADE) {
        if (event.team_id === match.home_team_id) homeScore += 2;
        else awayScore += 2;
      } else if (event.event_type === BASKETBALL_EVENT_TYPES.THREE_POINTER_MADE) {
        if (event.team_id === match.home_team_id) homeScore += 3;
        else awayScore += 3;
      } else if (event.event_type === BASKETBALL_EVENT_TYPES.FREE_THROW_MADE) {
        if (event.team_id === match.home_team_id) homeScore += 1;
        else awayScore += 1;
      }
    }

    return { home: homeScore, away: awayScore };
  }

  async updatePlayerStats(matchId, playerId, teamId, stats) {
    await statisticsRepository.initializePlayerStats(matchId, playerId, teamId);
    return statisticsRepository.updatePlayerStats(matchId, playerId, stats);
  }

  async updateTeamStats(matchId, teamId, stats) {
    return statisticsRepository.updateTeamStats(matchId, teamId, stats);
  }

  async getNextSequenceNumber(matchId) {
    const maxSeq = await scoringEventRepository.getLatestSequenceNumber(matchId);
    return maxSeq + 1;
  }

  async getMatchStats(matchId) {
    const playerStats = await statisticsRepository.getAllPlayerStats(matchId);
    const teamStats = await statisticsRepository.getAllTeamStats(matchId);
    return { playerStats, teamStats };
  }
}

export default new BasketballScoringService();