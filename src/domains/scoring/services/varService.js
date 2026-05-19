import db from '../../../infrastructure/postgres/index.js';
import scoringService from './scoringService.js';
import matchRepository from '../../matches/repositories/matchRepository.js';
import { NotFoundError, ValidationError, ConflictError } from '../../../core/errors/index.js';
import { generateUUID } from '../../../core/utils/index.js';
import logger from '../../../core/logger/index.js';
import ws from '../../../core/websocket/index.js';

const VAR_STATUS = {
  PENDING: 'pending',
  CHECK_INITIATED: 'check_initiated',
  IN_PROGRESS: 'in_progress',
  DECISION_PENDING: 'decision_pending',
  COMPLETED: 'completed'
};

const VAR_DECISIONS = {
  CONFIRMED: 'confirmed',
  OVERTURNED: 'overturned',
  CHANGED_TO_PENALTY: 'changed_to_penalty',
  CHANGED_TO_FREE_KICK: 'changed_to_free_kick',
  NO_GOAL: 'no_goal',
  NO_PENALTY: 'no_penalty',
  NO_RED_CARD: 'no_red_card'
};

const REVIEW_TYPES = {
  GOAL: 'goal',
  PENALTY: 'penalty',
  RED_CARD: 'red_card',
  GOAL_DENIAL: 'goal_denial',
  OTHER: 'other'
};

export class VarService {
  async initiateReview(matchId, reviewType, originalEventId, originalDecision, userId) {
    const match = await matchRepository.findById(matchId);
    if (!match) {
      throw new NotFoundError('Match not found');
    }

    if (!['live', 'halftime'].includes(match.status)) {
      throw new ValidationError('VAR review only available during live match');
    }

    const originalEvent = await this.getEventById(originalEventId);
    if (!originalEvent) {
      throw new NotFoundError('Original event not found');
    }

    const activeReview = await this.getActiveReview(matchId);
    if (activeReview) {
      throw new ValidationError('VAR review already in progress');
    }

    const reviewId = generateUUID();

    await db.query(
      `INSERT INTO var_reviews (id, match_id, organization_id, review_type, status, original_event_id, original_event_type, original_decision, check_initiated_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)`,
      [reviewId, matchId, match.organization_id, reviewType, VAR_STATUS.CHECK_INITIATED, originalEventId, originalEvent.event_type, originalDecision, userId]
    );

    ws.emitToMatch(matchId, 'var:review_initiated', {
      matchId,
      reviewId,
      reviewType,
      originalEventId,
      timestamp: new Date().toISOString()
    });

    logger.info('VAR review initiated', { matchId, reviewId, reviewType, originalEventId });

    return { reviewId, status: VAR_STATUS.CHECK_INITIATED };
  }

  async updateReviewStatus(reviewId, status, userId) {
    const review = await this.getReviewById(reviewId);
    if (!review) {
      throw new NotFoundError('VAR review not found');
    }

    const validTransitions = {
      [VAR_STATUS.CHECK_INITIATED]: [VAR_STATUS.IN_PROGRESS],
      [VAR_STATUS.IN_PROGRESS]: [VAR_STATUS.DECISION_PENDING],
      [VAR_STATUS.DECISION_PENDING]: [VAR_STATUS.COMPLETED]
    };

    if (!validTransitions[review.status]?.includes(status)) {
      throw new ValidationError(`Cannot transition from ${review.status} to ${status}`);
    }

    const updateFields = {
      [VAR_STATUS.IN_PROGRESS]: 'check_initiated_at = COALESCE(check_initiated_at, NOW())',
      [VAR_STATUS.COMPLETED]: 'decision_made_at = NOW()'
    };

    await db.query(
      `UPDATE var_reviews SET status = ?, ${updateFields[status] || ''}, updated_at = NOW() WHERE id = ?`,
      [status, reviewId]
    );

    ws.emitToMatch(review.match_id, 'var:status_update', {
      reviewId,
      status,
      timestamp: new Date().toISOString()
    });

    logger.info('VAR review status updated', { reviewId, newStatus: status });

    return { reviewId, status };
  }

  async makeDecision(reviewId, decision, varReason, userId) {
    const review = await this.getReviewById(reviewId);
    if (!review) {
      throw new NotFoundError('VAR review not found');
    }

    if (review.status !== VAR_STATUS.DECISION_PENDING) {
      throw new ValidationError('VAR review must be in decision_pending state');
    }

    const validDecisions = Object.values(VAR_DECISIONS);
    if (!validDecisions.includes(decision)) {
      throw new ValidationError('Invalid VAR decision');
    }

    await db.query(
      `UPDATE var_reviews SET status = ?, final_decision = ?, var_reason = ?, decision_made_at = NOW(), check_duration_seconds = TIMESTAMPDIFF(SECOND, check_initiated_at, NOW()), updated_at = NOW() WHERE id = ?`,
      [VAR_STATUS.COMPLETED, decision, varReason, reviewId]
    );

    await this.applyDecision(review, decision, userId);

    ws.emitToMatch(review.match_id, 'var:decision', {
      reviewId,
      decision,
      varReason,
      originalEventId: review.original_event_id,
      timestamp: new Date().toISOString()
    });

    logger.info('VAR decision made', { reviewId, decision, varReason });

    return { reviewId, decision, varReason };
  }

