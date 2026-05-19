import db from '../../../infrastructure/postgres/index.js';
import matchRepository from '../repositories/matchRepository.js';
import { NotFoundError, ValidationError, ConflictError } from '../../../core/errors/index.js';
import logger from '../../../core/logger/index.js';

const VALID_STATES = [
  'draft',
  'scheduled',
  'live',
  'halftime',
  'extra_time',
  'extra_time_first',
  'extra_time_second',
  'penalties',
  'completed',
  'abandoned',
  'suspended',
  'postponed',
  'cancelled'
];

const STATE_TRANSITIONS = {
  draft: ['scheduled', 'cancelled'],
  scheduled: ['live', 'postponed', 'cancelled'],
  live: ['halftime', 'abandoned', 'suspended'],
  halftime: ['live', 'abandoned', 'suspended', 'postponed'],
  extra_time: ['penalties', 'completed', 'abandoned', 'suspended'],
  penalties: ['completed', 'abandoned', 'suspended'],
  completed: [],
  abandoned: [],
  suspended: ['live', 'postponed', 'cancelled'],
  postponed: ['scheduled', 'cancelled'],
  cancelled: []
};

const PERIOD_STATE_TRANSITIONS = {
  pending: ['in_progress'],
  in_progress: ['completed', 'abandoned'],
  completed: [],
  abandoned: []
};

export class MatchStateValidationService {
  validateStateTransition(currentState, newState) {
    if (!VALID_STATES.includes(newState)) {
      throw new ValidationError(`Invalid state: ${newState}`);
    }

    const allowedTransitions = STATE_TRANSITIONS[currentState] || [];

    if (!allowedTransitions.includes(newState)) {
      throw new ValidationError(
        `Invalid state transition from '${currentState}' to '${newState}'. Allowed: ${allowedTransitions.join(', ')}`
      );
    }

    return { valid: true };
  }

  validatePeriodTransition(currentPeriod, newPeriod) {
    const allowedTransitions = PERIOD_STATE_TRANSITIONS[currentPeriod] || [];

    if (!allowedTransitions.includes(newPeriod)) {
      throw new ValidationError(
        `Invalid period transition from '${currentPeriod}' to '${newPeriod}'. Allowed: ${allowedTransitions.join(', ')}`
      );
    }

    return { valid: true };
  }

