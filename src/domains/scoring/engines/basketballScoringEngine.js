import BaseScoringEngine from './baseScoringEngine.js';
import { BASKETBALL_RULES_VARIANTS, EVENT_TYPES, FOUL_TYPES } from '../config/basketballRules.js';

export class BasketballScoringEngine extends BaseScoringEngine {
  constructor(sportConfig) {
    const rules = sportConfig?.rules?.variant 
      ? BASKETBALL_RULES_VARIANTS[sportConfig.rules.variant] 
      : BASKETBALL_RULES_VARIANTS.nba;
    
    super({ ...sportConfig, rules });
    this.rules = { ...BASKETBALL_RULES_VARIANTS.nba, ...(sportConfig?.rules || {}), ...rules };
  }

  validateEvent(eventType, eventData) {
    const validTypes = Object.values(EVENT_TYPES);
    if (!validTypes.includes(eventType)) {
      return { valid: false, error: `Invalid basketball event type: ${eventType}` };
    }

    const requiredFields = {
      field_goal_made: ['player_id', 'team_id'],
      field_goal_missed: ['player_id', 'team_id'],
      three_pointer_made: ['player_id', 'team_id'],
      three_pointer_missed: ['player_id', 'team_id'],
      free_throw_made: ['player_id', 'team_id'],
      free_throw_missed: ['player_id', 'team_id'],
      offensive_rebound: ['player_id', 'team_id'],
      defensive_rebound: ['player_id', 'team_id'],
      assist: ['player_id', 'team_id'],
      steal: ['player_id', 'team_id'],
      turnover: ['player_id', 'team_id'],
      block: ['player_id', 'team_id'],
      personal_foul: ['player_id', 'team_id'],
      shooting_foul: ['player_id', 'team_id', 'fouled_player_id'],
      offensive_foul: ['player_id', 'team_id'],
      technical_foul: ['player_id', 'team_id'],
      flagrant_foul_1: ['player_id', 'team_id'],
      flagrant_foul_2: ['player_id', 'team_id'],
      timeout: ['team_id'],
      substitution: ['team_id', 'player_in_id', 'player_out_id']
    };

    const required = requiredFields[eventType] || [];
    for (const field of required) {
      if (!eventData[field]) {
        return { valid: false, error: `Missing required field: ${field} for event ${eventType}` };
      }
    }

    return { valid: true };
  }

  calculateScore(events, match) {
    if (!match) {
      return { home: 0, away: 0 };
    }

    let homeScore = 0;
    let awayScore = 0;
    const validEvents = events.filter(e => !e.is_reversed);

    for (const event of validEvents) {
      if (event.event_type === EVENT_TYPES.FIELD_GOAL_MADE) {
        if (event.team_id === match.home_team_id) {
          homeScore += 2;
        } else {
          awayScore += 2;
        }
      } else if (event.event_type === EVENT_TYPES.THREE_POINTER_MADE) {
        if (event.team_id === match.home_team_id) {
          homeScore += 3;
        } else {
          awayScore += 3;
        }
      } else if (event.event_type === EVENT_TYPES.FREE_THROW_MADE) {
        if (event.team_id === match.home_team_id) {
          homeScore += 1;
        } else {
          awayScore += 1;
        }
      }
    }

    return { home: homeScore, away: awayScore };
  }

  calculateQuarterScore(events, quarter, match) {
    const quarterEvents = events.filter(e =>
      !e.is_reversed && e.metadata?.quarter === quarter
    );
    return this.calculateScore(quarterEvents, match);
  }

  calculateOvertimeScore(events, match) {
    const otEvents = events.filter(e =>
      !e.is_reversed && e.metadata?.period_type?.startsWith('overtime')
    );
    return this.calculateScore(otEvents, match);
  }

  getMatchSummary(events, match) {
    const score = this.calculateScore(events, match);

    const quarters = {};
    for (let i = 1; i <= this.rules.quarters; i++) {
      const quarterScore = this.calculateQuarterScore(events, i, match);
      quarters[`q${i}`] = {
        home: quarterScore.home,
        away: quarterScore.away
      };
    }

    const otEvents = events.filter(e => 
      !e.is_reversed && e.metadata?.period_type?.startsWith('overtime')
    );
    
    const hasOvertime = otEvents.length > 0;
    if (hasOvertime) {
      const otScore = this.calculateOvertimeScore(events, match);
      quarters.overtime = {
        home: otScore.home,
        away: otScore.away
      };
    }

    return {
      home_score: score.home,
      away_score: score.away,
      quarters,
      status: this.determineWinner(score.home, score.away),
      is_overtime: hasOvertime,
      overtime_count: hasOvertime ? Math.max(...otEvents.map(e => parseInt(e.metadata?.period_type?.split('_')[1] || 0))) : 0
    };
  }

  calculateBonusStatus(teamFoulCount) {
    if (teamFoulCount >= this.rules.teamFoulDoubleBonusThreshold) {
      return 'double_bonus';
    } else if (teamFoulCount >= this.rules.teamFoulBonusThreshold) {
      return 'bonus';
    }
    return 'none';
  }

  getFoulOutLimit() {
    return this.rules.personalFoulLimit;
  }

  getPeriodConfig() {
    return {
      quarters: this.rules.quarters,
      quarterDuration: this.rules.quarterDuration,
      overtimeDuration: this.rules.overtimeDuration,
      maxOvertimes: this.rules.maxOvertimes
    };
  }

  calculateFreeThrowCount(foulType, bonusStatus) {
    if (foulType === FOUL_TYPES.FLANGRANT_2) return 2;
    if (foulType === FOUL_TYPES.FLANGRANT_1) return 2;
    if (foulType === FOUL_TYPES.TECHNICAL) return 1;

    if (bonusStatus === 'double_bonus') return 2;
    if (bonusStatus === 'bonus') return 1;

    return 0;
  }

  isValidShotClockReset(reason) {
    const validReasons = [
      'made_basket',
      'offensive_rebound',
      'turnover',
      'timeout',
      'dead_ball',
      'violation'
    ];
    return validReasons.includes(reason);
  }

  determineWinner(homeScore, awayScore) {
    if (homeScore > awayScore) return 'home';
    if (awayScore > homeScore) return 'away';
    return 'draw';
  }

  aggregateScore(events, teamId, match) {
    const teamEvents = events.filter(e => e.team_id === teamId);
    return this.calculateScore(teamEvents, match);
  }

  isValidEventSequence(events) {
    const sorted = [...events].sort((a, b) => a.sequence_number - b.sequence_number);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].sequence_number <= sorted[i - 1].sequence_number) {
        return false;
      }
    }
    return true;
  }
}

export default BasketballScoringEngine;