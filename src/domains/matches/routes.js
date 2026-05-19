import { Router } from 'express';
import { body, validationResult } from 'express-validator';
import matchService from './services/matchService.js';
import { authMiddleware } from '../../core/auth/jwt.js';
import { asyncHandler, ValidationError } from '../../core/errors/index.js';
import { addRoute } from '../../docs/swagger.js';

const router = Router();

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new ValidationError('Validation failed', errors.array());
  }
  next();
};

router.post(
  '/',
  authMiddleware,
  [
    body('tournament_id').isUUID().withMessage('Valid tournament ID required'),
    body('home_team_id').isUUID().withMessage('Valid home team ID required'),
    body('away_team_id').isUUID().withMessage('Valid away team ID required'),
    body('round_number').optional().isInt(),
    body('group_name').optional().trim(),
    body('venue').optional().trim(),
    body('scheduled_at').optional().isISO8601()
  ],
  validate,
  asyncHandler(async (req, res) => {
    const match = await matchService.create(req.body, req.user.userId);
    res.status(201).json({ success: true, data: match });
  })
);

addRoute('/matches', 'post', {
  summary: 'Create new match',
  tags: ['Matches'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['tournament_id', 'home_team_id', 'away_team_id'],
          properties: { tournament_id: { type: 'string' }, home_team_id: { type: 'string' }, away_team_id: { type: 'string' }, round_number: { type: 'integer' }, group_name: { type: 'string' }, venue: { type: 'string' }, scheduled_at: { type: 'string' } }
        }
      }
    }
  },
  responses: { 201: { description: 'Match created' } }
});

router.get('/tournament/:tournamentId', authMiddleware, asyncHandler(async (req, res) => {
  const result = await matchService.getByTournament(req.params.tournamentId, req.user.userId, { page: parseInt(req.query.page) || 1, limit: parseInt(req.query.limit) || 20, status: req.query.status, round_number: req.query.round_number, group_name: req.query.group_name });
  res.json({ success: true, data: result.data, pagination: result.pagination });
}));

addRoute('/matches/tournament/{tournamentId}', 'get', {
  summary: 'Get matches by tournament',
  tags: ['Matches'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'List of matches' } }
});

router.get('/:id', authMiddleware, asyncHandler(async (req, res) => {
  const match = await matchService.getById(req.params.id, req.user.userId);
  res.json({ success: true, data: match });
}));

