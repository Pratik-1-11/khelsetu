export const USER_ROLES = {
  SUPER_ADMIN: 'super_admin',
  ORG_ADMIN: 'org_admin',
  TOURNAMENT_ADMIN: 'tournament_admin',
  SCORER: 'scorer',
  VIEWER: 'viewer'
};

export const PERMISSIONS = {
  ORG_CREATE: 'org:create',
  ORG_READ: 'org:read',
  ORG_UPDATE: 'org:update',
  ORG_DELETE: 'org:delete',
  TOURNAMENT_CREATE: 'tournament:create',
  TOURNAMENT_READ: 'tournament:read',
  TOURNAMENT_UPDATE: 'tournament:update',
  TOURNAMENT_DELETE: 'tournament:delete',
  MATCH_CREATE: 'match:create',
  MATCH_READ: 'match:read',
  MATCH_UPDATE: 'match:update',
  MATCH_DELETE: 'match:delete',
  SCORE_UPDATE: 'score:update',
  TEAM_CREATE: 'team:create',
  TEAM_READ: 'team:read',
  TEAM_UPDATE: 'team:update',
  TEAM_DELETE: 'team:delete',
  PLAYER_CREATE: 'player:create',
  PLAYER_READ: 'player:read',
  PLAYER_UPDATE: 'player:update',
  PLAYER_DELETE: 'player:delete'
};

export const MATCH_STATUS = {
  SCHEDULED: 'scheduled',
  LIVE: 'live',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  POSTPONED: 'postponed'
};

export const TOURNAMENT_STATUS = {
  DRAFT: 'draft',
  REGISTRATION_OPEN: 'registration_open',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled'
};

export const SPORTS = {
  FOOTBALL: 'football',
  CRICKET: 'cricket',
  BASKETBALL: 'basketball',
  VOLLEYBALL: 'volleyball',
  BADMINTON: 'badminton',
  TABLE_TENNIS: 'table_tennis'
};

export const SCORE_EVENT_TYPES = {
  GOAL: 'goal',
  YELLOW_CARD: 'yellow_card',
  RED_CARD: 'red_card',
  PENALTY: 'penalty',
  OWN_GOAL: 'own_goal',
  WICKET: 'wicket',
  RUN: 'run',
  SIX: 'six',
  FOUR: 'four',
  POINT: 'point',
  SET_WIN: 'set_win'
};

export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100
};

export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const validateUUID = (uuid) => {
  return UUID_REGEX.test(uuid);
};

export const generateUUID = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

export const sanitizeInput = (input) => {
  if (typeof input !== 'string') return input;
  return input.trim().replace(/[<>]/g, '');
};

export const parseBoolean = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    return value.toLowerCase() === 'true' || value === '1';
  }
  return Boolean(value);
};

export default {
  USER_ROLES,
  PERMISSIONS,
  MATCH_STATUS,
  TOURNAMENT_STATUS,
  SPORTS,
  SCORE_EVENT_TYPES,
  PAGINATION,
  validateUUID,
  generateUUID,
  sanitizeInput,
  parseBoolean
};