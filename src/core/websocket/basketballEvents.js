export const BASKETBALL_WEBSOCKET_EVENTS = {
  CLOCK_UPDATE: 'basketball:clock_update',
  SHOT_CLOCK_UPDATE: 'basketball:shot_clock_update',
  SHOT_CLOCK_VIOLATION: 'basketball:shot_clock_violation',
  PERIOD_START: 'basketball:period_start',
  PERIOD_END: 'basketball:period_end',
  OVERTIME_START: 'basketball:overtime_start',

  SCORE_UPDATE: 'basketball:score_update',
  FIELD_GOAL: 'basketball:field_goal',
  FREE_THROW_START: 'basketball:free_throw_start',
  FREE_THROW_RESULT: 'basketball:free_throw_result',
  FREE_THROW_COMPLETE: 'basketball:free_throw_complete',
  FREE_THROW_UPDATE: 'basketball:free_throw_update',
  FREE_THROW_CANCELLED: 'basketball:free_throw_cancelled',

  POSSESSION_CHANGE: 'basketball:possession_change',
  JUMP_BALL: 'basketball:jump_ball',
  JUMP_BALL_RESULT: 'basketball:jump_ball_result',
  INITIAL_JUMP_BALL: 'basketball:initial_jump_ball',

  FOUL_COMMITTED: 'basketball:foul_committed',
  FOUL_REVERSED: 'basketball:foul_reversed',
  BONUS_STATUS: 'basketball:bonus_status',
  PLAYER_FOULED_OUT: 'basketball:player_fouled_out',
  TECHNICAL_FOUL: 'basketball:technical_foul',

  TIMEOUT_CALLED: 'basketball:timeout_called',
  TIMEOUT_COMPLETED: 'basketball:timeout_completed',
  TIMEOUT_CANCELLED: 'basketball:timeout_cancelled',

  PLAYER_STATS: 'basketball:player_stats',
  TEAM_STATS: 'basketball:team_stats',
  STATS_UPDATE: 'basketball:stats_update',

  SUBSTITUTION: 'basketball:substitution',

  GAME_START: 'basketball:game_start',
  GAME_END: 'basketball:game_end',

  REBOUND: 'basketball:rebound',
  ASSIST: 'basketball:assist',
  STEAL: 'basketball:steal',
  TURNOVER: 'basketball:turnover',
  BLOCK: 'basketball:block',

  CLOCK_SYNC: 'basketball:clock_sync'
};

export default BASKETBALL_WEBSOCKET_EVENTS;