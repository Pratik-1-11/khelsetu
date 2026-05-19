import { Router } from 'express';
import { body, validationResult } from 'express-validator';
import teamService from './services/teamService.js';
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
    body('name').notEmpty().trim().withMessage('Team name is required'),
    body('slug').optional().trim(),
    body('description').optional().trim(),
    body('home_venue').optional().trim()
  ],
  validate,
  asyncHandler(async (req, res) => {
    const team = await teamService.create(req.body, req.user.userId);
    res.status(201).json({ success: true, data: team });
  })
);

addRoute('/teams', 'post', {
  summary: 'Create new team',
  tags: ['Teams'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['organization_id', 'name'],
          properties: { organization_id: { type: 'string' }, name: { type: 'string' }, slug: { type: 'string' }, description: { type: 'string' }, home_venue: { type: 'string' } }
        }
      }
    }
  },
  responses: { 201: { description: 'Team created' } }
});

router.get('/', authMiddleware, asyncHandler(async (req, res) => {
  const { organization_id, search } = req.query;
  if (!organization_id) {
    throw new ValidationError('organization_id is required');
  }
  const result = await teamService.getByOrganization(organization_id, req.user.userId, { page: parseInt(req.query.page) || 1, limit: parseInt(req.query.limit) || 20, search });
  res.json({ success: true, data: result.data, pagination: result.pagination });
}));

addRoute('/teams', 'get', {
  summary: 'Get teams by organization',
  tags: ['Teams'],
  security: [{ bearerAuth: [] }],
  parameters: [
    { name: 'organization_id', in: 'query', required: true, schema: { type: 'string' } },
    { name: 'search', in: 'query', schema: { type: 'string' } }
  ],
  responses: { 200: { description: 'List of teams' } }
});

router.get('/:id', authMiddleware, asyncHandler(async (req, res) => {
  const team = await teamService.getById(req.params.id, req.user.userId);
  res.json({ success: true, data: team });
}));

addRoute('/teams/{id}', 'get', {
  summary: 'Get team by ID',
  tags: ['Teams'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Team details' } }
});

router.put(
  '/:id',
  authMiddleware,
  [body('name').optional().trim(), body('slug').optional().trim()],
  validate,
  asyncHandler(async (req, res) => {
    const team = await teamService.update(req.params.id, req.user.userId, req.body);
    res.json({ success: true, data: team });
  })
);

addRoute('/teams/{id}', 'put', {
  summary: 'Update team',
  tags: ['Teams'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Team updated' } }
});

router.delete('/:id', authMiddleware, asyncHandler(async (req, res) => {
  await teamService.delete(req.params.id, req.user.userId);
  res.json({ success: true, data: { message: 'Team deleted' } });
}));

addRoute('/teams/{id}', 'delete', {
  summary: 'Delete team',
  tags: ['Teams'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Team deleted' } }
});

router.get('/:id/players', authMiddleware, asyncHandler(async (req, res) => {
  const players = await teamService.getPlayers(req.params.id, req.user.userId);
  res.json({ success: true, data: players });
}));

addRoute('/teams/{id}/players', 'get', {
  summary: 'Get team players',
  tags: ['Teams'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'List of players' } }
});

export default router;