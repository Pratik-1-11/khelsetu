/**
 * Cricket Scoring API Routes
 * Production-Grade Event-Driven Endpoints
 */

import { Router } from 'express';
import { body, param, validationResult } from 'express-validator';
import { CricketScoringService } from './services/CricketScoringService.js';
import { authMiddleware } from '../../core/auth/jwt.js';
import { asyncHandler, ValidationError } from '../../core/errors/index.js';
import { addRoute } from '../../docs/swagger.js';

const router = Router({ mergeParams: true });

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new ValidationError('Validation failed', errors.array());
  }
  next();
};

router.post(
  '/innings/start',
  authMiddleware,
  [
    body('innings_number').isInt({ min: 1, max: 4 }).withMessage('Innings number required'),
    body('batting_team_id').isUUID().withMessage('Batting team ID required'),
    body('bowling_team_id').isUUID().withMessage('Bowling team ID required')
  ],
  validate,
  asyncHandler(async (req, res) => {
    const result = await CricketScoringService.startInnings(
      req.params.matchId,
      req.user.userId,
      req.body.innings_number,
      req.body.batting_team_id,
      req.body.bowling_team_id
    );
    res.status(201).json({ success: true, data: result });
  })
);

addRoute('/scoring/matches/{matchId}/innings/start', 'post', {
  summary: 'Start innings',
  tags: ['Cricket Scoring'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['innings_number', 'batting_team_id', 'bowling_team_id'],
          properties: {
            innings_number: { type: 'integer' },
            batting_team_id: { type: 'string' },
            bowling_team_id: { type: 'string' }
          }
        }
      }
    }
  },
  responses: { 201: { description: 'Innings started' } }
});

router.post(
  '/deliveries',
  authMiddleware,
  [
    body('delivery_type').isIn(['legal', 'no_ball', 'wide']).withMessage('Valid delivery type required'),
    body('bowler_id').isUUID().withMessage('Bowler ID required'),
    body('striker_id').isUUID().withMessage('Striker ID required'),
    body('non_striker_id').isUUID().withMessage('Non-striker ID required'),
    body('batter_runs').optional().isInt({ min: 0, max: 10 }),
    body('extra_runs').optional().isInt({ min: 0 }),
    body('overthrow_runs').optional().isInt({ min: 0 }),
    body('bye_runs').optional().isInt({ min: 0 }),
    body('leg_bye_runs').optional().isInt({ min: 0 }),
    body('penalty_runs').optional().isInt({ min: 0 }),
    body('is_bye').optional().isBoolean(),
    body('is_leg_bye').optional().isBoolean(),
    body('is_free_hit').optional().isBoolean(),
    body('is_overthrow').optional().isBoolean(),
    body('is_boundary').optional().isBoolean(),
    body('wicket').optional().isBoolean(),
    body('wicket_type').optional().isIn(['bowled', 'caught', 'caught_behind', 'lbw', 'stumped', 'run_out', 'hit_wicket', 'obstructing_field', 'timed_out', 'retired_hurt', 'retired_out', 'handled_ball', 'none']),
    body('fielder_id').optional().isUUID(),
    body('striker_end').optional().isIn(['pitch', 'non_pitch']),
    body('client_event_id').optional().isString()
  ],
  validate,
  asyncHandler(async (req, res) => {
    if (req.body.client_event_id) {
      const idempotency = await CricketScoringService.validateIdempotency(req.body.client_event_id);
      if (!idempotency.isValid) {
        return res.status(200).json({ success: true, data: idempotency.existingDelivery, message: 'Duplicate delivery' });
      }
    }

    const result = await CricketScoringService.addDelivery(req.params.matchId, req.user.userId, {
      ...req.body,
      match_id: req.params.matchId
    });
    res.status(201).json({ success: true, data: result });
  })
);

