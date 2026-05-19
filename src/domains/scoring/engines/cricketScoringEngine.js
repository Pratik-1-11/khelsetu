/**
 * Production-Grade Cricket Scoring Engine
 * ICC-Compliant Event-Driven Architecture
 * Supports: T20, ODI, Test, T10 formats
 */

import BaseScoringEngine from './baseScoringEngine.js';
import db from '../../../infrastructure/postgres/index.js';
import { generateUUID } from '../../../core/utils/index.js';

export const CRICKET_DELIVERY_TYPES = {
  LEGAL: 'legal',
  NO_BALL: 'no_ball',
  WIDE: 'wide'
};

export const CRICKET_WICKET_TYPES = {
  NONE: 'none',
  BOWLED: 'bowled',
  CAUGHT: 'caught',
  CAUGHT_BEHIND: 'caught_behind',
  LBW: 'lbw',
  STUMPED: 'stumped',
  RUN_OUT: 'run_out',
  HIT_WICKET: 'hit_wicket',
  OBSTRUCTING_FIELD: 'obstructing_field',
  TIMED_OUT: 'timed_out',
  RETIRED_HURT: 'retired_hurt',
  RETIRED_OUT: 'retired_out',
  HANDLED_BALL: 'handled_ball'
};

export const RUNS_CLASSIFICATION = {
  DOT: 'dot',
  SINGLE: 'single',
  DOUBLE: 'double',
  TRIPLE: 'triple',
  FOUR: 'four',
  SIX: 'six',
  BOUNDARY_FOUR: 'boundary_four',
  BOUNDARY_SIX: 'boundary_six'
};

export const POWERPLAY_TYPES = {
  MANDATORY: 'mandatory',
  STRATEGIC: 'strategic',
  NON_POWERPLAY: 'non_powerplay'
};

export const REVIEW_TYPES = {
  LBW: 'lbw',
  CAUGHT: 'caught',
  CAUGHT_BEHIND: 'caught_behind',
  STUMPED: 'stumped',
  BOWLED: 'bowled',
  RUN_OUT: 'run_out',
  NOT_OUT: 'not_out'
};

export const REVIEW_DECISIONS = {
  NOT_OUT: 'not_out',
  OUT: 'out',
  WITHDRAWN: 'withdrawn',
  LOST: 'lost'
};

export const SUPER_OVER_STATUS = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  ABANDONED: 'abandoned'
};

export const ANALYTICS_PHASE = {
  POWERPLAY: 'powerplay',
  MIDDLE: 'middle',
  DEATH: 'death',
  OVERALL: 'overall'
};

export class CricketScoringEngine extends BaseScoringEngine {
  constructor(sportConfig) {
    super(sportConfig);
    this.format = this.rules.format || 'T20';
    this.overs = this.rules.overs || 20;
    this.maxBalls = this.overs * 6;
    this.powerplayConfig = null;

    this.formatConfig = {
      T20: { maxOvers: 20, powerplayMandatory: 6, powerplayStrategic: 0, deathOversStart: 16 },
      ODI: { maxOvers: 50, powerplayMandatory: 10, powerplayStrategic: 30, deathOversStart: 41 },
      TEST: { maxOvers: 90, powerplayMandatory: 15, powerplayStrategic: 65, deathOversStart: 81 },
      T10: { maxOvers: 10, powerplayMandatory: 4, powerplayStrategic: 0, deathOversStart: 7 }
    };
  }

  async loadPowerplayConfig(matchId = null) {
    const connection = await db.getConnection();
    try {
      const [configs] = matchId
        ? await connection.query(
            `SELECT * FROM cricket_powerplay_configs WHERE format = ?`,
            [this.format]
          )
        : await connection.query(
            `SELECT * FROM cricket_powerplay_configs WHERE format = ?`,
            [this.format]
          );

      if (configs.length > 0) {
        this.powerplayConfig = configs.reduce((acc, config) => {
          acc[config.powerplay_type] = {
            start: config.start_over,
            end: config.end_over
          };
          return acc;
        }, {});
      } else {
        this.powerplayConfig = this.getDefaultPowerplayConfig();
      }
      return this.powerplayConfig;
    } finally {
      connection.release();
    }
  }

  getDefaultPowerplayConfig() {
    const config = this.formatConfig[this.format];
    return {
      mandatory: { start: 1, end: config.powerplayMandatory },
      strategic: config.powerplayStrategic > 0
        ? { start: config.powerplayMandatory + 1, end: config.powerplayMandatory + config.powerplayStrategic }
        : null
    };
  }

