import scoringEventRepository from '../repositories/scoringEventRepository.js';
import matchRepository from '../../matches/repositories/matchRepository.js';
import sportService from '../../tournaments/services/sportService.js';
import { NotFoundError, ForbiddenError, ValidationError, ConflictError } from '../../../core/errors/index.js';
import logger from '../../../core/logger/index.js';
import ws from '../../../core/websocket/index.js';
import db from '../../../infrastructure/postgres/index.js';
import { generateUUID } from '../../../core/utils/index.js';

const FOOTBALL_EVENT_TYPES = {
  GOAL: 'goal',
  PENALTY: 'penalty',
  OWN_GOAL: 'own_goal',
  YELLOW_CARD: 'yellow_card',
  RED_CARD: 'red_card',
  SECOND_YELLOW: 'second_yellow',
  SUBSTITUTION: 'substitution',
  VAR_DECISION: 'var_decision',
  VAR_REVERSAL: 'var_reversal'
};

export class ScoringService {
  async addEvent(matchId, userId, data) {
    const match = await matchRepository.findById(matchId);
    if (!match) {
      throw new NotFoundError('Match not found');
    }

    if (match.status !== 'live') {
      throw new ValidationError('Can only add scoring events to live matches');
    }

    if (data.client_event_id) {
      const existing = await scoringEventRepository.findByClientEventId(data.client_event_id);
      if (existing) {
        logger.warn('Duplicate event detected', { clientEventId: data.client_event_id });
        return { event: existing, isDuplicate: true };
      }
    }

    const tournament = await db.query('SELECT sport_id FROM tournaments WHERE id = ?', [match.tournament_id]);
    const sport = await db.query('SELECT * FROM sports WHERE id = ?', [tournament[0].sport_id]);

    let scoringEngine;
    try {
      scoringEngine = await sportService.getScoringEngine(sport[0].slug);
    } catch (error) {
      scoringEngine = null;
    }

    if (scoringEngine && scoringEngine.validateEvent) {
      const validation = scoringEngine.validateEvent(data.event_type, data);
      if (!validation.valid) {
        throw new ValidationError(validation.error);
      }
    }

    let result;

    if (data.event_type === FOOTBALL_EVENT_TYPES.YELLOW_CARD) {
      result = await this.handleYellowCardWithDoubleYellowCheck(matchId, userId, data);
    } else {
      result = await this.addEventWithTransaction(matchId, userId, data);
    }

    logger.info('Scoring event added', { matchId, eventId: result.event.id, eventType: result.event.event_type });
    return { event: result.event, isDuplicate: false };
  }

  async handleYellowCardWithDoubleYellowCheck(matchId, userId, data) {
    const existingCards = await this.getPlayerCardsInMatch(matchId, data.player_id);
    const activeYellows = existingCards.filter(c => c.card_type === 'yellow' && c.is_active);

    if (activeYellows.length === 1) {
      logger.info('Double yellow detected, converting to red', { matchId, playerId: data.player_id });

      await this.addEventWithTransaction(matchId, userId, {
        ...data,
        event_type: FOOTBALL_EVENT_TYPES.SECOND_YELLOW,
        metadata: {
          ...data.metadata,
          first_yellow_card_id: activeYellows[0].id,
          automatic_red: true
        }
      });

      await db.query(
        'UPDATE player_match_cards SET is_active = FALSE WHERE id = ?',
        [activeYellows[0].id]
      );

      await this.createCardEvent(matchId, data.player_id, data.team_id, 'second_yellow', data.minute, data, null);
    }

    return this.addEventWithTransaction(matchId, userId, data);
  }

  async addEventWithTransaction(matchId, userId, data) {
    return await db.transaction(async (connection) => {
      const [match] = await connection.query('SELECT * FROM matches WHERE id = ?', [matchId]);
      if (!match[0]) throw new NotFoundError('Match not found');

      const previousScore = await this.computeScoreFromEvents(connection, matchId);
      const homeTeamId = match[0].home_team_id;
      const awayTeamId = match[0].away_team_id;

      const event = await this.createEventInTransaction(connection, matchId, match[0].organization_id, userId, data);

      const newScore = await this.computeScoreFromEvents(connection, matchId);

      await this.updateMatchScoreWithOptimisticLock(connection, matchId, newScore, match[0].state_version || 0);

      await this.createSnapshot(connection, matchId, newScore, event.sequence_number);

      await this.createScoreAuditLog(connection, matchId, 'score_update', previousScore, newScore, event.id, userId, data.correction_reason);

      if (['yellow_card', 'red_card', 'second_yellow'].includes(data.event_type)) {
        await this.createCardEvent(connection, data.player_id, data.team_id, data.event_type, data.minute, data, event.id);
      }

      const socketData = {
        matchId,
        event: event,
        score: newScore,
        timestamp: new Date().toISOString()
      };

      return { event, score: newScore };
    });
  }