addRoute('/scoring/matches/{matchId}/deliveries', 'post', {
  summary: 'Add cricket delivery',
  tags: ['Cricket Scoring'],
  security: [{ bearerAuth: [] }],
  description: 'Add a ball-by-ball delivery event. This is the core of event-driven cricket scoring.',
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['delivery_type', 'bowler_id', 'striker_id', 'non_striker_id'],
          properties: {
            delivery_type: { type: 'string', enum: ['legal', 'no_ball', 'wide'] },
            bowler_id: { type: 'string' },
            striker_id: { type: 'string' },
            non_striker_id: { type: 'string' },
            batter_runs: { type: 'integer' },
            extra_runs: { type: 'integer' },
            overthrow_runs: { type: 'integer' },
            bye_runs: { type: 'integer' },
            leg_bye_runs: { type: 'integer' },
            penalty_runs: { type: 'integer' },
            is_bye: { type: 'boolean' },
            is_leg_bye: { type: 'boolean' },
            is_free_hit: { type: 'boolean' },
            is_overthrow: { type: 'boolean' },
            is_boundary: { type: 'boolean' },
            wicket: { type: 'boolean' },
            wicket_type: { type: 'string' },
            fielder_id: { type: 'string' },
            striker_end: { type: 'string', enum: ['pitch', 'non_pitch'] },
            client_event_id: { type: 'string' }
          }
        },
        example: {
          delivery_type: 'legal',
          bowler_id: 'uuid-1',
          striker_id: 'uuid-2',
          non_striker_id: 'uuid-3',
          batter_runs: 4,
          is_boundary: true,
          striker_end: 'pitch'
        }
      }
    }
  },
  responses: { 201: { description: 'Delivery added' } }
});

router.post(
  '/deliveries/:deliveryId/undo',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const result = await CricketScoringService.undoDelivery(
      req.params.matchId,
      req.params.deliveryId,
      req.user.userId
    );
    res.json({ success: true, data: result });
  })
);

addRoute('/scoring/matches/{matchId}/deliveries/{deliveryId}/undo', 'post', {
  summary: 'Undo delivery',
  tags: ['Cricket Scoring'],
  security: [{ bearerAuth: [] }],
  description: 'Reverse a delivery event. All statistics are recalculated.',
  responses: { 200: { description: 'Delivery undone' } }
});

router.get(
  '/innings/:inningsNumber',
  authMiddleware,
  [param('inningsNumber').isInt({ min: 1, max: 4 })],
  validate,
  asyncHandler(async (req, res) => {
    const stats = await CricketScoringService.getInningsStats(
      req.params.matchId,
      parseInt(req.params.inningsNumber)
    );
    res.json({ success: true, data: stats });
  })
);

addRoute('/scoring/matches/{matchId}/innings/{inningsNumber}', 'get', {
  summary: 'Get innings statistics',
  tags: ['Cricket Scoring'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Innings stats with batters, bowlers, partnerships' } }
});

router.get(
  '/replay/test',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const result = await CricketScoringService.testDeterministicReplay(req.params.matchId);
    res.json({ success: true, data: result });
  })
);

addRoute('/scoring/matches/{matchId}/replay/test', 'get', {
  summary: 'Test deterministic replay',
  tags: ['Cricket Scoring'],
  security: [{ bearerAuth: [] }],
  description: 'Verify that replaying all deliveries produces same result as live scoring',
  responses: { 200: { description: 'Replay test results' } }
});

router.get(
  '/history',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const connection = await (await import('../../infrastructure/postgres/index.js')).default.query(
      `SELECT * FROM cricket_deliveries WHERE match_id = ? ORDER BY sequence_number`,
      [req.params.matchId]
    );
    res.json({ success: true, data: connection });
  })
);

addRoute('/scoring/matches/{matchId}/history', 'get', {
  summary: 'Get delivery history',
  tags: ['Cricket Scoring'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'All deliveries' } }
});

router.post(
  '/super-over/start',
  authMiddleware,
  [
    body('team1_id').isUUID().withMessage('Team 1 ID required'),
    body('team2_id').isUUID().withMessage('Team 2 ID required')
  ],
  validate,
  asyncHandler(async (req, res) => {
    const result = await CricketScoringService.initializeSuperOver(
      req.params.matchId,
      req.body.team1_id,
      req.body.team2_id
    );
    res.status(201).json({ success: true, data: result });
  })
);