  async validateMatchForStart(matchId) {
    const match = await matchRepository.findById(matchId);
    if (!match) {
      throw new NotFoundError('Match not found');
    }

    const errors = [];

    if (!['scheduled', 'draft'].includes(match.status)) {
      errors.push(`Match status must be 'scheduled' or 'draft', currently '${match.status}'`);
    }

    if (!match.home_team_id || !match.away_team_id) {
      errors.push('Both home and away teams must be assigned');
    }

    if (!match.scheduled_at && !match.metadata?.start_time) {
      errors.push('Match must have a scheduled time');
    }

    const [homeLineup] = await db.query(
      `SELECT COUNT(*) as count FROM match_lineups WHERE match_id = ? AND team_id = ? AND is_starting = TRUE`,
      [matchId, match.home_team_id]
    );

    const [awayLineup] = await db.query(
      `SELECT COUNT(*) as count FROM match_lineups WHERE match_id = ? AND team_id = ? AND is_starting = TRUE`,
      [matchId, match.away_team_id]
    );

    if (homeLineup.count < 7) {
      errors.push(`Home team lineup must have at least 7 players (currently ${homeLineup.count})`);
    }

    if (awayLineup.count < 7) {
      errors.push(`Away team lineup must have at least 7 players (currently ${awayLineup.count})`);
    }

    if (match.tournament_id) {
      const [tournament] = await db.query('SELECT * FROM tournaments WHERE id = ?', [match.tournament_id]);
      if (tournament[0] && tournament[0].status !== 'in_progress') {
        errors.push('Tournament must be in progress');
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings: this.generateWarnings(match, homeLineup.count, awayLineup.count)
    };
  }

  generateWarnings(match, homeLineupCount, awayLineupCount) {
    const warnings = [];

    if (homeLineupCount < 11) {
      warnings.push(`Home team has only ${homeLineupCount} starting players (recommended: 11)`);
    }

    if (awayLineupCount < 11) {
      warnings.push(`Away team has only ${awayLineupCount} starting players (recommended: 11)`);
    }

    const [homeBench] = await db.query(
      `SELECT COUNT(*) as count FROM match_lineups WHERE match_id = ? AND team_id = ? AND is_on_bench = TRUE`,
      [match.id, match.home_team_id]
    );

    const [awayBench] = await db.query(
      `SELECT COUNT(*) as count FROM match_lineups WHERE match_id = ? AND team_id = ? AND is_on_bench = TRUE`,
      [match.id, match.away_team_id]
    );

    if (homeBench.count < 3) {
      warnings.push(`Home team has only ${homeBench.count} substitutes (recommended: 3+)`);
    }

    if (awayBench.count < 3) {
      warnings.push(`Away team has only ${awayBench.count} substitutes (recommended: 3+)`);
    }

    return warnings;
  }

  async validateMatchForEnd(matchId) {
    const match = await matchRepository.findById(matchId);
    if (!match) {
      throw new NotFoundError('Match not found');
    }

    const errors = [];

    if (!['live', 'halftime', 'extra_time', 'penalties'].includes(match.status)) {
      errors.push(`Match must be in progress to end. Current status: '${match.status}'`);
    }

    const [activePeriods] = await db.query(
      `SELECT COUNT(*) as count FROM match_periods WHERE match_id = ? AND status = 'in_progress'`,
      [matchId]
    );

    if (activePeriods.count > 0) {
      errors.push('Cannot end match while a period is in progress');
    }

    if (match.home_score === null || match.away_score === null) {
      errors.push('Match scores must be recorded');
    }

    const activeVarReviews = await db.query(
      `SELECT COUNT(*) as count FROM var_reviews WHERE match_id = ? AND status != 'completed'`,
      [matchId]
    );

    if (activeVarReviews[0].count > 0) {
      errors.push('Cannot end match while VAR review is in progress');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  async validatePeriodTransition(matchId, action) {
    const match = await matchRepository.findById(matchId);
    if (!match) {
      throw new NotFoundError('Match not found');
    }

    const [periods] = await db.query(
      `SELECT * FROM match_periods WHERE match_id = ? ORDER BY period_number DESC LIMIT 2`,
      [matchId]
    );

    const currentPeriod = periods[0];
    const previousPeriod = periods[1];

    const validActions = {
      first_half: ['end_first_half', 'abandon', 'suspend'],
      halftime: ['start_second_half', 'abandon', 'postpone'],
      second_half: ['end_second_half', 'start_extra_time', 'abandon', 'suspend'],
      extra_time_first: ['end_extra_time_first', 'start_extra_time_second', 'abandon'],
      extra_time_second: ['end_extra_time', 'start_penalties', 'abandon'],
      penalties: ['end_match', 'abandon']
    };

    const allowedActions = validActions[currentPeriod?.period_type] || [];

    if (!allowedActions.includes(action)) {
      throw new ValidationError(
        `Cannot perform '${action}' during '${currentPeriod?.period_type || 'no period'}'`
      );
    }

    return { valid: true, currentPeriod, previousPeriod };
  }

  async validateEventTiming(matchId, eventType, minute, periodType) {
    const match = await matchRepository.findById(matchId);
    if (!match) {
      throw new NotFoundError('Match not found');
    }

    const [activePeriod] = await db.query(
      `SELECT * FROM match_periods WHERE match_id = ? AND status = 'in_progress' ORDER BY period_number DESC LIMIT 1`,
      [matchId]
    );

    const currentPeriod = activePeriod[0]?.period_type || match.status;

    const maxMinutes = {
      first_half: 45,
      halftime: 0,
      second_half: 90,
      extra_time_first: 105,
      extra_time_second: 120,
      penalties: 130
    };

    const maxMinute = maxMinutes[currentPeriod] || 120;
    const effectiveMinute = minute + (activePeriod[0]?.injury_time_minutes || 0);

    if (effectiveMinute > maxMinute) {
      throw new ValidationError(
        `Minute ${effectiveMinute} exceeds maximum ${maxMinute} for ${currentPeriod}`
      );
    }

    const validEventTypesForPeriod = {
      first_half: ['goal', 'penalty', 'own_goal', 'yellow_card', 'red_card', 'substitution', 'var_decision'],
      halftime: [],
      second_half: ['goal', 'penalty', 'own_goal', 'yellow_card', 'red_card', 'substitution', 'var_decision', 'injury'],
      extra_time_first: ['goal', 'penalty', 'substitution'],
      extra_time_second: ['goal', 'penalty', 'substitution'],
      penalties: ['goal', 'penalty', 'saved', 'missed']
    };

    const allowedEvents = validEventTypesForPeriod[currentPeriod] || [];

    if (!allowedEvents.includes(eventType)) {
      logger.warn('Event type not typical for period', { eventType, period: currentPeriod });
    }

    return { valid: true, currentPeriod, effectiveMinute };
  }

  validateKnockoutExtraTimeRequirements(match) {
    if (!match.metadata?.is_knockout) {
      return { valid: true };
    }

    if (match.home_score !== match.away_score) {
      return { valid: true };
    }

    if (match.status === 'second_half') {
      return { valid: true };
    }

    if (match.status !== 'extra_time' && match.status !== 'penalties') {
      return { requiresExtraTime: true };
    }

    return { valid: true };
  }

  validatePenaltyShootoutRequirements(match) {
    if (match.status !== 'penalties') {
      return { valid: true };
    }

    if (match.home_score === match.away_score) {
      return { valid: true };
    }

    return {
      valid: false,
      error: 'Penalty shootout requires tied scores'
    };
  }

  async getMatchStateValidation(matchId) {
    const match = await matchRepository.findById(matchId);
    if (!match) {
      throw new NotFoundError('Match not found');
    }

    const [periods] = await db.query(
      `SELECT * FROM match_periods WHERE match_id = ? ORDER BY period_number`,
      [matchId]
    );

    const [scoringEvents] = await db.query(
      `SELECT COUNT(*) as count, 
         SUM(CASE WHEN event_type = 'goal' THEN 1 ELSE 0 END) as goals,
         SUM(CASE WHEN event_type = 'yellow_card' THEN 1 ELSE 0 END) as yellows,
         SUM(CASE WHEN event_type = 'red_card' THEN 1 ELSE 0 END) as reds
       FROM scoring_events WHERE match_id = ? AND is_reversed = FALSE`,
      [matchId]
    );

    const [substitutions] = await db.query(
      `SELECT COUNT(*) as count FROM substitution_events WHERE match_id = ?`,
      [matchId]
    );

    const [varReviews] = await db.query(
      `SELECT COUNT(*) as count FROM var_reviews WHERE match_id = ? AND status != 'completed'`,
      [matchId]
    );

    return {
      match: {
        id: match.id,
        status: match.status,
        homeScore: match.home_score,
        awayScore: match.away_score,
        startedAt: match.started_at,
        endedAt: match.ended_at
      },
      periods: {
        current: periods.find(p => p.status === 'in_progress') || null,
        completed: periods.filter(p => p.status === 'completed'),
        all: periods
      },
      events: {
        total: scoringEvents[0].count,
        goals: scoringEvents[0].goals,
        yellowCards: scoringEvents[0].yellows,
        redCards: scoringEvents[0].reds,
        substitutions: substitutions[0].count
      },
      activeVarReviews: varReviews[0].count,
      canEndMatch: ['live', 'halftime', 'extra_time', 'penalties'].includes(match.status),
      canAddEvents: ['live'].includes(match.status)
    };
  }
}

export default new MatchStateValidationService();