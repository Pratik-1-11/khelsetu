import basketballScoringService from './services/basketballScoringService.js';
import basketballPeriodService from './services/basketballPeriodService.js';
import foulService from './services/foulService.js';
import shotClockService from './services/shotClockService.js';
import timeoutService from './services/timeoutService.js';
import freeThrowService from './services/freeThrowService.js';
import possessionService from './services/possessionService.js';
import statisticsRepository from './repositories/statisticsRepository.js';
import { NotFoundError, ValidationError } from '../../core/errors/index.js';

export class BasketballController {
  async initializeMatch(req, res) {
    try {
      const { matchId } = req.params;
      const result = await basketballScoringService.initializeMatch(matchId);
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async handleFieldGoal(req, res) {
    try {
      const { matchId } = req.params;
      const { team_id, player_id, is_three_pointer, shot_type, zone, distance, is_and_one, is_shooting_foul, fouling_team_id, fouled_player_id, created_by } = req.body;
      
      const result = await basketballScoringService.handleFieldGoal(matchId, {
        team_id,
        player_id,
        is_three_pointer: is_three_pointer || false,
        shot_type,
        zone,
        distance,
        is_and_one: is_and_one || false,
        is_shooting_foul: is_shooting_foul || false,
        fouling_team_id,
        fouled_player_id,
        created_by: req.user?.userId
      });
      
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async handleFreeThrow(req, res) {
    try {
      const { matchId } = req.params;
      const { team_id, player_id, made, sequence_id } = req.body;
      
      const result = await basketballScoringService.handleFreeThrow(matchId, {
        team_id,
        player_id,
        made,
        sequence_id,
        created_by: req.user?.userId
      });
      
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async handleRebound(req, res) {
    try {
      const { matchId } = req.params;
      const { team_id, player_id, rebound_type } = req.body;
      
      const result = await basketballScoringService.handleRebound(matchId, {
        team_id,
        player_id,
        rebound_type,
        created_by: req.user?.userId
      });
      
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async handleAssist(req, res) {
    try {
      const { matchId } = req.params;
      const { team_id, player_id, assisted_player_id } = req.body;
      
      const result = await basketballScoringService.handleAssist(matchId, {
        team_id,
        player_id,
        assisted_player_id,
        created_by: req.user?.userId
      });
      
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async handleSteal(req, res) {
    try {
      const { matchId } = req.params;
      const { team_id, player_id, stolen_from_player_id, stolen_from_team_id } = req.body;
      
      const result = await basketballScoringService.handleSteal(matchId, {
        team_id,
        player_id,
        stolen_from_player_id,
        stolen_from_team_id,
        created_by: req.user?.userId
      });
      
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async handleTurnover(req, res) {
    try {
      const { matchId } = req.params;
      const { team_id, player_id, turnover_type } = req.body;
      
      const result = await basketballScoringService.handleTurnover(matchId, {
        team_id,
        player_id,
        turnover_type,
        created_by: req.user?.userId
      });
      
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async handleBlock(req, res) {
    try {
      const { matchId } = req.params;
      const { team_id, player_id, blocked_player_id } = req.body;
      
      const result = await basketballScoringService.handleBlock(matchId, {
        team_id,
        player_id,
        blocked_player_id,
        created_by: req.user?.userId
      });
      
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async handleFoul(req, res) {
    try {
      const { matchId } = req.params;
      const { team_id, player_id, foul_type, fouled_player_id, fouled_team_id, is_shooting_foul, shot_type } = req.body;
      
      const result = await basketballScoringService.handleFoul(matchId, {
        team_id,
        player_id,
        foul_type,
        fouled_player_id,
        fouled_team_id,
        is_shooting_foul: is_shooting_foul || false,
        shot_type,
        created_by: req.user?.userId
      });
      
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async handleTimeout(req, res) {
    try {
      const { matchId } = req.params;
      const { team_id, timeout_type } = req.body;
      
      const result = await basketballScoringService.handleTimeout(matchId, {
        team_id,
        timeout_type: timeout_type || 'full'
      });
      
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async startPeriod(req, res) {
    try {
      const { matchId } = req.params;
      const { period_number } = req.body;
      
      const result = await basketballPeriodService.startPeriod(matchId, period_number);
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async endPeriod(req, res) {
    try {
      const { matchId } = req.params;
      const { period_number, injury_time } = req.body;
      
      const result = await basketballPeriodService.endPeriod(matchId, period_number, injury_time || 0);
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async startOvertime(req, res) {
    try {
      const { matchId } = req.params;
      const { overtime_number } = req.body;
      
      const result = await basketballPeriodService.startOvertime(matchId, overtime_number);
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async endMatch(req, res) {
    try {
      const { matchId } = req.params;
      const { winner_id } = req.body;
      
      const result = await basketballPeriodService.endMatch(matchId, winner_id);
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async getGameState(req, res) {
    try {
      const { matchId } = req.params;
      
      const match = await require('../../matches/repositories/matchRepository.js').default.findById(matchId);
      if (!match) throw new NotFoundError('Match not found');
      
      const possession = await possessionService.getPossession(matchId);
      const fouls = await foulService.getMatchFouls(matchId);
      const stats = await basketballScoringService.getMatchStats(matchId);
      const periods = await basketballPeriodService.getMatchPeriods(matchId);
      
      res.json({
        success: true,
        data: {
          match,
          possession,
          fouls,
          stats,
          periods,
          shotClock: match.shot_clock_seconds,
          gameClock: match.game_clock_seconds,
          quarter: match.current_quarter,
          overtimeCount: match.overtime_count
        }
      });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async getMatchStats(req, res) {
    try {
      const { matchId } = req.params;
      const result = await basketballScoringService.getMatchStats(matchId);
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async getTeamFouls(req, res) {
    try {
      const { matchId } = req.params;
      const { teamId } = req.params;
      
      const result = await foulService.getTeamFoulCount(matchId, teamId);
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async updateGameClock(req, res) {
    try {
      const { matchId } = req.params;
      const { clock_seconds } = req.body;
      
      const result = await basketballPeriodService.updateGameClock(matchId, clock_seconds);
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async setShotClock(req, res) {
    try {
      const { matchId } = req.params;
      const { seconds } = req.body;
      
      const result = await shotClockService.setShotClock(matchId, seconds, 'manual');
      res.json({ success: true, data: result });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }
}

export default new BasketballController();