addRoute('/scoring/matches/{matchId}/super-over/start', 'post', {
  summary: 'Start super over',
  tags: ['Cricket Super Over'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['team1_id', 'team2_id'],
          properties: {
            team1_id: { type: 'string', format: 'uuid' },
            team2_id: { type: 'string', format: 'uuid' }
          }
        }
      }
    }
  },
  responses: { 201: { description: 'Super over started' } }
});

router.post(
  '/super-over/deliveries',
  authMiddleware,
  [
    body('super_over_id').isUUID().withMessage('Super over ID required'),
    body('batting_team_id').isUUID().withMessage('Batting team ID required'),
    body('delivery_type').isIn(['legal', 'no_ball', 'wide']).withMessage('Valid delivery type required'),
    body('bowler_id').isUUID().withMessage('Bowler ID required'),
    body('striker_id').isUUID().withMessage('Striker ID required'),
    body('non_striker_id').isUUID().withMessage('Non-striker ID required'),
    body('batter_runs').optional().isInt({ min: 0, max: 10 })
  ],
  validate,
  asyncHandler(async (req, res) => {
    const result = await CricketScoringService.addSuperOverDelivery(
      req.body.super_over_id,
      req.body.batting_team_id,
      { ...req.body, match_id: req.params.matchId }
    );
    res.status(201).json({ success: true, data: result });
  })
);

addRoute('/scoring/matches/{matchId}/super-over/deliveries', 'post', {
  summary: 'Add super over delivery',
  tags: ['Cricket Super Over'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['super_over_id', 'batting_team_id', 'delivery_type', 'bowler_id', 'striker_id', 'non_striker_id'],
          properties: {
            super_over_id: { type: 'string', format: 'uuid' },
            batting_team_id: { type: 'string', format: 'uuid' },
            delivery_type: { type: 'string', enum: ['legal', 'no_ball', 'wide'] },
            bowler_id: { type: 'string', format: 'uuid' },
            striker_id: { type: 'string', format: 'uuid' },
            non_striker_id: { type: 'string', format: 'uuid' },
            batter_runs: { type: 'integer' }
          }
        }
      }
    }
  },
  responses: { 201: { description: 'Super over delivery added' } }
});

router.post(
  '/super-over/complete',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const result = await CricketScoringService.completeSuperOver(req.params.matchId);
    res.json({ success: true, data: result });
  })
);

addRoute('/scoring/matches/{matchId}/super-over/complete', 'post', {
  summary: 'Complete super over',
  tags: ['Cricket Super Over'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Super over completed' } }
});

router.post(
  '/reviews/initialize',
  authMiddleware,
  [
    body('max_reviews_per_innings').optional().isInt({ min: 1, max: 3 })
  ],
  validate,
  asyncHandler(async (req, res) => {
    const result = await CricketScoringService.initializeReviewConfig(
      req.params.matchId,
      req.body.max_reviews_per_innings || 1
    );
    res.status(201).json({ success: true, data: result });
  })
);

addRoute('/scoring/matches/{matchId}/reviews/initialize', 'post', {
  summary: 'Initialize DRS review system',
  tags: ['Cricket DRS'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            max_reviews_per_innings: { type: 'integer', minimum: 1, maximum: 3 }
          }
        }
      }
    }
  },
  responses: { 201: { description: 'DRS initialized' } }
});

router.post(
  '/reviews/request',
  authMiddleware,
  [
    body('team_id').isUUID().withMessage('Team ID required'),
    body('innings_number').isInt({ min: 1, max: 4 }).withMessage('Innings number required'),
    body('review_type').isIn(['lbw', 'caught', 'caught_behind', 'stumped', 'bowled', 'run_out', 'not_out']).withMessage('Valid review type required'),
    body('decision_original').isIn(['not_out', 'out']).withMessage('Original decision required'),
    body('batter_id').isUUID().withMessage('Batter ID required'),
    body('bowler_id').isUUID().withMessage('Bowler ID required'),
    body('ball_sequence_number').isInt({ min: 1 }).withMessage('Ball sequence number required'),
    body('over_number').isInt({ min: 1 }).withMessage('Over number required'),
    body('ball_in_over').isInt({ min: 1, max: 6 }).withMessage('Ball in over required')
  ],
  validate,
  asyncHandler(async (req, res) => {
    const result = await CricketScoringService.requestReview(
      req.params.matchId,
      req.body.team_id,
      { ...req.body, requested_by: req.user.userId }
    );
    res.status(201).json({ success: true, data: result });
  })
);

