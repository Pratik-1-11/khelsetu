export class BaseScoringEngine {
  constructor(sportConfig) {
    this.config = sportConfig;
    this.rules = sportConfig.rules || {};
    this.scoringConfig = sportConfig.scoring_config || {};
  }

  validateEvent(eventType, eventData) {
    throw new Error('validateEvent must be implemented by subclass');
  }

  calculateScore(events) {
    throw new Error('calculateScore must be implemented by subclass');
  }

  determineWinner(homeScore, awayScore) {
    if (homeScore > awayScore) return 'home';
    if (awayScore > homeScore) return 'away';
    return 'draw';
  }

  calculatePoints(score) {
    if (score === 'win') return this.scoringConfig.win || 3;
    if (score === 'draw') return this.scoringConfig.draw || 1;
    if (score === 'loss') return this.scoringConfig.loss || 0;
    return 0;
  }

  aggregateScore(events, teamId) {
    const teamEvents = events.filter(e => e.team_id === teamId);
    return this.calculateScore(teamEvents);
  }

  getPeriodConfig() {
    return this.rules;
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

export default BaseScoringEngine;