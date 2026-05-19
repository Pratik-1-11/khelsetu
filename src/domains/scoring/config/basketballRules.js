export const BASKETBALL_RULES_VARIANTS = {
  nba: {
    name: 'NBA',
    quarters: 4,
    quarterDuration: 720,
    overtimeDuration: 300,
    maxOvertimes: null,
    personalFoulLimit: 6,
    teamFoulBonusThreshold: 5,
    teamFoulDoubleBonusThreshold: 8,
    shotClockInitial: 24,
    shotClockAfterOffensiveRebound: 24,
    timeoutsPerHalf: 2,
    timeoutsPerGame: 6,
    timeoutFullDuration: 60,
    timeoutShortDuration: 20,
    maxSubstitutions: null,
    doubleBonusThreshold: 8
  },

  fiba: {
    name: 'FIBA',
    quarters: 4,
    quarterDuration: 600,
    overtimeDuration: 300,
    maxOvertimes: 2,
    personalFoulLimit: 5,
    teamFoulBonusThreshold: 5,
    teamFoulDoubleBonusThreshold: 8,
    shotClockInitial: 24,
    shotClockAfterOffensiveRebound: 14,
    timeoutsPerHalf: 2,
    timeoutsPerGame: 2,
    timeoutFullDuration: 60,
    timeoutShortDuration: 30,
    maxSubstitutions: null,
    doubleBonusThreshold: 8
  },

  ncaa_men: {
    name: 'NCAA Men',
    quarters: 2,
    quarterDuration: 1200,
    overtimeDuration: 300,
    maxOvertimes: null,
    personalFoulLimit: 5,
    teamFoulBonusThreshold: 7,
    teamFoulDoubleBonusThreshold: 10,
    shotClockInitial: 30,
    shotClockAfterOffensiveRebound: 30,
    timeoutsPerHalf: 2,
    timeoutsPerGame: 5,
    timeoutFullDuration: 75,
    timeoutShortDuration: 30,
    maxSubstitutions: null,
    doubleBonusThreshold: 10
  },

  ncaa_women: {
    name: 'NCAA Women',
    quarters: 4,
    quarterDuration: 600,
    overtimeDuration: 300,
    maxOvertimes: null,
    personalFoulLimit: 5,
    teamFoulBonusThreshold: 7,
    teamFoulDoubleBonusThreshold: 10,
    shotClockInitial: 30,
    shotClockAfterOffensiveRebound: 30,
    timeoutsPerHalf: 2,
    timeoutsPerGame: 4,
    timeoutFullDuration: 60,
    timeoutShortDuration: 30,
    maxSubstitutions: null,
    doubleBonusThreshold: 10
  }
};

export const getRulesForVariant = (variant) => {
  return BASKETBALL_RULES_VARIANTS[variant] || BASKETBALL_RULES_VARIANTS.nba;
};

export const getDefaultRules = () => {
  return BASKETBALL_RULES_VARIANTS.nba;
};

export const FOUL_TYPES = {
  PERSONAL: 'personal',
  SHOOTING: 'shooting',
  OFFENSIVE: 'offensive',
  TECHNICAL: 'technical',
  FLAGRANT_1: 'flagrant_1',
  FLAGRANT_2: 'flagrant_2',
  UNSPORTSMANLIKE: 'unsportsmanlike',
  DISQUALIFYING: 'disqualifying'
};

export const PERIOD_TYPES = {
  QUARTER_1: 'quarter_1',
  QUARTER_2: 'quarter_2',
  QUARTER_3: 'quarter_3',
  QUARTER_4: 'quarter_4',
  OVERTIME_1: 'overtime_1',
  OVERTIME_2: 'overtime_2',
  OVERTIME_3: 'overtime_3'
};

export const EVENT_TYPES = {
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
  TIMEOUT: 'timeout',
  SUBSTITUTION: 'substitution'
};