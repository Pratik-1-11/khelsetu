import { Router } from 'express';
import { query, param, validationResult } from 'express-validator';
import analyticsService from './services/analyticsService.js';
import { authMiddleware } from '../../core/auth/jwt.js';
import { asyncHandler, ValidationError } from '../../core/errors/index.js';
import { addRoute } from '../../docs/swagger.js';

const router = Router();

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) throw new ValidationError('Validation failed', errors.array());
  next();
};

router.get(
  '/dashboard/stats',
  authMiddleware,
  [query('organization_id').isUUID().withMessage('Valid organization ID required')],
  validate,
  asyncHandler(async (req, res) => {
    const stats = await analyticsService.getDashboardStats(req.query.organization_id, req.user.userId);
    res.json({ success: true, data: stats });
  })
);

addRoute('/analytics/dashboard/stats', 'get', {
  summary: 'Get dashboard statistics',
  tags: ['Analytics'],
  security: [{ bearerAuth: [] }],
  parameters: [{ name: 'organization_id', in: 'query', required: true, schema: { type: 'string' } }],
  responses: { 200: { description: 'Dashboard stats' } }
});

router.get(
  '/tournaments/:id/stats',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const stats = await analyticsService.getTournamentStats(req.params.id, req.user.userId);
    res.json({ success: true, data: stats });
  })
);

addRoute('/analytics/tournaments/{id}/stats', 'get', {
  summary: 'Get tournament analytics',
  tags: ['Analytics'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Tournament stats' } }
});

router.get(
  '/matches/:id/stats',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const stats = await analyticsService.getMatchStats(req.params.id, req.user.userId);
    res.json({ success: true, data: stats });
  })
);

addRoute('/analytics/matches/{id}/stats', 'get', {
  summary: 'Get match analytics',
  tags: ['Analytics'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Match stats' } }
});

router.get(
  '/teams/:id/stats',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const stats = await analyticsService.getTeamStats(req.params.id, req.user.userId);
    res.json({ success: true, data: stats });
  })
);

addRoute('/analytics/teams/{id}/stats', 'get', {
  summary: 'Get team analytics',
  tags: ['Analytics'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Team stats' } }
});

router.get(
  '/players/:id/stats',
  authMiddleware,
  asyncHandler(async (req, res) => {
    const stats = await analyticsService.getPlayerStats(req.params.id, req.user.userId);
    res.json({ success: true, data: stats });
  })
);

addRoute('/analytics/players/{id}/stats', 'get', {
  summary: 'Get player analytics',
  tags: ['Analytics'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Player stats' } }
});

router.get(
  '/reports/custom',
  authMiddleware,
  [
    query('organization_id').isUUID().withMessage('Valid organization ID required'),
    query('start_date').optional().isISO8601(),
    query('end_date').optional().isISO8601(),
    query('tournament_id').optional().isUUID(),
    query('export_format').optional().isIn(['json', 'csv'])
  ],
  validate,
  asyncHandler(async (req, res) => {
    const report = await analyticsService.generateCustomReport({
      organization_id: req.query.organization_id,
      start_date: req.query.start_date,
      end_date: req.query.end_date,
      tournament_id: req.query.tournament_id,
      export_format: req.query.export_format || 'json'
    });
    res.json({ success: true, data: report });
  })
);

addRoute('/analytics/reports/custom', 'get', {
  summary: 'Generate custom report',
  tags: ['Analytics'],
  security: [{ bearerAuth: [] }],
  parameters: [
    { name: 'organization_id', in: 'query', required: true, schema: { type: 'string' } },
    { name: 'start_date', in: 'query', schema: { type: 'string' } },
    { name: 'end_date', in: 'query', schema: { type: 'string' } },
    { name: 'tournament_id', in: 'query', schema: { type: 'string' } },
    { name: 'export_format', in: 'query', schema: { type: 'string', enum: ['json', 'csv'] } }
  ],
  responses: { 200: { description: 'Custom report' } }
});

router.get(
  '/leaderboards',
  authMiddleware,
  [
    query('organization_id').isUUID().withMessage('Valid organization ID required'),
    query('tournament_id').optional().isUUID(),
    query('metric').optional().isIn(['goals', 'assists', 'points', 'wins']),
    query('limit').optional().isInt({ min: 1, max: 100 })
  ],
  validate,
  asyncHandler(async (req, res) => {
    const leaderboard = await analyticsService.getLeaderboards({
      organization_id: req.query.organization_id,
      tournament_id: req.query.tournament_id,
      metric: req.query.metric || 'goals',
      limit: parseInt(req.query.limit) || 10
    });
    res.json({ success: true, data: leaderboard });
  })
);

addRoute('/analytics/leaderboards', 'get', {
  summary: 'Get leaderboards',
  tags: ['Analytics'],
  security: [{ bearerAuth: [] }],
  parameters: [
    { name: 'organization_id', in: 'query', required: true, schema: { type: 'string' } },
    { name: 'tournament_id', in: 'query', schema: { type: 'string' } },
    { name: 'metric', in: 'query', schema: { type: 'string', enum: ['goals', 'assists', 'points', 'wins'] } },
    { name: 'limit', in: 'query', schema: { type: 'integer' } }
  ],
  responses: { 200: { description: 'Leaderboard data' } }
});

export default router;