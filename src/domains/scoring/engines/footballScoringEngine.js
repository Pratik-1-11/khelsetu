import BaseScoringEngine from './baseScoringEngine.js';

const FOOTBALL_EVENT_TYPES = {
  GOAL: 'goal',
  YELLOW_CARD: 'yellow_card',
  RED_CARD: 'red_card',
  SECOND_YELLOW: 'second_yellow',
  PENALTY: 'penalty',
  OWN_GOAL: 'own_goal',
  SUBSTITUTION: 'substitution',
  INJURY: 'injury',
  VAR_DECISION: 'var_decision',
  VAR_REVERSAL: 'var_reversal'
};

const VALID_PERIODS = ['first_half', 'second_half', 'extra_time_first', 'extra_time_second', 'penalties'];

const MAX_MINUTES = {
  first_half: 45,
  second_half: 90,
  extra_time_first: 105,
  extra_time_second: 120,
  penalties: 120
};

export class FootballScoringEngine extends BaseScoringEngine {
  constructor(sportConfig) {
    super(sportConfig);
    this.periodDuration = this.rules.period_duration || 45;
    this.extraTime = this.rules.extra_time || false;
    this.penaltyShootout = this.rules.penalty_shootout || false;
    this.maxSubstitutions = this.rules.max_substitutions || 5;
    this.extraTimeSubstitutions = this.rules.extra_time_substitutions || 1;
    this.maxPlayers = this.rules.max_players || 11;
    this.minPlayers = this.rules.min_players || 7;
  }

  validateEvent(eventType, eventData) {
    const validTypes = Object.values(FOOTBALL_EVENT_TYPES);
    if (!validTypes.includes(eventType)) {
      return { valid: false, error: `Invalid event type: ${eventType}` };
    }

    if (!eventData.match_id && !eventData.team_id) {
      return { valid: false, error: 'team_id is required' };
    }

    if (eventType === FOOTBALL_EVENT_TYPES.GOAL || 
        eventType === FOOTBALL_EVENT_TYPES.PENALTY ||
        eventType === FOOTBALL_EVENT_TYPES.OWN_GOAL) {
      if (!eventData.team_id) {
        return { valid: false, error: 'team_id is required for goals' };
      }
      if (eventData.minute !== undefined && (eventData.minute < 0 || eventData.minute > 130)) {
        return { valid: false, error: 'minute must be between 0 and 130' };
      }
    }

    if (eventType === FOOTBALL_EVENT_TYPES.YELLOW_CARD || 
        eventType === FOOTBALL_EVENT_TYPES.RED_CARD ||
        eventType === FOOTBALL_EVENT_TYPES.SECOND_YELLOW) {
      if (!eventData.player_id) {
        return { valid: false, error: 'player_id is required for cards' };
      }
    }

    if (eventType === FOOTBALL_EVENT_TYPES.SUBSTITUTION) {
      if (!eventData.player_in_id || !eventData.player_out_id) {
        return { valid: false, error: 'player_in_id and player_out_id are required for substitutions' };
      }
      if (eventData.player_in_id === eventData.player_out_id) {
        return { valid: false, error: 'Cannot substitute same player' };
      }
    }

    if (eventData.period_type && !VALID_PERIODS.includes(eventData.period_type)) {
      return { valid: false, error: `Invalid period_type: ${eventData.period_type}` };
    }

    return { valid: true };
  }

  validatePeriodMinute(periodType, minute, injuryTime = 0) {
    const maxMinute = MAX_MINUTES[periodType] || 120;
    const effectiveMinute = minute + (injuryTime || 0);
    
    if (effectiveMinute > maxMinute) {
      return { 
        valid: false, 
        error: `Minute ${effectiveMinute} exceeds maximum ${maxMinute} for ${periodType}` 
      };
    }
    return { valid: true };
  }

  calculateScore(events) {
    const validEvents = events.filter(e =>
      !e.is_reversed &&
      !e.is_compensation &&
      (e.event_type === FOOTBALL_EVENT_TYPES.GOAL ||
       e.event_type === FOOTBALL_EVENT_TYPES.PENALTY ||
       e.event_type === FOOTBALL_EVENT_TYPES.OWN_GOAL)
    );

    let goals = 0;
    for (const event of validEvents) {
      if (event.event_type === FOOTBALL_EVENT_TYPES.OWN_GOAL) {
        goals -= 1;
      } else {
        goals += 1;
      }
    }

    return Math.max(0, goals);
  }

