import db from '../../../infrastructure/postgres/index.js';
import scoringEventRepository from '../repositories/scoringEventRepository.js';
import matchRepository from '../../matches/repositories/matchRepository.js';
import { NotFoundError, ValidationError, ConflictError } from '../../../core/errors/index.js';
import { generateUUID } from '../../../core/utils/index.js';
import logger from '../../../core/logger/index.js';
import ws from '../../../core/websocket/index.js';

const CORRECTION_TYPES = {
  UNDO: 'undo',
  EDIT: 'edit',
  COMPENSATION: 'compensation',
  VAR_REVERSAL: 'var_reversal'
};

export class EventCorrectionService {
  async undoEvent(eventId, userId, reason, justification = null) {
    const event = await scoringEventRepository.findById(eventId);
    if (!event) {
      throw new NotFoundError('Event not found');
    }

    if (event.is_reversed) {
      throw new ValidationError('Event already reversed');
    }

    const match = await matchRepository.findById(event.match_id);
    if (!['live', 'halftime', 'completed'].includes(match.status)) {
      throw new ValidationError('Cannot undo events in current match state');
    }

    if (match.status === 'completed' && !justification) {
      throw new ValidationError('Justification required for undoing completed match events');
    }

    const previousScore = await this.computeScore(event.match_id);

    await scoringEventRepository.reverse(eventId, userId);

    const newScore = await this.computeScore(event.match_id);

    await matchRepository.update(event.match_id, {
      home_score: newScore.home,
      away_score: newScore.away
    });

    await this.createCorrectionRecord({
      matchId: event.match_id,
      originalEventId: eventId,
      correctionType: CORRECTION_TYPES.UNDO,
      previousValue: { event_type: event.event_type, team_id: event.team_id, player_id: event.player_id, minute: event.minute },
      newValue: { is_reversed: true },
      reason,
      justification,
      correctedBy: userId
    });

    ws.emitToMatch(event.match_id, 'scoring:event_undone', {
      matchId: event.match_id,
      eventId,
      reason,
      justification,
      previousScore,
      newScore,
      timestamp: new Date().toISOString()
    });

    logger.info('Event undone with audit trail', { matchId: event.match_id, eventId, reason, userId });

    return {
      success: true,
      eventId,
      previousScore,
      newScore,
      correctionRecord: true
    };
  }

  async correctEvent(eventId, correctionData, userId) {
    const event = await scoringEventRepository.findById(eventId);
    if (!event) {
      throw new NotFoundError('Event not found');
    }

    if (event.is_reversed) {
      throw new ValidationError('Cannot edit reversed event');
    }

    const editableFields = ['player_id', 'team_id', 'minute', 'metadata', 'reason'];
    const fieldsToUpdate = {};
    const previousValues = {};

    for (const field of editableFields) {
      if (correctionData[field] !== undefined && correctionData[field] !== event[field]) {
        fieldsToUpdate[field] = correctionData[field];
        previousValues[field] = event[field];
      }
    }

    if (Object.keys(fieldsToUpdate).length === 0) {
      throw new ValidationError('No fields to update');
    }

    if (fieldsToUpdate.metadata) {
      fieldsToUpdate.metadata = JSON.stringify({
        ...event.metadata,
        ...fieldsToUpdate.metadata,
        _corrected_at: new Date().toISOString(),
        _corrected_by: userId
      });
    }

    const previousScore = await this.computeScore(event.match_id);

    await scoringEventRepository.update(eventId, fieldsToUpdate);

    const newScore = await this.computeScore(event.match_id);

    if (previousScore.home !== newScore.home || previousScore.away !== newScore.away) {
      await matchRepository.update(event.match_id, {
        home_score: newScore.home,
        away_score: newScore.away
      });
    }

    await this.createCorrectionRecord({
      matchId: event.match_id,
      originalEventId: eventId,
      correctionType: CORRECTION_TYPES.EDIT,
      previousValue: previousValues,
      newValue: fieldsToUpdate,
      reason: correctionData.reason || 'Manual correction',
      justification: correctionData.justification,
      correctedBy: userId
    });

    ws.emitToMatch(event.match_id, 'scoring:event_corrected', {
      matchId: event.match_id,
      eventId,
      changes: fieldsToUpdate,
      previousValues,
      previousScore,
      newScore,
      timestamp: new Date().toISOString()
    });

    logger.info('Event corrected with audit trail', { matchId: event.match_id, eventId, changes: fieldsToUpdate, userId });

    return {
      success: true,
      eventId,
      previousScore,
      newScore,
      changes: fieldsToUpdate
    };
  }