  /**
   * VALIDATION ENGINE - Comprehensive cricket rule validation
   */
  validateEvent(eventType, eventData) {
    const errors = [];
    const warnings = [];

    if (!eventData.delivery_type) {
      errors.push('delivery_type is required (legal, no_ball, wide)');
    }

    if (eventData.delivery_type === 'no_ball' || eventData.delivery_type === 'wide') {
      if (eventData.wicket && eventData.wicket_type === 'stumped') {
        errors.push('Cannot be stumped on no-ball or wide - not a legal delivery for stumping');
      }

      if (eventData.wicket && eventData.wicket_type === 'caught_behind') {
        errors.push('Cannot be caught behind on no-ball - no extra ball count');
      }
    }

    if (eventData.wicket && eventData.wicket_type === 'run_out') {
      if (!eventData.run_out_completed) {
        warnings.push('Run-out not completed - check if batter made ground');
      }
    }

    if (eventData.is_free_hit && eventData.wicket && eventData.wicket_type !== 'run_out') {
      errors.push('Wicket on free-hit only allowed if run-out');
    }

    if (eventData.wicket && eventData.wicket_type === 'handled_ball' && !eventData.batter_elected) {
      errors.push('Handled ball requires batter to elect');
    }

    if (eventData.batter_runs > 6 && eventData.batter_runs !== eventData.total_runs - eventData.extra_runs - eventData.overthrow_runs) {
      warnings.push('Check runs calculation - boundary + runs');
    }

    if (eventData.ball_in_over < 1 || eventData.ball_in_over > 7) {
      errors.push(`Invalid ball in over: ${eventData.ball_in_over}`);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * DETERMINISTIC STATE REDUCER - Core scoring logic
   * CRITICAL: Must be pure function - same input = same output
   * CRITICAL: Never mutate, always return new state
   */
  reduceMatchState(state, delivery) {
    if (delivery.is_reversed) {
      return this.revertState(state, delivery);
    }

    const newState = {
      ...state,
      totalRuns: state.totalRuns + delivery.total_runs,
      ballsBowled: state.ballsBowled + (delivery.delivery_type === 'legal' ? 1 : 0),
      extraBalls: state.extraBalls + (delivery.delivery_type !== 'legal' ? 1 : 0)
    };

    if (delivery.wicket) {
      newState.wicketsFallen = state.wicketsFallen + 1;
      newState.dismissals = [...state.dismissals, {
        type: delivery.wicket_type,
        batter: delivery.striker_id,
        bowler: delivery.bowler_id,
        fielder: delivery.fielder_id,
        ball: delivery.sequence_number
      }];
    }

    newState.overs = this.calculateOvers(newState.ballsBowled);
    newState.runRate = this.calculateRunRate(newState.totalRuns, newState.ballsBowled);

    newState.striker = this.updateStriker(state.striker, delivery);
    newState.nonStriker = this.updateNonStriker(state.nonStriker, delivery);
    newState.partnership = this.updatePartnership(state.partnership, delivery);
    newState.bowler = this.updateBowler(state.bowler, delivery);
    newState.powerplay = this.updatePowerplay(state.powerplay, delivery);
    newState.requiredRunRate = this.calculateRequiredRunRate(state);

    return newState;
  }

  /**
   * SCORE CALCULATION - Comprehensive run tracking
   */
  calculateScore(deliveryEvents) {
    const validEvents = deliveryEvents.filter(e => !e.is_reversed);

    let stats = {
      total_runs: 0,
      batter_runs: 0,
      extras: {
        no_balls: 0,
        wides: 0,
        byes: 0,
        leg_byes: 0,
        penalty: 0,
        overthrow: 0,
        total: 0
      },
      wickets: 0,
      overs: '0.0',
      balls: 0,
      runs_from_boundaries: 0,
      runs_from_singles: 0,
      runs_from_doubles: 0,
      runs_from_triples: 0
    };

    for (const event of validEvents) {
      stats.total_runs += event.total_runs || 0;
      stats.batter_runs += event.batter_runs || 0;

      if (event.is_no_ball) {
        stats.extras.no_balls += 1;
        stats.extras.no_ball_runs = (stats.extras.no_ball_runs || 0) + (event.batter_runs || 0) + 1;
        stats.extras.total += 1 + (event.batter_runs || 0);
      }

      if (event.is_wide) {
        stats.extras.wides += 1;
        stats.extras.wide_runs = (stats.extras.wide_runs || 0) + (event.runs_from_delivery || 0) + 1;
        stats.extras.total += 1 + (event.runs_from_delivery || 0);
      }

      if (event.is_bye) {
        stats.extras.byes += (event.bye_runs || 0);
        stats.extras.total += event.bye_runs || 0;
      }

      if (event.is_leg_bye) {
        stats.extras.leg_byes += (event.leg_bye_runs || 0);
        stats.extras.total += event.leg_bye_runs || 0;
      }

      if (event.penalty_runs) {
        stats.extras.penalty += event.penalty_runs;
        stats.extras.total += event.penalty_runs;
      }

      if (event.is_overthrow) {
        stats.extras.overthrow += event.overthrow_runs || 0;
        stats.extras.total += event.overthrow_runs || 0;
      }

      if (event.wicket) stats.wickets++;

      if (event.delivery_type === 'legal') {
        stats.balls++;

        if (event.runs_from_delivery === 'four' || event.runs_from_delivery === 'boundary_four') {
          stats.runs_from_boundaries += 4;
        } else if (event.runs_from_delivery === 'six' || event.runs_from_delivery === 'boundary_six') {
          stats.runs_from_boundaries += 6;
        } else if (event.runs_from_delivery === 'single') {
          stats.runs_from_singles += 1;
        } else if (event.runs_from_delivery === 'double') {
          stats.runs_from_doubles += 2;
        }
      }
    }

    stats.overs = this.calculateOvers(stats.balls);
    stats.extras.total = stats.extras.no_ball_runs + stats.extras.wide_runs + stats.extras.byes +
                         stats.extras.leg_byes + stats.extras.penalty + stats.extras.overthrow;

    return stats;
  }

  /**
   * OVER PROGRESSION - Correct calculation
   * 6 legal deliveries = 1 over
   * NO_BALL and WIDE don't count as legal balls
   */
  calculateOvers(legalBalls) {
    const overs = Math.floor(legalBalls / 6);
    const balls = legalBalls % 6;
    return parseFloat(`${overs}.${balls}`);
  }

  /**
   * STRIKER ROTATION LOGIC
   * Strike rotates on ODD runs
   * Strike stays on EVEN runs or NO RUNS
   */
  updateStriker(currentStriker, delivery) {
    if (!currentStriker) return currentStriker;

    const runs = delivery.total_runs;

    if (delivery.wicket && delivery.striker_id === currentStriker.id) {
      return { ...currentStriker, is_on_strike: false, is_out: true };
    }

    if (delivery.striker_id !== currentStriker.id) {
      return { ...currentStriker, is_on_strike: false };
    }

    if (delivery.strike_rotated) {
      return {
        ...currentStriker,
        runs: currentStriker.runs + (delivery.batter_runs || 0),
        balls: currentStriker.balls + (delivery.delivery_type === 'legal' ? 1 : 0),
        is_on_strike: false
      };
    }

    return {
      ...currentStriker,
      runs: currentStriker.runs + (delivery.batter_runs || 0),
      balls: currentStriker.balls + (delivery.delivery_type === 'legal' ? 1 : 0),
      fours: currentStriker.fours + ((delivery.runs_from_delivery === 'four' || delivery.runs_from_delivery === 'boundary_four') ? 1 : 0),
      sixes: currentStriker.sixes + ((delivery.runs_from_delivery === 'six' || delivery.runs_from_delivery === 'boundary_six') ? 1 : 0),
      strike_rate: this.calculateStrikeRate(
        currentStriker.runs + (delivery.batter_runs || 0),
        currentStriker.balls + (delivery.delivery_type === 'legal' ? 1 : 0)
      )
    };
  }

  updateNonStriker(currentNonStriker, delivery) {
    if (!currentNonStriker) return currentNonStriker;

    if (delivery.striker_id === currentNonStriker.id) {
      return {
        ...currentNonStriker,
        runs: currentNonStriker.runs + (delivery.batter_runs || 0),
        balls: currentNonStriker.balls + (delivery.delivery_type === 'legal' ? 1 : 0),
        is_on_strike: true
      };
    }

    return currentNonStriker;
  }

  /**
   * PARTNERSHIP TRACKING
   */
  updatePartnership(currentPartnership, delivery) {
    const newRuns = (delivery.total_runs || 0) - (delivery.penalty_runs || 0);
    const legalBall = delivery.delivery_type === 'legal';

    if (!currentPartnership) {
      return {
        runs: newRuns,
        balls: legalBall ? 1 : 0,
        fours: (delivery.runs_from_delivery === 'four' || delivery.runs_from_delivery === 'boundary_four') ? 1 : 0,
        sixes: (delivery.runs_from_delivery === 'six' || delivery.runs_from_delivery === 'boundary_six') ? 1 : 0
      };
    }

    return {
      runs: currentPartnership.runs + newRuns,
      balls: currentPartnership.balls + (legalBall ? 1 : 0),
      fours: currentPartnership.fours + ((delivery.runs_from_delivery === 'four' || delivery.runs_from_delivery === 'boundary_four') ? 1 : 0),
      sixes: currentPartnership.sixes + ((delivery.runs_from_delivery === 'six' || delivery.runs_from_delivery === 'boundary_six') ? 1 : 0)
    };
  }

  /**
   * BOWLER STATISTICS
   */
  updateBowler(currentBowler, delivery) {
    if (!currentBowler) return currentBowler;

    const legalBall = delivery.delivery_type === 'legal';
    const isNoBall = delivery.delivery_type === 'no_ball';
    const isWide = delivery.delivery_type === 'wide';

    let newBowler = { ...currentBowler };

    if (legalBall) {
      newBowler.legal_balls++;
      newBowler.overs = this.calculateOvers(newBowler.legal_balls);
    }

    if (isNoBall) {
      newBowler.no_balls++;
      newBowler.runs_conceded += (delivery.batter_runs || 0) + 1;
    } else if (isWide) {
      newBowler.wides++;
      newBowler.runs_conceded += (delivery.runs_from_delivery || 0) + 1;
    } else {
      newBowler.runs_conceded += (delivery.batter_runs || 0);
    }

    if (delivery.wicket) {
      newBowler.wickets++;
    }

    newBowler.economy_rate = newBowler.overs > 0
      ? (newBowler.runs_conceded / newBowler.overs).toFixed(2)
      : 0;

    if ((delivery.runs_from_delivery === 'four' || delivery.runs_from_delivery === 'boundary_four')) {
      newBowler.boundary_fours++;
    }
    if ((delivery.runs_from_delivery === 'six' || delivery.runs_from_delivery === 'boundary_six')) {
      newBowler.boundary_sixes++;
    }
    if (delivery.runs_from_delivery === 'dot') {
      newBowler.dot_balls++;
    }

    return newBowler;
  }

  /**
   * POWERPLAY LOGIC - Uses DB config or falls back to defaults
   */
  getPowerplayTypeForOver(overNumber) {
    const config = this.powerplayConfig || this.getDefaultPowerplayConfig();

    if (config.mandatory && overNumber >= config.mandatory.start && overNumber <= config.mandatory.end) {
      return POWERPLAY_TYPES.MANDATORY;
    }
    if (config.strategic && overNumber >= config.strategic.start && overNumber <= config.strategic.end) {
      return POWERPLAY_TYPES.STRATEGIC;
    }
    return POWERPLAY_TYPES.NON_POWERPLAY;
  }

  isPowerplayOver(overNumber) {
    const type = this.getPowerplayTypeForOver(overNumber);
    return type === POWERPLAY_TYPES.MANDATORY || type === POWERPLAY_TYPES.STRATEGIC;
  }

  isDeathOver(overNumber) {
    const config = this.formatConfig[this.format];
    return overNumber >= (config.deathOversStart || this.overs - 4);
  }

  updatePowerplay(currentPowerplay, delivery) {
    const overNumber = delivery.over_number;
    const config = this.powerplayConfig || this.getDefaultPowerplayConfig();

    const mandatoryEnd = config.mandatory ? config.mandatory.end : this.formatConfig[this.format].powerplayMandatory;
    const strategicEnd = config.strategic
      ? config.strategic.end
      : this.formatConfig[this.format].powerplayMandatory + this.formatConfig[this.format].powerplayStrategic;

    if (!currentPowerplay) {
      let type = POWERPLAY_TYPES.NON_POWERPLAY;

      if (overNumber <= mandatoryEnd) {
        type = POWERPLAY_TYPES.MANDATORY;
      } else if (overNumber <= strategicEnd) {
        type = POWERPLAY_TYPES.STRATEGIC;
      }

      return {
        type,
        overs_completed: overNumber <= strategicEnd ? 1 : 0,
        runs: delivery.total_runs || 0,
        wickets: delivery.wicket ? 1 : 0
      };
    }

    let newType = currentPowerplay.type;

    if (currentPowerplay.type === POWERPLAY_TYPES.MANDATORY && overNumber > mandatoryEnd) {
      newType = POWERPLAY_TYPES.STRATEGIC;
    } else if (currentPowerplay.type === POWERPLAY_TYPES.STRATEGIC && overNumber > strategicEnd) {
      newType = POWERPLAY_TYPES.NON_POWERPLAY;
    }

    return {
      type: newType,
      overs_completed: currentPowerplay.overs_completed + (overNumber <= strategicEnd ? 1 : 0),
      runs: currentPowerplay.runs + (delivery.total_runs || 0),
      wickets: currentPowerplay.wickets + (delivery.wicket ? 1 : 0)
    };
  }

  /**
   * REQUIRED RUN RATE CALCULATION
   */
  calculateRequiredRunRate(state) {
    if (!state.target_runs || !state.overs_bowled) return 0;

    const totalOvers = this.formatConfig[this.format]?.maxOvers || 20;
    const oversRemaining = totalOvers - state.overs_bowled;

    if (oversRemaining <= 0) return 0;

    const runsNeeded = state.target_runs - state.totalRuns;
    return (runsNeeded / oversRemaining).toFixed(2);
  }

  calculateRunRate(runs, balls) {
    if (balls === 0) return 0;
    const overs = balls / 6;
    return (runs / overs).toFixed(2);
  }

  calculateStrikeRate(runs, balls) {
    if (balls === 0) return 0;
    return ((runs / balls) * 100).toFixed(2);
  }

  /**
   * ENHANCED DLS CALCULATION (DLS-S) - Considers wickets lost
   * Uses 2-dimensional lookup: overs_remaining + wickets_lost
   */
  async calculateDLS(target, oversRemaining, wicketsLost = 0, format = 'T20') {
    const connection = await db.getConnection();
    try {
      const [resourceRow] = await connection.query(
        `SELECT resource_percentage FROM cricket_dls_wicket_resources
         WHERE overs_remaining <= ? AND wickets_lost = ?
         ORDER BY overs_remaining DESC LIMIT 1`,
        [oversRemaining, wicketsLost]
      );

      if (!resourceRow.length || target <= 0) return 0;

      const resource = resourceRow[0].resource_percentage / 100;
      return Math.ceil(target * resource);
    } finally {
      connection.release();
    }
  }

  /**
   * Legacy DLS for backward compatibility
   */
  async calculateLegacyDLS(target, oversRemaining, format = 'T20') {
    const connection = await db.getConnection();
    try {
      const [resourceRow] = await connection.query(
        `SELECT resource_percentage FROM cricket_dls_schedules
         WHERE overs_remaining <= ? ORDER BY overs_remaining DESC LIMIT 1`,
        [oversRemaining]
      );

      if (!resourceRow.length || target <= 0) return 0;

      const resource = resourceRow[0].resource_percentage / 100;
      return Math.ceil(target * resource);
    } finally {
      connection.release();
    }
  }

  /**
   * Calculate DLS Target for Second Innings
   */
  async calculateDLSTarget(firstInningsTotal, firstInningsOvers, firstInningsWickets, secondInningsOversRemaining) {
    const firstInningsResource = await this.calculateLegacyDLS(100, firstInningsOvers);
    const secondInningsResource = await this.calculateLegacyDLS(100, secondInningsOversRemaining);

    if (firstInningsResource === 0) return 0;

    const resourceRatio = secondInningsResource / firstInningsResource;
    return Math.ceil(firstInningsTotal * resourceRatio);
  }

  /**
   * INNINGS TRANSITION
   */
  handleInningsTransition(firstInnings, secondInnings) {
    const result = {
      matchResult: null,
      winner: null,
      margin: null,
      method: null
    };

    if (secondInnings.wicketsFallen === 10 || secondInnings.ballsBowled >= this.formatConfig[this.format].maxOvers * 6) {
      if (secondInnings.totalRuns > firstInnings.totalRuns) {
        result.matchResult = 'chasing_team_wins';
        result.winner = 'batting_second';
        result.margin = `${secondInnings.totalRuns - firstInnings.totalRuns} wickets`;
      } else if (secondInnings.totalRuns < firstInnings.totalRuns) {
        result.matchResult = 'defending_team_wins';
        result.winner = 'batting_first';
        result.margin = `${firstInnings.totalRuns - secondInnings.totalRuns} runs`;
      } else {
        result.matchResult = 'tie';
        result.method = 'super_over';
      }
    }

    return result;
  }

  /**
   * WINNER DETERMINATION
   */
  determineWinner(homeInnings, awayInnings) {
    if (!homeInnings || !awayInnings) return 'pending';

    if (homeInnings.total_runs > awayInnings.total_runs) return 'home';
    if (awayInnings.total_runs > homeInnings.total_runs) return 'away';

    if (homeInnings.wickets > awayInnings.wickets) return 'home';
    if (awayInnings.wickets > homeInnings.wickets) return 'away';

    if (homeInnings.run_rate > awayInnings.run_rate) return 'home';
    if (awayInnings.run_rate > homeInnings.run_rate) return 'away';

    return 'draw';
  }

  /**
   * VALIDATE DELIVERY SEQUENCE - Deterministic replay check
   */
  validateSequence(deliveryEvents) {
    const sorted = [...deliveryEvents].sort((a, b) => a.sequence_number - b.sequence_number);

    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].sequence_number <= sorted[i - 1].sequence_number) {
        return { valid: false, error: `Sequence error at position ${i}` };
      }
    }

