import { Router } from 'express';
import { body, param, validationResult } from 'express-validator';
import sportService from './services/sportService.js';
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

router.get('/', asyncHandler(async (req, res) => {
  const result = await sportService.getAll({
    page: parseInt(req.query.page) || 1,
    limit: parseInt(req.query.limit) || 20,
    includeInactive: req.query.include_inactive === 'true'
  });
  res.json({ success: true, data: result.data, pagination: result.pagination });
}));

addRoute('/sports', 'get', {
  summary: 'Get all sports',
  tags: ['Sports'],
  parameters: [
    { name: 'page', in: 'query', schema: { type: 'integer' } },
    { name: 'limit', in: 'query', schema: { type: 'integer' } },
    { name: 'include_inactive', in: 'query', schema: { type: 'boolean' } }
  ],
  responses: { 200: { description: 'List of sports' } }
});

router.get('/:id', asyncHandler(async (req, res) => {
  const sport = await sportService.getById(req.params.id);
  res.json({ success: true, data: sport });
}));

addRoute('/sports/{id}', 'get', {
  summary: 'Get sport by ID',
  tags: ['Sports'],
  parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
  responses: { 200: { description: 'Sport details' } }
});

router.post(
  '/',
  authMiddleware,
  [
    body('name').notEmpty().trim().withMessage('Sport name is required'),
    body('slug').optional().trim(),
    body('icon').optional().trim(),
    body('description').optional().trim(),
    body('rules').optional().isObject(),
    body('scoring_config').optional().isObject()
  ],
  validate,
  asyncHandler(async (req, res) => {
    const sport = await sportService.create(req.body);
    res.status(201).json({ success: true, data: sport });
  })
);

addRoute('/sports', 'post', {
  summary: 'Create new sport',
  tags: ['Sports'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string' },
            slug: { type: 'string' },
            icon: { type: 'string' },
            rules: { type: 'object' },
            scoring_config: { type: 'object' }
          }
        }
      }
    }
  },
  responses: { 201: { description: 'Sport created' } }
});

router.put(
  '/:id',
  authMiddleware,
  [body('name').optional().trim(), body('slug').optional().trim(), body('is_active').optional().isBoolean()],
  validate,
  asyncHandler(async (req, res) => {
    const sport = await sportService.update(req.params.id, req.body);
    res.json({ success: true, data: sport });
  })
);

addRoute('/sports/{id}', 'put', {
  summary: 'Update sport',
  tags: ['Sports'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Sport updated' } }
});

router.delete('/:id', authMiddleware, asyncHandler(async (req, res) => {
  await sportService.delete(req.params.id);
  res.json({ success: true, data: { message: 'Sport deleted' } });
}));

addRoute('/sports/{id}', 'delete', {
  summary: 'Delete sport',
  tags: ['Sports'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Sport deleted' } }
});

export default router;