  async createEventInTransaction(connection, matchId, organizationId, userId, data) {
    const id = generateUUID();

    const [maxSeq] = await connection.query(
      'SELECT COALESCE(MAX(sequence_number), 0) + 1 as next_seq FROM scoring_events WHERE match_id = ?',
      [matchId]
    );

    const periodType = await this.getCurrentPeriodType(connection, matchId);

    const sql = `
      INSERT INTO scoring_events (id, match_id, organization_id, client_event_id, event_type, team_id, player_id, minute, extra_minute, period_type, metadata, is_reversed, original_event_id, is_compensation, created_by, created_at, sequence_number)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)
    `;

    await connection.execute(sql, [
      id, matchId, organizationId, data.client_event_id || generateUUID(), data.event_type,
      data.team_id, data.player_id, data.minute || 0, data.extra_minute || 0, periodType,
      JSON.stringify(data.metadata || {}), false, data.original_event_id || null,
      data.is_compensation || false, userId, maxSeq[0].next_seq
    ]);

    const [event] = await connection.query('SELECT * FROM scoring_events WHERE id = ?', [id]);
    return event[0];
  }

  async computeScoreFromEvents(connection, matchId) {
    const [match] = await connection.query('SELECT home_team_id, away_team_id FROM matches WHERE id = ?', [matchId]);
    if (!match[0]) return { home: 0, away: 0 };

    const homeTeamId = match[0].home_team_id;
    const awayTeamId = match[0].away_team_id;

    const [events] = await connection.query(
      `SELECT * FROM scoring_events WHERE match_id = ? AND is_reversed = FALSE AND is_compensation = FALSE ORDER BY sequence_number ASC`,
      [matchId]
    );

    let homeScore = 0;
    let awayScore = 0;

    for (const event of events) {
      if (['goal', 'penalty'].includes(event.event_type)) {
        if (event.team_id === homeTeamId) {
          homeScore += 1;
        } else if (event.team_id === awayTeamId) {
          awayScore += 1;
        }
      } else if (event.event_type === 'own_goal') {
        if (event.team_id === homeTeamId) {
          awayScore += 1;
        } else if (event.team_id === awayTeamId) {
          homeScore += 1;
        }
      }
    }

    return { home: homeScore, away: awayScore };
  }

  async updateMatchScoreWithOptimisticLock(connection, matchId, score, currentVersion) {
    const [result] = await connection.execute(
      `UPDATE matches SET home_score = ?, away_score = ?, state_version = state_version + 1 WHERE id = ? AND (state_version = ? OR state_version IS NULL)`,
      [score.home, score.away, matchId, currentVersion]
    );

    if (result.rowCount === 0) {
      throw new ConflictError('Match state was modified by another process. Please retry.');
    }
  }

  async getCurrentPeriodType(connection, matchId) {
    const [periods] = await connection.query(
      `SELECT period_type FROM match_periods WHERE match_id = ? AND status = 'in_progress' ORDER BY period_number DESC LIMIT 1`,
      [matchId]
    );

    if (periods[0]) {
      return periods[0].period_type;
    }

    const [match] = await connection.query('SELECT started_at FROM matches WHERE id = ?', [matchId]);
    if (match[0]?.started_at) {
      return 'first_half';
    }

    return 'first_half';
  }

  async aggregateScore(matchId) {
    return await db.transaction(async (connection) => {
      return await this.computeScoreFromEvents(connection, matchId);
    });
  }

  async createSnapshot(connection, matchId, score, sequenceNumber) {
    const id = generateUUID();
    const [periods] = await connection.query(
      `SELECT period_type FROM match_periods WHERE match_id = ? AND status = 'in_progress' ORDER BY period_number DESC LIMIT 1`,
      [matchId]
    );

    const periodType = periods[0]?.period_type || 'first_half';

    const sql = `
      INSERT INTO match_snapshots (id, match_id, sequence_number, home_score, away_score, event_count, snapshot_data, created_at, period_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?)
    `;

    const eventCount = await this.getEventCount(connection, matchId);

    await connection.execute(sql, [
      id, matchId, sequenceNumber, score.home, score.away, eventCount,
      JSON.stringify({ score, sequenceNumber, periodType }), periodType
    ]);

    logger.debug('Snapshot created', { matchId, sequenceNumber });
  }