    return { valid: true };
  }

  /**
   * DETERMINISTIC REPLAY TEST
   * Returns true if replay produces same result as live scoring
   */
  async testDeterministicReplay(matchId) {
    const connection = await db.getConnection();
    try {
      const [deliveries] = await connection.query(
        `SELECT * FROM cricket_deliveries
         WHERE match_id = ? AND is_reversed = FALSE
         ORDER BY sequence_number ASC`,
        [matchId]
      );

      let state = this.getInitialState();
      const liveState = { ...state };

      for (const delivery of deliveries) {
        state = this.reduceMatchState(state, delivery);
      }

      const [currentStats] = await connection.query(
        `SELECT total_runs, wickets_fallen, overs_bowled FROM cricket_innings
         WHERE match_id = ? ORDER BY innings_number LIMIT 1`,
        [matchId]
      );

      return {
        replayResult: state,
        liveResult: currentStats[0],
        isMatch: state.totalRuns === currentStats[0]?.total_runs &&
                 state.wicketsFallen === currentStats[0]?.wickets_fallen
      };
    } finally {
      connection.release();
    }
  }

  getInitialState() {
    return {
      totalRuns: 0,
      wicketsFallen: 0,
      ballsBowled: 0,
      extraBalls: 0,
      overs: 0,
      runRate: 0,
      targetRuns: null,
      requiredRunRate: 0,
      striker: null,
      nonStriker: null,
      partnership: null,
      bowler: null,
      powerplay: null,
      dismissals: [],
      extras: {
        no_balls: 0,
        wides: 0,
        byes: 0,
        leg_byes: 0,
        penalty: 0,
        total: 0
      }
    };
  }

  /**
   * OVER STATISTICS
   */
  calculateOverStats(events, overNumber) {
    const overEvents = events.filter(e => e.over_number === overNumber && !e.is_reversed);

    const stats = {
      over_number: overNumber,
      balls: 0,
      runs: 0,
      wickets: 0,
      maidens: 0,
      no_balls: 0,
      wides: 0,
      dot_balls: 0,
      fours: 0,
      sixes: 0
    };

    for (const event of overEvents) {
      if (event.delivery_type === 'legal') stats.balls++;
      if (event.delivery_type === 'no_ball') stats.no_balls++;
      if (event.delivery_type === 'wide') stats.wides++;

      stats.runs += event.total_runs || 0;

      if (event.wicket) stats.wickets++;
      if (event.runs_from_delivery === 'dot') stats.dot_balls++;
      if (event.runs_from_delivery === 'four' || event.runs_from_delivery === 'boundary_four') stats.fours++;
      if (event.runs_from_delivery === 'six' || event.runs_from_delivery === 'boundary_six') stats.sixes++;
    }

    if (stats.runs === 0 && stats.balls === 6) {
      stats.maidens = 1;
    }

    return stats;
  }

  /**
   * BOWLER SPELL MANAGEMENT
   */
  calculateBowlerSpell(bowlerDeliveries) {
    const validDeliveries = bowlerDeliveries.filter(d => !d.is_reversed);
    let spell = {
      overs: 0,
      maidens: 0,
      runs: 0,
      wickets: 0,
      no_balls: 0,
      wides: 0,
      economy: 0,
      dot_balls: 0,
      fours: 0,
      sixes: 0
    };

    for (const delivery of validDeliveries) {
      if (delivery.delivery_type === 'legal') {
        spell.overs++;
      } else if (delivery.delivery_type === 'no_ball') {
        spell.no_balls++;
        spell.runs += (delivery.batter_runs || 0) + 1;
      } else if (delivery.delivery_type === 'wide') {
        spell.wides++;
        spell.runs += (delivery.runs_from_delivery || 0) + 1;
      }

      if (delivery.wicket) spell.wickets++;
      if (delivery.runs_from_delivery === 'dot') spell.dot_balls++;
      if (delivery.runs_from_delivery === 'four' || delivery.runs_from_delivery === 'boundary_four') spell.fours++;
      if (delivery.runs_from_delivery === 'six' || delivery.runs_from_delivery === 'boundary_six') spell.sixes++;
    }

    spell.overs = this.calculateOvers(spell.overs - spell.no_balls);
    spell.economy = spell.overs > 0 ? (spell.runs / spell.overs).toFixed(2) : 0;

    return spell;
  }

  /**
   * PARTNERSHIP BREAKS
   */
  identifyPartnershipBreaks(deliveries) {
    const partnerships = [];
    let currentPartnership = null;

    const sorted = [...deliveries].sort((a, b) => a.sequence_number - b.sequence_number);

    for (const delivery of sorted) {
      if (delivery.is_reversed) continue;

      if (!currentPartnership) {
        currentPartnership = {
          batsman1: delivery.striker_id,
          batsman2: delivery.non_striker_id,
          runs: 0,
          balls: 0,
          start_over: delivery.over_number
        };
      }

      const totalRuns = (delivery.batter_runs || 0) +
                       (delivery.is_no_ball ? 1 : 0) +
                       (delivery.is_wide ? 1 : 0) +
                       (delivery.runs_from_delivery || 0);

      currentPartnership.runs += totalRuns;
      currentPartnership.balls += delivery.delivery_type === 'legal' ? 1 : 0;

      if (delivery.wicket &&
          (delivery.striker_id === currentPartnership.batsman1 ||
           delivery.striker_id === currentPartnership.batsman2)) {
        currentPartnership.end_over = delivery.over_number;
        currentPartnership.wicket_type = delivery.wicket_type;
        partnerships.push(currentPartnership);
        currentPartnership = null;
      }

      if (delivery.strike_rotated) {
        const temp = currentPartnership.batsman1;
        currentPartnership.batsman1 = currentPartnership.batsman2;
        currentPartnership.batsman2 = temp;
      }
    }

    if (currentPartnership && currentPartnership.runs > 0) {
      partnerships.push(currentPartnership);
    }

    return partnerships;
  }

  getPeriodConfig() {
    return {
      format: this.format,
      overs: this.overs,
      max_balls: this.maxBalls,
      powerplay_mandatory: this.formatConfig[this.format]?.powerplayMandatory || 6,
      powerplay_strategic: this.formatConfig[this.format]?.powerplayStrategic || 0,
      death_overs_start: this.formatConfig[this.format]?.deathOversStart || this.overs - 4
    };
  }

  /**
   * CALCULATE ENHANCED ANALYTICS
   */
  calculatePhaseStats(deliveries, phase) {
    const validDeliveries = deliveries.filter(d => !d.is_reversed);
    const config = this.formatConfig[this.format];

    let phaseDeliveries = [];
    if (phase === ANALYTICS_PHASE.POWERPLAY) {
      phaseDeliveries = validDeliveries.filter(d => d.over_number <= config.powerplayMandatory);
    } else if (phase === ANALYTICS_PHASE.MIDDLE) {
      const strategicEnd = config.powerplayMandatory + config.powerplayStrategic;
      phaseDeliveries = validDeliveries.filter(d => d.over_number > config.powerplayMandatory && d.over_number <= strategicEnd);
    } else if (phase === ANALYTICS_PHASE.DEATH) {
      const deathStart = config.deathOversStart || this.overs - 4;
      phaseDeliveries = validDeliveries.filter(d => d.over_number >= deathStart);
    } else {
      phaseDeliveries = validDeliveries;
    }

    const stats = {
      runs_scored: 0,
      balls_faced: 0,
      wickets_lost: 0,
      boundaries: 0,
      sixes: 0,
      dot_balls: 0
    };

    for (const delivery of phaseDeliveries) {
      if (delivery.delivery_type === 'legal') {
        stats.balls_faced++;
        if (delivery.runs_from_delivery === 'dot') stats.dot_balls++;
        if (delivery.runs_from_delivery === 'four' || delivery.runs_from_delivery === 'boundary_four') stats.boundaries++;
        if (delivery.runs_from_delivery === 'six' || delivery.runs_from_delivery === 'boundary_six') stats.sixes++;
      }
      stats.runs_scored += delivery.total_runs || 0;
      if (delivery.wicket) stats.wickets_lost++;
    }

    stats.run_rate = stats.balls_faced > 0
      ? ((stats.runs_scored / stats.balls_faced) * 6).toFixed(2)
      : 0;
    stats.boundary_percentage = stats.balls_faced > 0
      ? ((stats.boundaries + stats.sixes) / stats.balls_faced * 100).toFixed(2)
      : 0;
    stats.dot_ball_percentage = stats.balls_faced > 0
      ? (stats.dot_balls / stats.balls_faced * 100).toFixed(2)
      : 0;

    return stats;
  }

  /**
   * MOMENTUM SCORE - Recent 2 overs vs Overall
   */
  calculateMomentum(deliveries) {
    const validDeliveries = deliveries.filter(d => !d.is_reversed && d.delivery_type === 'legal');

    if (validDeliveries.length < 12) return 50;

    const recentDeliveries = validDeliveries.slice(-12);
    const overallDeliveries = validDeliveries;

    const recentRuns = recentDeliveries.reduce((sum, d) => sum + (d.batter_runs || 0), 0);
    const overallRuns = overallDeliveries.reduce((sum, d) => sum + (d.batter_runs || 0), 0);
    const overallBalls = overallDeliveries.length;

    const recentRR = (recentRuns / 12) * 6;
    const overallRR = overallBalls > 0 ? (overallRuns / overallBalls) * 6 : 0;

    if (overallRR === 0) return 50;

    const momentum = ((recentRR - overallRR) / overallRR) * 100 + 50;
    return Math.max(0, Math.min(100, momentum.toFixed(2)));
  }

  /**
   * PRESSURE INDEX - Combination of wickets in hand and overs remaining
   */
  calculatePressureIndex(wicketsInHand, oversRemaining) {
    const maxWickets = 10;
    const maxOvers = this.overs;

    const wicketFactor = (wicketsInHand / maxWickets) * 50;
    const oversFactor = (oversRemaining / maxOvers) * 50;

    return (wicketFactor + oversFactor).toFixed(2);
  }

  /**
   * DEATH OVERS EFFICIENCY
   */
  calculateDeathOversStats(deliveries) {
    const config = this.formatConfig[this.format];
    const deathStart = config.deathOversStart || this.overs - 4;
    const validDeliveries = deliveries.filter(d => !d.is_reversed && d.over_number >= deathStart);

    let stats = {
      runs: 0,
      balls: 0,
      wickets: 0,
      boundaries: 0,
      sixes: 0,
      dot_balls: 0
    };

    for (const delivery of validDeliveries) {
      if (delivery.delivery_type === 'legal') {
        stats.balls++;
        if (delivery.runs_from_delivery === 'dot') stats.dot_balls++;
        if (delivery.runs_from_delivery === 'four' || delivery.runs_from_delivery === 'boundary_four') stats.boundaries++;
        if (delivery.runs_from_delivery === 'six' || delivery.runs_from_delivery === 'boundary_six') stats.sixes++;
      }
      stats.runs += delivery.total_runs || 0;
      if (delivery.wicket) stats.wickets++;
    }

    stats.run_rate = stats.balls > 0 ? ((stats.runs / stats.balls) * 6).toFixed(2) : 0;
    stats.boundary_count = stats.boundaries + stats.sixes;

    return stats;
  }

  /**
   * FOLLOW-ON DETECTION (Test cricket)
   */
  calculateFollowOnRecommendation(firstInningsRuns, firstInningsOvers, secondInningsOvers, format = 'TEST') {
    if (format !== 'TEST') return { recommended: false, reason: 'Not Test match' };

    const leadRuns = firstInningsRuns;
    const leadOvers = firstInningsOvers;

    const threshold = 200;

    if (leadOvers >= 80) {
      if (leadRuns >= threshold) {
        return {
          recommended: true,
          lead_runs: leadRuns,
          threshold: threshold,
          reason: `Lead of ${leadRuns} runs in ${leadOvers} overs exceeds ${threshold} run threshold`
        };
      }
    }

    return {
      recommended: false,
      lead_runs: leadRuns,
      threshold: threshold,
      reason: leadRuns < threshold
        ? `Lead of ${leadRuns} runs is less than ${threshold} threshold`
        : `Innings not completed (only ${leadOvers} overs)`
    };
  }

  /**
   * INNINGS DECLARATION CHECK
   */
  shouldDeclare(innings, format) {
    const config = this.formatConfig[format];
    const oversBowled = innings.overs_bowled;
    const totalRuns = innings.total_runs;
    const wickets = innings.wickets_fallen;

    if (oversBowled < config.maxOvers * 0.5) return false;
    if (wickets < 7) return false;

    const runsPerOver = totalRuns / oversBowled;
    const projectedScore = runsPerOver * config.maxOvers;

    if (projectedScore < 400 && format === 'TEST') return false;

    return {
      should_declare: true,
      projected_score: Math.round(projectedScore),
      current_run_rate: runsPerOver.toFixed(2)
    };
  }

  /**
   * SUPER OVER WINNER DETERMINATION
   */
  determineSuperOverWinner(superOverResult) {
    if (superOverResult.team1_runs > superOverResult.team2_runs) {
      return { winner: 'team1', margin: `${superOverResult.team1_runs - superOverResult.team2_runs} runs` };
    } else if (superOverResult.team2_runs > superOverResult.team1_runs) {
      return { winner: 'team2', margin: `${superOverResult.team2_runs - superOverResult.team1_runs} wickets` };
    } else {
      return { winner: 'tie', margin: 'Super Over tied -规则的 boundary countback' };
    }
  }

  /**
   * VALIDATE DELIVERY - Enhanced validation rules
   */
  validateDelivery(deliveryData) {
    const errors = [];
    const warnings = [];

    const maxLegalBalls = 6;
    if (deliveryData.ball_in_over > maxLegalBalls + 2) {
      errors.push(`Invalid ball_in_over: ${deliveryData.ball_in_over} (max ${maxLegalBalls + 2} with extras)`);
    }

    if (deliveryData.over_number > this.overs) {
      errors.push(`Over ${deliveryData.over_number} exceeds format limit of ${this.overs}`);
    }

    if (deliveryData.wicket && deliveryData.wicket_type === 'retired_hurt' && !deliveryData.retirement_reason) {
      warnings.push('Retired hurt should include retirement reason');
    }

    if (deliveryData.is_free_hit && deliveryData.delivery_type !== 'no_ball') {
      warnings.push('Free hit only applies after no-ball');
    }

    if (deliveryData.delivery_type === 'wide' && deliveryData.batter_runs > 0) {
      warnings.push('Batter runs on wide - verify if intentional');
    }

    if (deliveryData.wicket && deliveryData.wicket_type === 'run_out' && !deliveryData.fielder_id) {
      errors.push('Run-out requires fielder_id');
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * CHECK MATCH END CONDITIONS
   */
  checkMatchEnd(innings, format) {
    const config = this.formatConfig[format];
    const maxLegalBalls = config.maxOvers * 6;

    const allWicketsFallen = innings.wickets_fallen >= 10;
    const allOversBowled = innings.balls_bowled >= maxLegalBalls;

    if (allWicketsFallen || allOversBowled) {
      return {
        ended: true,
        reason: allWicketsFallen ? 'All out' : 'Overs completed',
        can_chase: false
      };
    }

    return {
      ended: false,
      reason: null,
      balls_remaining: maxLegalBalls - innings.balls_bowled,
      wickets_remaining: 10 - innings.wickets_fallen
    };
  }

  /**
   * CALCULATE PROJECTED SCORE
   */
  calculateProjectedScore(innings) {
    const oversBowled = innings.overs_bowled || 0;
    const totalRuns = innings.total_runs || 0;

    if (oversBowled === 0) return { projected: 0, confidence: 'low' };

    const runRate = totalRuns / oversBowled;
    const projected = Math.round(runRate * this.overs);

    const confidence = oversBowled >= 10 ? 'high' : oversBowled >= 5 ? 'medium' : 'low';

    return {
      projected,
      run_rate: runRate.toFixed(2),
      confidence
    };
  }
}

export default CricketScoringEngine;