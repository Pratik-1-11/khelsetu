import { Router } from 'express';
import { body, param, validationResult } from 'express-validator';
import tournamentService from './services/tournamentService.js';
import fixtureService from './services/fixtureService.js';
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
  '/',
  authMiddleware,
  [
    body('organization_id').isUUID().withMessage('Valid organization ID required'),
    body('sport_id').isUUID().withMessage('Valid sport ID required'),
    body('name').notEmpty().trim().withMessage('Tournament name is required'),
    body('format').optional().isIn(['league', 'knockout', 'double_elimination', 'group_knockout']),
    body('start_date').optional().isISO8601(),
    body('end_date').optional().isISO8601()
  ],
  validate,
  asyncHandler(async (req, res) => {
    const tournament = await tournamentService.create(req.body, req.user.userId);
    res.status(201).json({ success: true, data: tournament });
  })
);

addRoute('/tournaments', 'post', {
  summary: 'Create new tournament',
  tags: ['Tournaments'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['organization_id', 'sport_id', 'name'],
          properties: { organization_id: { type: 'string' }, sport_id: { type: 'string' }, name: { type: 'string' }, format: { type: 'string' } }
        }
      }
    }
  },
  responses: { 201: { description: 'Tournament created' } }
});

router.get('/', authMiddleware, asyncHandler(async (req, res) => {
  const { organization_id, status } = req.query;
  if (!organization_id) {
    throw new ValidationError('organization_id is required');
  }
  const result = await tournamentService.getByOrganization(organization_id, req.user.userId, { page: parseInt(req.query.page) || 1, limit: parseInt(req.query.limit) || 20, status });
  res.json({ success: true, data: result.data, pagination: result.pagination });
}));

addRoute('/tournaments', 'get', {
  summary: 'Get tournaments by organization',
  tags: ['Tournaments'],
  security: [{ bearerAuth: [] }],
  parameters: [
    { name: 'organization_id', in: 'query', required: true, schema: { type: 'string' } },
    { name: 'status', in: 'query', schema: { type: 'string' } }
  ],
  responses: { 200: { description: 'List of tournaments' } }
});

router.get('/:id', authMiddleware, asyncHandler(async (req, res) => {
  const tournament = await tournamentService.getById(req.params.id, req.user.userId);
  res.json({ success: true, data: tournament });
}));

addRoute('/tournaments/{id}', 'get', {
  summary: 'Get tournament by ID',
  tags: ['Tournaments'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Tournament details' } }
});

router.put(
  '/:id',
  authMiddleware,
  [body('name').optional().trim(), body('status').optional().isIn(['draft', 'registration_open', 'in_progress', 'completed', 'cancelled'])],
  validate,
  asyncHandler(async (req, res) => {
    const tournament = await tournamentService.update(req.params.id, req.user.userId, req.body);
    res.json({ success: true, data: tournament });
  })
);

addRoute('/tournaments/{id}', 'put', {
  summary: 'Update tournament',
  tags: ['Tournaments'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Tournament updated' } }
});

router.delete('/:id', authMiddleware, asyncHandler(async (req, res) => {
  await tournamentService.delete(req.params.id, req.user.userId);
  res.json({ success: true, data: { message: 'Tournament deleted' } });
}));

addRoute('/tournaments/{id}', 'delete', {
  summary: 'Delete tournament',
  tags: ['Tournaments'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Tournament deleted' } }
});

router.post('/:id/status', authMiddleware, [body('status').isIn(['draft', 'registration_open', 'in_progress', 'completed', 'cancelled'])], validate, asyncHandler(async (req, res) => {
  const tournament = await tournamentService.updateStatus(req.params.id, req.user.userId, req.body.status);
  res.json({ success: true, data: tournament });
}));

addRoute('/tournaments/{id}/status', 'post', {
  summary: 'Update tournament status',
  tags: ['Tournaments'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Status updated' } }
});

router.get('/:id/teams', authMiddleware, asyncHandler(async (req, res) => {
  const teams = await tournamentService.getRegisteredTeams(req.params.id, req.user.userId);
  res.json({ success: true, data: teams });
}));

addRoute('/tournaments/{id}/teams', 'get', {
  summary: 'Get registered teams',
  tags: ['Tournaments'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'List of registered teams' } }
});

router.post('/:id/teams', authMiddleware, [body('team_id').isUUID(), body('seed_number').optional().isInt()], validate, asyncHandler(async (req, res) => {
  const result = await tournamentService.registerTeam(req.params.id, req.body.team_id, req.user.userId, req.body.seed_number);
  res.status(201).json({ success: true, data: result });
}));

addRoute('/tournaments/{id}/teams', 'post', {
  summary: 'Register team to tournament',
  tags: ['Tournaments'],
  security: [{ bearerAuth: [] }],
  responses: { 201: { description: 'Team registered' } }
});

router.delete('/:id/teams/:teamId', authMiddleware, asyncHandler(async (req, res) => {
  await tournamentService.withdrawTeam(req.params.id, req.params.teamId, req.user.userId);
  res.json({ success: true, data: { message: 'Team withdrawn' } });
}));

addRoute('/tournaments/{id}/teams/{teamId}', 'delete', {
  summary: 'Withdraw team from tournament',
  tags: ['Tournaments'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Team withdrawn' } }
});

router.post('/:id/fixtures', authMiddleware, [body('format').optional().isIn(['league', 'knockout']), body('groups').optional().isArray()], validate, asyncHandler(async (req, res) => {
  const teams = await tournamentService.getRegisteredTeams(req.params.id, req.user.userId);
  const tournament = await tournamentService.getById(req.params.id, req.user.userId);
  const fixtures = await fixtureService.generateAndSaveFixtures(req.params.id, teams, req.body.format || tournament.format, req.body.groups);
  res.status(201).json({ success: true, data: fixtures });
}));

addRoute('/tournaments/{id}/fixtures', 'post', {
  summary: 'Generate fixtures',
  tags: ['Tournaments'],
  security: [{ bearerAuth: [] }],
  responses: { 201: { description: 'Fixtures generated' } }
});

router.get('/:id/fixtures', authMiddleware, asyncHandler(async (req, res) => {
  const fixtures = await fixtureService.getFixturesByTournament(req.params.id);
  res.json({ success: true, data: fixtures });
}));

addRoute('/tournaments/{id}/fixtures', 'get', {
  summary: 'Get tournament fixtures',
  tags: ['Tournaments'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'List of fixtures' } }
});

export default router;