  calculateScoreByTeam(events, homeTeamId, awayTeamId) {
    const homeEvents = events.filter(e => e.team_id === homeTeamId && !e.is_reversed && !e.is_compensation);
    const awayEvents = events.filter(e => e.team_id === awayTeamId && !e.is_reversed && !e.is_compensation);

    let homeGoals = 0;
    let awayGoals = 0;

    for (const event of homeEvents) {
      if ([FOOTBALL_EVENT_TYPES.GOAL, FOOTBALL_EVENT_TYPES.PENALTY].includes(event.event_type)) {
        homeGoals += 1;
      } else if (event.event_type === FOOTBALL_EVENT_TYPES.OWN_GOAL) {
        awayGoals += 1;
      }
    }

    for (const event of awayEvents) {
      if ([FOOTBALL_EVENT_TYPES.GOAL, FOOTBALL_EVENT_TYPES.PENALTY].includes(event.event_type)) {
        awayGoals += 1;
      } else if (event.event_type === FOOTBALL_EVENT_TYPES.OWN_GOAL) {
        homeGoals += 1;
      }
    }

    return { home: homeGoals, away: awayGoals };
  }

  calculateExtraTimeScore(events, currentPeriod) {
    if (!currentPeriod || !currentPeriod.startsWith('extra_time')) return 0;

    const validEvents = events.filter(e =>
      !e.is_reversed &&
      !e.is_compensation &&
      (e.event_type === FOOTBALL_EVENT_TYPES.GOAL ||
       e.event_type === FOOTBALL_EVENT_TYPES.PENALTY) &&
      e.minute > 90
    );

    return validEvents.length;
  }

  calculatePenaltyShootoutScore(events) {
    const validEvents = events.filter(e =>
      !e.is_reversed &&
      !e.is_compensation &&
      e.period_type === 'penalties' &&
      (e.event_type === FOOTBALL_EVENT_TYPES.GOAL ||
       e.event_type === FOOTBALL_EVENT_TYPES.PENALTY)
    );

    return validEvents.length;
  }

  getCards(events) {
    const activeCards = events.filter(e => !e.is_reversed);
    
    const yellowCards = activeCards.filter(e => e.event_type === FOOTBALL_EVENT_TYPES.YELLOW_CARD);
    const redCards = activeCards.filter(e => 
      e.event_type === FOOTBALL_EVENT_TYPES.RED_CARD || 
      e.event_type === FOOTBALL_EVENT_TYPES.SECOND_YELLOW
    );

    const cardsByTeam = {
      home: {
        yellow: yellowCards.filter(e => e.team_id === 'home').length,
        red: redCards.filter(e => e.team_id === 'home').length
      },
      away: {
        yellow: yellowCards.filter(e => e.team_id === 'away').length,
        red: redCards.filter(e => e.team_id === 'away').length
      }
    };

    return cardsByTeam;
  }

  getMatchSummary(events, homeTeamId, awayTeamId, currentPeriod) {
    const score = this.calculateScoreByTeam(events, homeTeamId, awayTeamId);
    const cards = this.getCards(events);
    const extraTimeScore = this.calculateExtraTimeScore(events, currentPeriod);
    const penaltyScore = this.calculatePenaltyShootoutScore(events);

    const winner = this.determineWinner(score.home, score.away);

    return {
      home_score: score.home,
      away_score: score.away,
      home_extra_time_score: currentPeriod?.startsWith('extra_time') ? extraTimeScore : 0,
      away_extra_time_score: currentPeriod?.startsWith('extra_time') ? (events.filter(e => e.team_id === awayTeamId && e.minute > 90).length) : 0,
      home_penalty_score: currentPeriod === 'penalties' ? penaltyScore : 0,
      away_penalty_score: currentPeriod === 'penalties' ? penaltyScore : 0,
      cards,
      winner,
      status: winner === 'home' ? 'home_win' : winner === 'away' ? 'away_win' : 'draw'
    };
  }