addRoute('/matches/{id}', 'get', {
  summary: 'Get match by ID',
  tags: ['Matches'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Match details' } }
});

router.put('/:id', authMiddleware, asyncHandler(async (req, res) => {
  const match = await matchService.update(req.params.id, req.user.userId, req.body);
  res.json({ success: true, data: match });
}));

addRoute('/matches/{id}', 'put', {
  summary: 'Update match',
  tags: ['Matches'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Match updated' } }
});

router.delete('/:id', authMiddleware, asyncHandler(async (req, res) => {
  await matchService.delete(req.params.id, req.user.userId);
  res.json({ success: true, data: { message: 'Match deleted' } });
}));

addRoute('/matches/{id}', 'delete', {
  summary: 'Delete match',
  tags: ['Matches'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Match deleted' } }
});

router.post('/:id/start', authMiddleware, asyncHandler(async (req, res) => {
  const match = await matchService.startMatch(req.params.id, req.user.userId);
  res.json({ success: true, data: match });
}));

addRoute('/matches/{id}/start', 'post', {
  summary: 'Start match',
  tags: ['Matches'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Match started' } }
});

router.post(
  '/:id/end',
  authMiddleware,
  [body('home_score').optional().isInt(), body('away_score').optional().isInt(), body('winner_id').optional().isUUID()],
  validate,
  asyncHandler(async (req, res) => {
    const match = await matchService.endMatch(req.params.id, req.user.userId, req.body);
    res.json({ success: true, data: match });
  })
);

addRoute('/matches/{id}/end', 'post', {
  summary: 'End match',
  tags: ['Matches'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Match ended' } }
});

router.post(
  '/:id/score',
  authMiddleware,
  [body('home_score').isInt().withMessage('Home score is required'), body('away_score').isInt().withMessage('Away score is required')],
  validate,
  asyncHandler(async (req, res) => {
    const match = await matchService.updateScore(req.params.id, req.user.userId, req.body.home_score, req.body.away_score);
    res.json({ success: true, data: match });
  })
);

addRoute('/matches/{id}/score', 'post', {
  summary: 'Update match score',
  tags: ['Matches'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Score updated' } }
});

router.post(
  '/:id/officials',
  authMiddleware,
  [body('user_id').isUUID().withMessage('Valid user ID required'), body('role').isIn(['referee', 'umpire', 'linesman', 'judge'])],
  validate,
  asyncHandler(async (req, res) => {
    const official = await matchService.addOfficial(req.params.id, req.user.userId, req.body.user_id, req.body.role);
    res.status(201).json({ success: true, data: official });
  })
);

addRoute('/matches/{id}/officials', 'post', {
  summary: 'Add match official',
  tags: ['Matches'],
  security: [{ bearerAuth: [] }],
  responses: { 201: { description: 'Official added' } }
});

router.delete('/:id/officials/:userId', authMiddleware, asyncHandler(async (req, res) => {
  await matchService.removeOfficial(req.params.id, req.user.userId, req.params.userId);
  res.json({ success: true, data: { message: 'Official removed' } });
}));

addRoute('/matches/{id}/officials/{userId}', 'delete', {
  summary: 'Remove match official',
  tags: ['Matches'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Official removed' } }
});

router.get('/:id/officials', authMiddleware, asyncHandler(async (req, res) => {
  const officials = await matchService.getOfficials(req.params.id, req.user.userId);
  res.json({ success: true, data: officials });
}));

addRoute('/matches/{id}/officials', 'get', {
  summary: 'Get match officials',
  tags: ['Matches'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'List of officials' } }
});

router.get('/:id/with-period', authMiddleware, asyncHandler(async (req, res) => {
  const match = await matchService.getByIdWithPeriod(req.params.id, req.user.userId);
  res.json({ success: true, data: match });
}));

addRoute('/matches/{id}/with-period', 'get', {
  summary: 'Get match with period info',
  tags: ['Matches'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Match with current period and substitution status' } }
});

router.post(
  '/:id/period/transition',
  authMiddleware,
  [
    body('action').isIn(['start_first_half', 'end_first_half', 'start_second_half', 'end_second_half', 'start_extra_time', 'end_extra_time_first', 'start_extra_time_second', 'end_extra_time', 'start_penalties', 'end_match', 'abandon', 'suspend', 'resume']).withMessage('Valid action required'),
    body('injury_time').optional().isInt({ min: 0, max: 15 }),
    body('winner_id').optional().isUUID(),
    body('reason').optional().isString()
  ],
  validate,
  asyncHandler(async (req, res) => {
    const result = await matchService.transitionPeriod(req.params.id, req.user.userId, req.body.action, req.body);
    res.json({ success: true, data: result });
  })
);

addRoute('/matches/{id}/period/transition', 'post', {
  summary: 'Transition match period',
  tags: ['Matches'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['action'],
          properties: {
            action: { type: 'string', enum: ['start_first_half', 'end_first_half', 'start_second_half', 'end_second_half', 'start_extra_time', 'end_extra_time_first', 'start_extra_time_second', 'end_extra_time', 'start_penalties', 'end_match', 'abandon', 'suspend', 'resume'] },
            injury_time: { type: 'integer' },
            winner_id: { type: 'string' },
            reason: { type: 'string' }
          }
        }
      }
    }
  },
  responses: { 200: { description: 'Period transitioned' } }
});

router.post(
  '/:id/abandon',
  authMiddleware,
  [body('reason').isString().withMessage('Abandonment reason required')],
  validate,
  asyncHandler(async (req, res) => {
    const match = await matchService.abandonMatch(req.params.id, req.user.userId, req.body.reason);
    res.json({ success: true, data: match });
  })
);

addRoute('/matches/{id}/abandon', 'post', {
  summary: 'Abandon match',
  tags: ['Matches'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['reason'],
          properties: { reason: { type: 'string' } }
        }
      }
    }
  },
  responses: { 200: { description: 'Match abandoned' } }
});

router.post(
  '/:id/suspend',
  authMiddleware,
  [body('reason').isString().withMessage('Suspension reason required')],
  validate,
  asyncHandler(async (req, res) => {
    const match = await matchService.suspendMatch(req.params.id, req.user.userId, req.body.reason);
    res.json({ success: true, data: match });
  })
);

addRoute('/matches/{id}/suspend', 'post', {
  summary: 'Suspend match',
  tags: ['Matches'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['reason'],
          properties: { reason: { type: 'string' } }
        }
      }
    }
  },
  responses: { 200: { description: 'Match suspended' } }
});

router.post('/:id/resume', authMiddleware, asyncHandler(async (req, res) => {
  const match = await matchService.resumeMatch(req.params.id, req.user.userId);
  res.json({ success: true, data: match });
}));

addRoute('/matches/{id}/resume', 'post', {
  summary: 'Resume suspended match',
  tags: ['Matches'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Match resumed' } }
});

router.post(
  '/:id/postpone',
  authMiddleware,
  [
    body('new_date').isISO8601().withMessage('Valid new date required'),
    body('reason').isString().withMessage('Postponement reason required')
  ],
  validate,
  asyncHandler(async (req, res) => {
    const match = await matchService.postponeMatch(req.params.id, req.user.userId, req.body.new_date, req.body.reason);
    res.json({ success: true, data: match });
  })
);

addRoute('/matches/{id}/postpone', 'post', {
  summary: 'Postpone match',
  tags: ['Matches'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['new_date', 'reason'],
          properties: { new_date: { type: 'string' }, reason: { type: 'string' } }
        }
      }
    }
  },
  responses: { 200: { description: 'Match postponed' } }
});

export default router;