  async createCompensationEvent(compensationData, userId) {
    const { match_id, event_type, team_id, player_id, minute, original_event_id, is_compensation, correction_reason, metadata } = compensationData;

    const eventId = generateUUID();

    await db.query(
      `INSERT INTO scoring_events (id, match_id, organization_id, event_type, team_id, player_id, minute, original_event_id, is_compensation, correction_reason, metadata, created_by, created_at, sequence_number)
       SELECT ?, ?, organization_id, ?, ?, ?, ?, ?, TRUE, ?, ?, ?, NOW(), COALESCE(MAX(sequence_number), 0) + 1 FROM scoring_events WHERE match_id = ?`,
      [eventId, match_id, event_type, team_id, player_id, minute, original_event_id, correction_reason, JSON.stringify(metadata || {}), userId, match_id]
    );

    const previousScore = await this.computeScore(match_id);
    const newScore = await this.computeScore(match_id);

    if (previousScore.home !== newScore.home || previousScore.away !== newScore.away) {
      await matchRepository.update(match_id, {
        home_score: newScore.home,
        away_score: newScore.away
      });
    }

    await this.createCorrectionRecord({
      matchId: match_id,
      originalEventId: original_event_id,
      correctionType: is_compensation ? CORRECTION_TYPES.COMPENSATION : CORRECTION_TYPES.VAR_REVERSAL,
      previousValue: { event_type, team_id, player_id, minute },
      newValue: { compensation_event_id: eventId },
      reason: correction_reason,
      correctedBy: userId
    });

    logger.info('Compensation event created', { matchId: match_id, eventId, originalEventId: original_event_id, type: compensationData.event_type });

    return eventId;
  }

  async createCorrectionRecord(data) {
    const { matchId, originalEventId, correctionType, previousValue, newValue, reason, justification, correctedBy, varReviewId } = data;

    const id = generateUUID();

    await db.query(
      `INSERT INTO event_corrections (id, match_id, original_event_id, correction_type, previous_value, new_value, reason, justification, var_review_id, corrected_by, corrected_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [id, matchId, originalEventId, correctionType, JSON.stringify(previousValue), JSON.stringify(newValue), reason, justification, varReviewId, correctedBy]
    );

    return id;
  }

  async computeScore(matchId) {
    const match = await matchRepository.findById(matchId);
    if (!match) return { home: 0, away: 0 };

    const events = await scoringEventRepository.findByMatch(matchId);
    const homeTeamId = match.home_team_id;
    const awayTeamId = match.away_team_id;

    let homeScore = 0;
    let awayScore = 0;

    for (const event of events) {
      if (event.is_reversed) continue;
      if (event.is_compensation) {
        if (event.event_type === 'var_reversal' || event.event_type === 'goal_revoked') {
          if (event.team_id === homeTeamId) {
            awayScore += 1;
          } else if (event.team_id === awayTeamId) {
            homeScore += 1;
          }
        }
        continue;
      }

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

  async getCorrections(matchId, options = {}) {
    const limit = options.limit || 50;
    const offset = options.offset || 0;

    const [corrections] = await db.query(
      `SELECT ec.*, u.first_name as corrected_by_first, u.last_name as corrected_by_last
       FROM event_corrections ec
       LEFT JOIN users u ON ec.corrected_by = u.id
       WHERE ec.match_id = ?
       ORDER BY ec.corrected_at DESC
       LIMIT ? OFFSET ?`,
      [matchId, limit, offset]
    );

    return corrections;
  }

  async getCorrectionByEvent(eventId) {
    const [corrections] = await db.query(
      `SELECT * FROM event_corrections WHERE original_event_id = ? ORDER BY corrected_at DESC`,
      [eventId]
    );
    return corrections;
  }

  async canUndo(matchId, eventId) {
    const match = await matchRepository.findById(matchId);
    if (!match) {
      return { canUndo: false, reason: 'Match not found' };
    }

    if (match.status !== 'live' && match.status !== 'halftime' && match.status !== 'completed') {
      return { canUndo: false, reason: `Cannot undo in ${match.status} state` };
    }

    const event = await scoringEventRepository.findById(eventId);
    if (!event) {
      return { canUndo: false, reason: 'Event not found' };
    }

    if (event.is_reversed) {
      return { canUndo: false, reason: 'Event already reversed' };
    }

    const laterEvents = await db.query(
      `SELECT COUNT(*) as count FROM scoring_events WHERE match_id = ? AND sequence_number > ? AND is_reversed = FALSE`,
      [matchId, event.sequence_number]
    );

    if (laterEvents[0].count > 0 && match.status === 'completed') {
      return { canUndo: false, reason: 'Cannot undo - events exist after this in completed match' };
    }

    return { canUndo: true };
  }
}

export default new EventCorrectionService();