addRoute('/scoring/matches/{matchId}/reviews/request', 'post', {
  summary: 'Request DRS review',
  tags: ['Cricket DRS'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['team_id', 'innings_number', 'review_type', 'decision_original', 'batter_id', 'bowler_id', 'ball_sequence_number', 'over_number', 'ball_in_over'],
          properties: {
            team_id: { type: 'string', format: 'uuid' },
            innings_number: { type: 'integer', minimum: 1, maximum: 4 },
            review_type: { type: 'string', enum: ['lbw', 'caught', 'caught_behind', 'stumped', 'bowled', 'run_out', 'not_out'] },
            decision_original: { type: 'string', enum: ['not_out', 'out'] },
            batter_id: { type: 'string', format: 'uuid' },
            bowler_id: { type: 'string', format: 'uuid' },
            ball_sequence_number: { type: 'integer', minimum: 1 },
            over_number: { type: 'integer', minimum: 1 },
            ball_in_over: { type: 'integer', minimum: 1, maximum: 6 }
          }
        }
      }
    }
  },
  responses: { 201: { description: 'Review requested' } }
});

router.put(
  '/reviews/:reviewId/decide',
  authMiddleware,
  [
    param('reviewId').isUUID().withMessage('Valid review ID required'),
    body('decision').isIn(['not_out', 'out', 'withdrawn']).withMessage('Valid decision required')
  ],
  validate,
  asyncHandler(async (req, res) => {
    const result = await CricketScoringService.processReviewDecision(
      req.params.reviewId,
      req.body.decision
    );
    res.json({ success: true, data: result });
  })
);

addRoute('/scoring/matches/{matchId}/reviews/{reviewId}/decide', 'put', {
  summary: 'Decide DRS review',
  tags: ['Cricket DRS'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['decision'],
          properties: {
            decision: { type: 'string', enum: ['not_out', 'out', 'withdrawn'] }
          }
        }
      }
    }
  },
  responses: { 200: { description: 'Review decided' } }
});

router.get(
  '/reviews',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const result = await CricketScoringService.getReviewStatus(req.params.matchId);
    res.json({ success: true, data: result });
  })
);

addRoute('/scoring/matches/{matchId}/reviews', 'get', {
  summary: 'Get DRS review status',
  tags: ['Cricket DRS'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Review status and config' } }
});

router.get(
  '/follow-on/check',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const result = await CricketScoringService.checkFollowOn(req.params.matchId);
    res.json({ success: true, data: result });
  })
);

addRoute('/scoring/matches/{matchId}/follow-on/check', 'get', {
  summary: 'Check follow-on eligibility',
  tags: ['Cricket Scoring'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Follow-on recommendation' } }
});

router.get(
  '/analytics',
  authMiddleware,
  [
    param('innings').optional().isInt({ min: 1, max: 4 })
  ],
  validate,
  asyncHandler(async (req, res) => {
    const result = await CricketScoringService.calculateMatchAnalytics(
      req.params.matchId,
      req.query.innings || 1
    );
    res.json({ success: true, data: result });
  })
);

addRoute('/scoring/matches/{matchId}/analytics', 'get', {
  summary: 'Get match analytics',
  tags: ['Cricket Scoring'],
  security: [{ bearerAuth: [] }],
  parameters: [{
    name: 'innings',
    in: 'query',
    schema: { type: 'integer', minimum: 1, maximum: 4 }
  }],
  responses: { 200: { description: 'Match analytics data' } }
});

export default router;