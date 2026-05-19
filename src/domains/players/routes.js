import { Router } from 'express';
import { body, validationResult } from 'express-validator';
import playerService from './services/playerService.js';
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
    body('organization_id').isUUID().withMessage('Valid organization ID required'),
    body('first_name').notEmpty().trim().withMessage('First name is required'),
    body('last_name').optional().trim(),
    body('email').optional().isEmail(),
    body('phone').optional().trim(),
    body('date_of_birth').optional().isISO8601(),
    body('gender').optional().isIn(['male', 'female', 'other']),
    body('jersey_number').optional().isInt({ min: 0, max: 999 }),
    body('position').optional().trim()
  ],
  validate,
  asyncHandler(async (req, res) => {
    const player = await playerService.create(req.body, req.user.userId);
    res.status(201).json({ success: true, data: player });
  })
);

addRoute('/players', 'post', {
  summary: 'Create new player',
  tags: ['Players'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['organization_id', 'first_name'],
          properties: { organization_id: { type: 'string' }, first_name: { type: 'string' }, last_name: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' }, jersey_number: { type: 'integer' }, position: { type: 'string' } }
        }
      }
    }
  },
  responses: { 201: { description: 'Player created' } }
});

router.get('/', authMiddleware, asyncHandler(async (req, res) => {
  const { organization_id, search, team_id } = req.query;
  if (!organization_id) {
    throw new ValidationError('organization_id is required');
  }
  const result = await playerService.getByOrganization(organization_id, req.user.userId, { page: parseInt(req.query.page) || 1, limit: parseInt(req.query.limit) || 20, search, team_id });
  res.json({ success: true, data: result.data, pagination: result.pagination });
}));

addRoute('/players', 'get', {
  summary: 'Get players by organization',
  tags: ['Players'],
  security: [{ bearerAuth: [] }],
  parameters: [
    { name: 'organization_id', in: 'query', required: true, schema: { type: 'string' } },
    { name: 'search', in: 'query', schema: { type: 'string' } },
    { name: 'team_id', in: 'query', schema: { type: 'string' } }
  ],
  responses: { 200: { description: 'List of players' } }
});

router.get('/:id', authMiddleware, asyncHandler(async (req, res) => {
  const player = await playerService.getById(req.params.id, req.user.userId);
  res.json({ success: true, data: player });
}));

addRoute('/players/{id}', 'get', {
  summary: 'Get player by ID',
  tags: ['Players'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Player details' } }
});

router.put(
  '/:id',
  authMiddleware,
  [body('first_name').optional().trim(), body('last_name').optional().trim(), body('jersey_number').optional().isInt()],
  validate,
  asyncHandler(async (req, res) => {
    const player = await playerService.update(req.params.id, req.user.userId, req.body);
    res.json({ success: true, data: player });
  })
);

addRoute('/players/{id}', 'put', {
  summary: 'Update player',
  tags: ['Players'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Player updated' } }
});

router.delete('/:id', authMiddleware, asyncHandler(async (req, res) => {
  await playerService.delete(req.params.id, req.user.userId);
  res.json({ success: true, data: { message: 'Player deleted' } });
}));

addRoute('/players/{id}', 'delete', {
  summary: 'Delete player',
  tags: ['Players'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Player deleted' } }
});

router.post('/:id/teams', authMiddleware, [body('team_id').isUUID(), body('role').optional().isIn(['player', 'captain', 'coach'])], validate, asyncHandler(async (req, res) => {
  const result = await playerService.addToTeam(req.params.id, req.body.team_id, req.user.userId, req.body.role);
  res.status(201).json({ success: true, data: result });
}));

addRoute('/players/{id}/teams', 'post', {
  summary: 'Add player to team',
  tags: ['Players'],
  security: [{ bearerAuth: [] }],
  responses: { 201: { description: 'Player added to team' } }
});

router.delete('/:id/teams/:teamId', authMiddleware, asyncHandler(async (req, res) => {
  await playerService.removeFromTeam(req.params.id, req.params.teamId, req.user.userId);
  res.json({ success: true, data: { message: 'Player removed from team' } });
}));

addRoute('/players/{id}/teams/{teamId}', 'delete', {
  summary: 'Remove player from team',
  tags: ['Players'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Player removed from team' } }
});

router.get('/:id/teams', authMiddleware, asyncHandler(async (req, res) => {
  const teams = await playerService.getPlayerTeams(req.params.id, req.user.userId);
  res.json({ success: true, data: teams });
}));

addRoute('/players/{id}/teams', 'get', {
  summary: 'Get player teams',
  tags: ['Players'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'List of teams' } }
});

export default router;