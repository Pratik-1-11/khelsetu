import BaseScoringEngine from './baseScoringEngine.js';

const VOLLEYBALL_EVENT_TYPES = {
  POINT: 'point',
  ACE: 'ace',
  BLOCK: 'block',
  DIG: 'dig',
  SPIKE: 'spike',
  SERVICE_ERROR: 'service_error',
  ATTACK_ERROR: 'attack_error',
  NET_FAULT: 'net_fault'
};

export class VolleyballScoringEngine extends BaseScoringEngine {
  constructor(sportConfig) {
    super(sportConfig);
    this.sets = this.rules.sets || 5;
    this.pointsPerSet = this.rules.points_per_set || 25;
    this.winByTwo = this.rules.win_by_2 || true;
  }

  validateEvent(eventType, eventData) {
    const validTypes = Object.values(VOLLEYBALL_EVENT_TYPES);
    if (!validTypes.includes(eventType)) {
      return { valid: false, error: `Invalid event type: ${eventType}` };
    }
    return { valid: true };
  }

  calculateScore(events) {
    return events.filter(e => !e.is_reversed && e.event_type === VOLLEYBALL_EVENT_TYPES.POINT).length;
  }

  calculateSetScore(events, setNumber) {
    const setEvents = events.filter(e =>
      !e.is_reversed &&
      e.metadata?.set === setNumber &&
      e.event_type === VOLLEYBALL_EVENT_TYPES.POINT
    );
    return setEvents.length;
  }

  getMatchSummary(events) {
    const sets = {};
    for (let i = 1; i <= this.sets; i++) {
      sets[`set${i}`] = {
        home: this.calculateSetScore(events.filter(e => e.team_id === 'home'), i),
        away: this.calculateSetScore(events.filter(e => e.team_id === 'away'), i)
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

export default VolleyballScoringEngine;