  determineWinner(homeGoals, awayGoals) {
    if (homeGoals > awayGoals) return 'home';
    if (awayGoals > homeGoals) return 'away';
    return 'draw';
  }

  determineMatchResult(homeGoals, awayGoals, currentPeriod, isKnockout) {
    if (currentPeriod === 'penalties') {
      return this.determineWinner(homeGoals, awayGoals);
    }

    if (['extra_time_first', 'extra_time_second'].includes(currentPeriod)) {
      return this.determineWinner(homeGoals, awayGoals);
    }

    if (!isKnockout) {
      return this.determineWinner(homeGoals, awayGoals);
    }

    if (homeGoals === awayGoals) {
      return 'undecided';
    }

    return this.determineWinner(homeGoals, awayGoals);
  }

  calculateStandingsStats(matches, teamId) {
    let played = 0, won = 0, drawn = 0, lost = 0, goalsFor = 0, goalsAgainst = 0;

    for (const match of matches) {
      if (match.status !== 'completed') continue;
      played++;

      const isHome = match.home_team_id === teamId;
      const teamScore = isHome ? match.home_score : match.away_score;
      const opponentScore = isHome ? match.away_score : match.home_score;

      goalsFor += teamScore;
      goalsAgainst += opponentScore;

      if (teamScore > opponentScore) won++;
      else if (teamScore === opponentScore) drawn++;
      else lost++;
    }

    const points = (won * (this.scoringConfig.win || 3)) + (drawn * (this.scoringConfig.draw || 1));

    return {
      played,
      won,
      drawn,
      lost,
      goals_for: goalsFor,
      goals_against: goalsAgainst,
      goal_difference: goalsFor - goalsAgainst,
      points
    };
  }

  validateSubstitution(substitutionData, matchState) {
    const { teamId, playerInId, playerOutId, minute, periodType } = substitutionData;
    const errors = [];

    const teamSubstitutions = matchState.substitutions?.[teamId] || { used: 0, max: this.maxSubstitutions };
    const isExtraTime = periodType?.startsWith('extra_time');
    const maxSubstitutions = isExtraTime ? 
      this.maxSubstitutions + this.extraTimeSubstitutions : 
      this.maxSubstitutions;

    if (teamSubstitutions.used >= maxSubstitutions) {
      errors.push(`Maximum ${maxSubstitutions} substitutions reached`);
    }

    if (matchState.lineups?.[teamId]?.includes(playerInId)) {
      errors.push('Player is already on the field');
    }

    if (!matchState.lineups?.[teamId]?.includes(playerOutId)) {
      errors.push('Player to be substituted is not in lineup');
    }

    if (matchState.redCardedPlayers?.[teamId]?.includes(playerOutId)) {
      errors.push('Player already sent off');
    }

    if (matchState.substitutions?.[teamId]?.some(s => s.player_out_id === playerOutId)) {
      errors.push('Player already substituted');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  getPeriodConfig() {
    return {
      periods: this.rules.periods || 2,
      period_duration: this.periodDuration,
      extra_time: this.extraTime,
      penalty_shootout: this.penaltyShootout,
      max_substitutions: this.maxSubstitutions,
      extra_time_substitutions: this.extraTimeSubstitutions,
      min_players: this.minPlayers,
      max_players: this.maxPlayers
    };
  }

  getMatchStateTransitions() {
    return {
      scheduled: ['first_half'],
      first_half: ['halftime', 'abandoned', 'suspended'],
      halftime: ['second_half', 'abandoned'],
      second_half: ['extra_time', 'penalties', 'completed', 'abandoned', 'suspended'],
      extra_time_first: ['extra_time_second', 'penalties', 'abandoned'],
      extra_time_second: ['penalties', 'completed', 'abandoned'],
      penalties: ['completed', 'abandoned'],
      abandoned: [],
      suspended: ['first_half', 'second_half', 'resumed']
    };
  }

  canTransition(fromState, toState) {
    const transitions = this.getMatchStateTransitions();
    return transitions[fromState]?.includes(toState) || false;
  }
}

export default FootballScoringEngine;