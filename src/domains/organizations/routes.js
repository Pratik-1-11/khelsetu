import { Router } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import organizationService from './services/organizationService.js';
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
    body('name').notEmpty().trim().withMessage('Organization name is required'),
    body('slug').optional().trim(),
    body('description').optional().trim(),
    body('website').optional().trim().isURL(),
    body('contact_email').optional().trim().isEmail(),
    body('contact_phone').optional().trim()
  ],
  validate,
  asyncHandler(async (req, res) => {
    const org = await organizationService.create(req.body, req.user.userId);
    res.status(201).json({ success: true, data: org });
  })
);

addRoute('/organizations', 'post', {
  summary: 'Create new organization',
  tags: ['Organizations'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, slug: { type: 'string' }, description: { type: 'string' } } },
        example: { name: 'Nepal Sports Federation', slug: 'nsf', description: 'National sports organization' }
      }
    }
  },
  responses: { 201: { description: 'Organization created' } }
});

router.get('/', authMiddleware, asyncHandler(async (req, res) => {
  const result = await organizationService.getAll({ page: parseInt(req.query.page) || 1, limit: parseInt(req.query.limit) || 20 }, req.user.userId);
  res.json({ success: true, data: result.data, pagination: result.pagination });
}));

addRoute('/organizations', 'get', {
  summary: 'Get user organizations',
  tags: ['Organizations'],
  security: [{ bearerAuth: [] }],
  parameters: [
    { name: 'page', in: 'query', schema: { type: 'integer' } },
    { name: 'limit', in: 'query', schema: { type: 'integer' } }
  ],
  responses: { 200: { description: 'List of organizations' } }
});

router.get('/:id', authMiddleware, asyncHandler(async (req, res) => {
  const org = await organizationService.getById(req.params.id, req.user.userId);
  res.json({ success: true, data: org });
}));

addRoute('/organizations/{id}', 'get', {
  summary: 'Get organization by ID',
  tags: ['Organizations'],
  security: [{ bearerAuth: [] }],
  parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
  responses: { 200: { description: 'Organization details' } }
});

router.put(
  '/:id',
  authMiddleware,
  [body('name').optional().trim(), body('slug').optional().trim(), body('description').optional().trim()],
  validate,
  asyncHandler(async (req, res) => {
    const org = await organizationService.update(req.params.id, req.user.userId, req.body);
    res.json({ success: true, data: org });
  })
);

addRoute('/organizations/{id}', 'put', {
  summary: 'Update organization',
  tags: ['Organizations'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Organization updated' } }
});

router.delete('/:id', authMiddleware, asyncHandler(async (req, res) => {
  await organizationService.delete(req.params.id, req.user.userId);
  res.json({ success: true, data: { message: 'Organization deleted' } });
}));

addRoute('/organizations/{id}', 'delete', {
  summary: 'Delete organization',
  tags: ['Organizations'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Organization deleted' } }
});

router.get('/:id/members', authMiddleware, asyncHandler(async (req, res) => {
  const result = await organizationService.getMembers(req.params.id, req.user.userId, { page: parseInt(req.query.page) || 1, limit: parseInt(req.query.limit) || 20 });
  res.json({ success: true, data: result.data, pagination: result.pagination });
}));

addRoute('/organizations/{id}/members', 'get', {
  summary: 'Get organization members',
  tags: ['Organizations'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'List of members' } }
});

router.post(
  '/:id/invitations',
  authMiddleware,
  [body('email').isEmail().normalizeEmail(), body('role').optional().isIn(['admin', 'member', 'viewer'])],
  validate,
  asyncHandler(async (req, res) => {
    const invitation = await organizationService.invite(req.params.id, req.user.userId, req.body);
    res.status(201).json({ success: true, data: invitation });
  })
);

addRoute('/organizations/{id}/invitations', 'post', {
  summary: 'Invite user to organization',
  tags: ['Organizations'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: { 'application/json': { schema: { type: 'object', required: ['email'], properties: { email: { type: 'string' }, role: { type: 'string' } } } } }
  },
  responses: { 201: { description: 'Invitation sent' } }
});

router.delete('/:id/members/:userId', authMiddleware, asyncHandler(async (req, res) => {
  await organizationService.removeMember(req.params.id, req.user.userId, req.params.userId);
  res.json({ success: true, data: { message: 'Member removed' } });
}));

addRoute('/organizations/{id}/members/{userId}', 'delete', {
  summary: 'Remove member',
  tags: ['Organizations'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Member removed' } }
});

router.post('/invitations/:token/accept', authMiddleware, asyncHandler(async (req, res) => {
  const org = await organizationService.acceptInvitation(req.params.token, req.user.userId);
  res.json({ success: true, data: org });
}));

addRoute('/organizations/invitations/{token}/accept', 'post', {
  summary: 'Accept invitation',
  tags: ['Organizations'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Invitation accepted' } }
});

export default router;