  async getEventCount(connection, matchId) {
    const [result] = await connection.query(
      'SELECT COUNT(*) as count FROM scoring_events WHERE match_id = ? AND is_reversed = FALSE',
      [matchId]
    );
    return result[0].count;
  }

  async createScoreAuditLog(connection, matchId, actionType, previousScore, newScore, eventId, userId, reason) {
    const id = generateUUID();
    const sql = `
      INSERT INTO score_audit_logs (id, match_id, action_type, previous_score_home, previous_score_away, new_score_home, new_score_away, event_id, user_id, reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `;
    await connection.execute(sql, [
      id, matchId, actionType, previousScore.home, previousScore.away,
      newScore.home, newScore.away, eventId, userId, reason || null
    ]);
  }

  async createCardEvent(connection, playerId, teamId, cardType, minute, data, eventId) {
    const id = generateUUID();
    const sql = `
      INSERT INTO player_match_cards (id, match_id, player_id, team_id, card_type, minute, reason, event_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `;
    await connection.execute(sql, [
      id, data.match_id || connection._matchIdContext, playerId, teamId, cardType, minute, data.reason || null, eventId
    ]);
  }

  async getPlayerCardsInMatch(matchId, playerId) {
    const sql = `SELECT * FROM player_match_cards WHERE match_id = ? AND player_id = ? AND is_active = TRUE`;
    return db.query(sql, [matchId, playerId]);
  }

