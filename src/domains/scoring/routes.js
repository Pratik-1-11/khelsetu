import { Router } from 'express';
import { body, param, validationResult } from 'express-validator';
import scoringService from './services/scoringService.js';
import { CricketScoringService } from './services/CricketScoringService.js';
import cricketRoutes from './cricketRoutes.js';
import footballRoutes from './footballRoutes.js';
import { authMiddleware } from '../../core/auth/jwt.js';
import { asyncHandler, ValidationError } from '../../core/errors/index.js';
import { addRoute } from '../../docs/swagger.js';

const router = Router({ mergeParams: true });

router.use('/cricket', cricketRoutes);
router.use('/football', footballRoutes);

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new ValidationError('Validation failed', errors.array());
  }
  next();
};

router.post(
  '/events',
  authMiddleware,
  [
    body('event_type').notEmpty().withMessage('Event type is required'),
    body('team_id').optional().isUUID(),
    body('player_id').optional().isUUID(),
    body('minute').optional().isInt({ min: 0, max: 120 }),
    body('client_event_id').optional().isString(),
    body('metadata').optional().isObject()
  ],
  validate,
  asyncHandler(async (req, res) => {
    const result = await scoringService.addEvent(req.params.matchId, req.user.userId, req.body);
    if (result.isDuplicate) {
      return res.status(200).json({ success: true, data: result.event, message: 'Duplicate event, returning existing' });
    }
    res.status(201).json({ success: true, data: result.event });
  })
);

addRoute('/scoring/matches/{matchId}/events', 'post', {
  summary: 'Add scoring event',
  tags: ['Scoring'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['event_type'],
          properties: {
            event_type: { type: 'string', description: 'goal, penalty, yellow_card, red_card, etc.' },
            team_id: { type: 'string' },
            player_id: { type: 'string' },
            minute: { type: 'integer' },
            client_event_id: { type: 'string', description: 'For idempotency' },
            metadata: { type: 'object' }
          }
        }
      }
    }
  },
  responses: { 201: { description: 'Event added' } }
});

router.post(
  '/events/:eventId/undo',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const result = await scoringService.undoEvent(req.params.eventId, req.user.userId);
    res.json({ success: true, data: result });
  })
);

addRoute('/scoring/events/{eventId}/undo', 'post', {
  summary: 'Undo scoring event',
  tags: ['Scoring'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Event undone' } }
});

router.get('/matches/:matchId/history', authMiddleware, asyncHandler(async (req, res) => {
  const history = await scoringService.getMatchHistory(req.params.matchId, req.user.userId);
  res.json({ success: true, data: history });
}));

addRoute('/scoring/matches/{matchId}/history', 'get', {
  summary: 'Get match scoring history',
  tags: ['Scoring'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Match history with events' } }
});

router.get('/matches/:matchId/snapshot', authMiddleware, asyncHandler(async (req, res) => {
  const snapshot = await scoringService.getSnapshot(req.params.matchId, req.query.sequence_number ? parseInt(req.query.sequence_number) : null);
  res.json({ success: true, data: snapshot });
}));

addRoute('/scoring/matches/{matchId}/snapshot', 'get', {
  summary: 'Get score snapshot',
  tags: ['Scoring'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Current score snapshot' } }
});

router.post('/snapshots/:snapshotId/replay', authMiddleware, asyncHandler(async (req, res) => {
  const result = await scoringService.replayFromSnapshot(req.params.matchId, req.params.snapshotId, req.user.userId);
  res.json({ success: true, data: result });
}));

addRoute('/scoring/snapshots/{snapshotId}/replay', 'post', {
  summary: 'Replay score from snapshot',
  tags: ['Scoring'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Score replayed' } }
});

router.get('/matches/:matchId/events', authMiddleware, asyncHandler(async (req, res) => {
  const events = await scoringService.getMatchEvents(req.params.matchId, req.user.userId);
  res.json({ success: true, data: events });
}));

addRoute('/scoring/matches/{matchId}/events', 'get', {
  summary: 'Get match events',
  tags: ['Scoring'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'List of events' } }
});

router.post('/validate', authMiddleware, [body('client_event_id').notEmpty()], validate, asyncHandler(async (req, res) => {
  const result = await scoringService.validateIdempotency(req.body.client_event_id);
  res.json({ success: true, data: result });
}));

addRoute('/scoring/validate', 'post', {
  summary: 'Validate idempotency',
  tags: ['Scoring'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Idempotency check result' } }
});

export default router;