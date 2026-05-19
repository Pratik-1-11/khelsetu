import { Router } from 'express';
import { query, param, validationResult } from 'express-validator';
import auditService from './services/auditService.js';
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
  '/logs',
  authMiddleware,
  [
    query('organization_id').isUUID().withMessage('Valid organization ID required'),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('start_date').optional().isISO8601(),
    query('end_date').optional().isISO8601(),
    query('user_id').optional().isUUID(),
    query('action_type').optional().isString(),
    query('entity_type').optional().isString()
  ],
  validate,
  asyncHandler(async (req, res) => {
    const result = await auditService.getAuditLogs(req.query.organization_id, req.user.userId, {
      page: parseInt(req.query.page) || 1,
      limit: parseInt(req.query.limit) || 20,
      start_date: req.query.start_date,
      end_date: req.query.end_date,
      user_id: req.query.user_id,
      action_type: req.query.action_type,
      entity_type: req.query.entity_type
    });
    res.json({ success: true, data: result.data, pagination: result.pagination });
  })
);

addRoute('/audit/logs', 'get', {
  summary: 'Get audit logs',
  tags: ['Audit'],
  security: [{ bearerAuth: [] }],
  parameters: [
    { name: 'organization_id', in: 'query', required: true, schema: { type: 'string' } },
    { name: 'page', in: 'query', schema: { type: 'integer' } },
    { name: 'limit', in: 'query', schema: { type: 'integer' } },
    { name: 'start_date', in: 'query', schema: { type: 'string' } },
    { name: 'end_date', in: 'query', schema: { type: 'string' } },
    { name: 'user_id', in: 'query', schema: { type: 'string' } },
    { name: 'action_type', in: 'query', schema: { type: 'string' } },
    { name: 'entity_type', in: 'query', schema: { type: 'string' } }
  ],
  responses: { 200: { description: 'Audit logs' } }
});

router.get(
  '/entity/:type/:id/history',
  authMiddleware,
  [param('type').isIn(['tournament', 'team', 'player', 'match', 'organization']), param('id').isUUID()],
  validate,
  asyncHandler(async (req, res) => {
    const history = await auditService.getEntityHistory(req.params.type, req.params.id, req.user.userId);
    res.json({ success: true, data: history });
  })
);

addRoute('/audit/entity/{type}/{id}/history', 'get', {
  summary: 'Get entity history',
  tags: ['Audit'],
  security: [{ bearerAuth: [] }],
  parameters: [
    { name: 'type', in: 'path', required: true, schema: { type: 'string', enum: ['tournament', 'team', 'player', 'match', 'organization'] } },
    { name: 'id', in: 'path', required: true, schema: { type: 'string' } }
  ],
  responses: { 200: { description: 'Entity history' } }
});

router.get(
  '/user/:userId/activity',
  authMiddleware,
  [
    param('userId').isUUID(),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 })
  ],
  validate,
  asyncHandler(async (req, res) => {
    const result = await auditService.getUserActivity(req.params.userId, req.user.userId, {
      page: parseInt(req.query.page) || 1,
      limit: parseInt(req.query.limit) || 20
    });
    res.json({ success: true, data: result.data, pagination: result.pagination });
  })
);

addRoute('/audit/user/{userId}/activity', 'get', {
  summary: 'Get user activity',
  tags: ['Audit'],
  security: [{ bearerAuth: [] }],
  parameters: [
    { name: 'userId', in: 'path', required: true, schema: { type: 'string' } },
    { name: 'page', in: 'query', schema: { type: 'integer' } },
    { name: 'limit', in: 'query', schema: { type: 'integer' } }
  ],
  responses: { 200: { description: 'User activity' } }
});

export default router;