  async undoEvent(eventId, userId, reason) {
    const event = await scoringEventRepository.findById(eventId);
    if (!event) {
      throw new NotFoundError('Event not found');
    }

    if (event.is_reversed) {
      throw new ValidationError('Event already reversed');
    }

    const match = await matchRepository.findById(event.match_id);
    if (match.status !== 'live') {
      throw new ValidationError('Can only undo events in live matches');
    }

    const previousScore = await this.aggregateScore(event.match_id);

    await scoringEventRepository.reverse(eventId, userId);

    const newScore = await this.aggregateScore(event.match_id);

    await matchRepository.update(event.match_id, {
      home_score: newScore.home,
      away_score: newScore.away
    });

    await this.createSnapshot(event.match_id, newScore, event.sequence_number);

    await db.query(
      `INSERT INTO score_audit_logs (id, match_id, action_type, previous_score_home, previous_score_away, new_score_home, new_score_away, event_id, user_id, reason, created_at)
       VALUES (?, ?, 'event_reverse', ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [generateUUID(), event.match_id, previousScore.home, previousScore.away, newScore.home, newScore.away, eventId, userId, reason || 'Manual undo']
    );

    ws.emitToMatch(event.match_id, 'scoring:event_undone', {
      matchId: event.match_id,
      eventId,
      reason,
      score: newScore,
      timestamp: new Date().toISOString()
    });

    logger.info('Scoring event undone', { matchId: event.match_id, eventId, reason });

    return { success: true, eventId, previousScore, newScore };
  }

  async getMatchHistory(matchId, userId) {
    const match = await matchRepository.findById(matchId);
    if (!match) {
      throw new NotFoundError('Match not found');
    }

    const events = await scoringEventRepository.findByMatch(matchId, { includeReversed: true });

    return {
      match,
      events: events.map(e => ({
        id: e.id,
        event_type: e.event_type,
        team_id: e.team_id,
        player_id: e.player_id,
        minute: e.minute,
        is_reversed: e.is_reversed,
        created_at: e.created_at
      })),
      currentScore: await this.aggregateScore(matchId)
    };
  }

  async getSnapshot(matchId, sequenceNumber = null) {
    if (sequenceNumber) {
      const sql = `SELECT * FROM match_snapshots WHERE match_id = ? AND sequence_number = ?`;
      const rows = await db.query(sql, [matchId, sequenceNumber]);
      return rows[0] || null;
    }

    const sql = `SELECT * FROM match_snapshots WHERE match_id = ? ORDER BY sequence_number DESC LIMIT 1`;
    const rows = await db.query(sql, [matchId]);
    return rows[0] || null;
  }

  async deterministicReplay(matchId) {
    const events = await scoringEventRepository.findByMatch(matchId);
    const computedScore = await this.aggregateScore(matchId);
    const match = await matchRepository.findById(matchId);

    if (computedScore.home !== match.home_score || computedScore.away !== match.away_score) {
      logger.error('SCORE MISMATCH DETECTED', {
        matchId,
        computed: computedScore,
        stored: { home: match.home_score, away: match.away_score }
      });

      await matchRepository.update(matchId, {
        home_score: computedScore.home,
        away_score: computedScore.away
      });

      return {
        wasCorrect: false,
        fixed: true,
        computed: computedScore,
        previousStored: { home: match.home_score, away: match.away_score }
      };
    }

    return { wasCorrect: true, fixed: false, score: computedScore };
  }

  async replayFromSnapshot(matchId, snapshotId, userId) {
    const snapshot = await db.query('SELECT * FROM match_snapshots WHERE id = ?', [snapshotId]);
    if (!snapshot[0]) {
      throw new NotFoundError('Snapshot not found');
    }

    const match = await matchRepository.findById(matchId);
    if (match.status !== 'live') {
      throw new ValidationError('Can only replay in live matches');
    }

    const previousScore = await this.aggregateScore(matchId);

    await matchRepository.update(matchId, {
      home_score: snapshot[0].home_score,
      away_score: snapshot[0].away_score
    });

    await db.query(
      `INSERT INTO score_audit_logs (id, match_id, action_type, previous_score_home, previous_score_away, new_score_home, new_score_away, user_id, reason, created_at)
       VALUES (?, ?, 'manual_correction', ?, ?, ?, ?, ?, ?, NOW())`,
      [generateUUID(), matchId, previousScore.home, previousScore.away, snapshot[0].home_score, snapshot[0].away_score, userId, 'Restored from snapshot']
    );

    ws.emitToMatch(matchId, 'scoring:snapshot_restored', {
      matchId,
      snapshot: snapshot[0],
      timestamp: new Date().toISOString()
    });

    logger.info('Score replayed from snapshot', { matchId, snapshotId });

    return { success: true, restoredSnapshot: snapshot[0] };
  }

  async getMatchEvents(matchId, userId) {
    const match = await matchRepository.findById(matchId);
    if (!match) {
      throw new NotFoundError('Match not found');
    }

    const events = await scoringEventRepository.findByMatch(matchId);
    return events;
  }

  async validateIdempotency(clientEventId) {
    const existing = await scoringEventRepository.findByClientEventId(clientEventId);
    if (existing) {
      return { isValid: false, existingEvent: existing };
    }
    return { isValid: true };
  }

  async createCompensationEvent(compensationData, userId) {
    const { match_id, event_type, team_id, player_id, minute, original_event_id, is_compensation, correction_reason, metadata } = compensationData;

    const match = await matchRepository.findById(match_id);
    const eventId = generateUUID();

    const [maxSeq] = await db.query(
      'SELECT COALESCE(MAX(sequence_number), 0) + 1 as next_seq FROM scoring_events WHERE match_id = ?',
      [match_id]
    );

    const [periods] = await db.query(
      `SELECT period_type FROM match_periods WHERE match_id = ? AND status = 'in_progress' ORDER BY period_number DESC LIMIT 1`,
      [match_id]
    );
    const periodType = periods[0]?.period_type || 'first_half';

    await db.query(
      `INSERT INTO scoring_events (id, match_id, organization_id, event_type, team_id, player_id, minute, period_type, original_event_id, is_compensation, correction_reason, metadata, created_by, created_at, sequence_number)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, ?, ?, ?, NOW(), ?)`,
      [eventId, match_id, match.organization_id, event_type, team_id, player_id, minute, periodType, original_event_id, correction_reason, JSON.stringify(metadata || {}), userId, maxSeq[0].next_seq]
    );

    const previousScore = await this.aggregateScore(match_id);
    const newScore = await this.aggregateScore(match_id);

    if (previousScore.home !== newScore.home || previousScore.away !== newScore.away) {
      await matchRepository.update(match_id, {
        home_score: newScore.home,
        away_score: newScore.away
      });
    }

    await this.createSnapshot(match_id, newScore, maxSeq[0].next_seq);

    logger.info('Compensation event created', { matchId: match_id, eventId, originalEventId: original_event_id });

    return eventId;
  }
}

export default new ScoringService();