  async applyDecision(review, decision, userId) {
    const { CONFIRMED, OVERTURNED, NO_GOAL, NO_PENALTY, NO_RED_CARD } = VAR_DECISIONS;

    if ([CONFIRMED, NO_RED_CARD].includes(decision)) {
      logger.info('VAR decision: no change to original event', { reviewId: review.id, decision });
      return;
    }

    const originalEvent = await this.getEventById(review.original_event_id);
    if (!originalEvent) {
      throw new NotFoundError('Original event not found for VAR reversal');
    }

    if ([OVERTURNED, NO_GOAL].includes(decision)) {
      await this.reverseGoalEvent(review.original_event_id, review.id, userId, decision);
    } else if (decision === NO_PENALTY) {
      await this.reversePenaltyEvent(review.original_event_id, review.id, userId);
    }

    logger.info('VAR decision applied', { reviewId: review.id, decision, originalEventId: review.original_event_id });
  }

  async reverseGoalEvent(eventId, varReviewId, userId, decision) {
    const event = await this.getEventById(eventId);
    if (!event) return;

    if (event.event_type !== 'goal' && event.event_type !== 'penalty') {
      throw new ValidationError('VAR reversal only applies to goal events');
    }

    const compensationId = generateUUID();

    const compensationEvent = {
      match_id: event.match_id,
      event_type: 'var_reversal',
      team_id: event.team_id,
      player_id: event.player_id,
      minute: event.minute,
      original_event_id: eventId,
      is_compensation: true,
      correction_reason: `VAR ${decision}`,
      metadata: {
        var_review_id: varReviewId,
        original_event_type: event.event_type,
        var_decision: decision
      }
    };

    const scoringService = require('./scoringService.js').default;
    await scoringService.createCompensationEvent(compensationEvent, userId);

    await db.query(
      `INSERT INTO event_corrections (id, match_id, original_event_id, correction_type, previous_value, new_value, reason, var_review_id, corrected_by)
       VALUES (?, ?, ?, 'var_reversal', ?, ?, ?, ?, ?)`,
      [
        generateUUID(),
        event.match_id,
        eventId,
        JSON.stringify({ event_type: event.event_type, score_change: -1 }),
        JSON.stringify({ event_type: 'var_reversal', score_change: -1 }),
        `VAR ${decision}`,
        varReviewId,
        userId
      ]
    );

    logger.info('Goal reversed due to VAR', { eventId, varReviewId, decision });
  }

  async reversePenaltyEvent(eventId, varReviewId, userId) {
    const event = await this.getEventById(eventId);
    if (!event) return;

    const compensationId = generateUUID();

    const compensationEvent = {
      match_id: event.match_id,
      event_type: 'var_reversal',
      team_id: event.team_id,
      player_id: event.player_id,
      minute: event.minute,
      original_event_id: eventId,
      is_compensation: true,
      correction_reason: 'VAR: penalty cancelled',
      metadata: {
        var_review_id: varReviewId,
        original_event_type: event.event_type
      }
    };

    const scoringService = require('./scoringService.js').default;
    await scoringService.createCompensationEvent(compensationEvent, userId);

    await db.query(
      `INSERT INTO event_corrections (id, match_id, original_event_id, correction_type, previous_value, new_value, reason, var_review_id, corrected_by)
       VALUES (?, ?, ?, 'var_reversal', ?, ?, ?, ?, ?)`,
      [
        generateUUID(),
        event.match_id,
        eventId,
        JSON.stringify({ event_type: 'penalty', score_change: 1 }),
        JSON.stringify({ event_type: 'var_reversal', score_change: -1 }),
        'VAR: penalty cancelled',
        varReviewId,
        userId
      ]
    );

    logger.info('Penalty reversed due to VAR', { eventId, varReviewId });
  }

  async getActiveReview(matchId) {
    const [reviews] = await db.query(
      `SELECT * FROM var_reviews WHERE match_id = ? AND status != 'completed' ORDER BY created_at DESC LIMIT 1`,
      [matchId]
    );
    return reviews[0] || null;
  }

  async getReviewById(reviewId) {
    const [reviews] = await db.query(
      `SELECT * FROM var_reviews WHERE id = ?`,
      [reviewId]
    );
    return reviews[0] || null;
  }

  async getEventById(eventId) {
    const [events] = await db.query(
      `SELECT * FROM scoring_events WHERE id = ?`,
      [eventId]
    );
    return events[0] || null;
  }

  async getMatchReviews(matchId) {
    const [reviews] = await db.query(
      `SELECT * FROM var_reviews WHERE match_id = ? ORDER BY created_at DESC`,
      [matchId]
    );
    return reviews;
  }

  async getReviewStats(matchId) {
    const [stats] = await db.query(
      `SELECT 
         COUNT(*) as total_reviews,
         SUM(CASE WHEN final_decision = 'confirmed' THEN 1 ELSE 0 END) as confirmed,
         SUM(CASE WHEN final_decision = 'overturned' THEN 1 ELSE 0 END) as overturned,
         SUM(CASE WHEN final_decision = 'no_goal' THEN 1 ELSE 0 END) as no_goal,
         SUM(CASE WHEN final_decision = 'no_penalty' THEN 1 ELSE 0 END) as no_penalty,
         AVG(check_duration_seconds) as avg_review_time
       FROM var_reviews WHERE match_id = ? AND status = 'completed'`,
      [matchId]
    );
    return stats[0];
  }
}

export default new VarService();