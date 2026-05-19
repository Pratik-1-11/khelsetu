import BaseScoringEngine from './baseScoringEngine.js';

const TABLE_TENNIS_EVENT_TYPES = {
  POINT: 'point',
  SERVICE_ERROR: 'service_error',
  NET_FAULT: 'net_fault',
  OUT_FAULT: 'out_fault'
};

export class TableTennisScoringEngine extends BaseScoringEngine {
  constructor(sportConfig) {
    super(sportConfig);
    this.sets = this.rules.sets || 5;
    this.pointsPerSet = this.rules.points_per_set || 11;
    this.winByTwo = this.rules.win_by_2 || true;
  }

  validateEvent(eventType, eventData) {
    const validTypes = Object.values(TABLE_TENNIS_EVENT_TYPES);
    if (!validTypes.includes(eventType)) {
      return { valid: false, error: `Invalid event type: ${eventType}` };
    }
    return { valid: true };
  }

  calculateScore(events) {
    return events.filter(e => !e.is_reversed && e.event_type === TABLE_TENNIS_EVENT_TYPES.POINT).length;
  }

  getMatchSummary(events) {
    const sets = {};
    for (let i = 1; i <= this.sets; i++) {
      const setEvents = events.filter(e =>
        !e.is_reversed &&
        e.metadata?.set === i &&
        e.event_type === TABLE_TENNIS_EVENT_TYPES.POINT
      );
      sets[`set${i}`] = {
        home: setEvents.filter(e => e.team_id === 'home').length,
        away: setEvents.filter(e => e.team_id === 'away').length
      };
    }

    const homeSets = Object.values(sets).filter(s => s.home > s.away).length;
    const awaySets = Object.values(sets).filter(s => s.away > s.home).length;

    return {
      sets,
      home_sets: homeSets,
      away_sets: awaySets,
      status: homeSets > awaySets ? 'home' : awaySets > homeSets ? 'away' : 'pending'
    };
  }
}

export default TableTennisScoringEngine;