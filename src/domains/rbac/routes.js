import { Router } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import rbacService from './services/rbacService.js';
import { authMiddleware } from '../../core/auth/jwt.js';
import { requirePermission } from '../../core/middleware/requirePermission.js';
import { asyncHandler, ValidationError } from '../../core/errors/index.js';
import { addRoute } from '../../docs/swagger.js';

const router = Router();

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) throw new ValidationError('Validation failed', errors.array());
  next();
};

router.get(
  '/permissions',
  authMiddleware,
  [query('category').optional().isString(), query('search').optional().isString()],
  validate,
  asyncHandler(async (req, res) => {
    const permissions = await rbacService.getAllPermissions({
      category: req.query.category,
      search: req.query.search
    });
    res.json({ success: true, data: permissions });
  })
);

addRoute('/rbac/permissions', 'get', {
  summary: 'Get all permissions',
  tags: ['RBAC'],
  security: [{ bearerAuth: [] }],
  parameters: [
    { name: 'category', in: 'query', schema: { type: 'string' } },
    { name: 'search', in: 'query', schema: { type: 'string' } }
  ],
  responses: { 200: { description: 'List of permissions' } }
});

router.get(
  '/permissions/:id',
  authMiddleware,
  [param('id').isUUID()],
  validate,
  asyncHandler(async (req, res) => {
    const permission = await rbacService.getPermissionById(req.params.id);
    res.json({ success: true, data: permission });
  })
);

addRoute('/rbac/permissions/{id}', 'get', {
  summary: 'Get permission by ID',
  tags: ['RBAC'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Permission details' } }
});

router.get(
  '/roles',
  authMiddleware,
  [
    query('organization_id').optional().isUUID(),
    query('scope').optional().isIn(['global', 'organization', 'tournament', 'match', 'overlay']),
    query('is_system').optional().isBoolean()
  ],
  validate,
  asyncHandler(async (req, res) => {
    const roles = await rbacService.getAllRoles({
      organization_id: req.query.organization_id,
      scope: req.query.scope,
      is_system: req.query.is_system === 'true'
    });
    res.json({ success: true, data: roles });
  })
);

addRoute('/rbac/roles', 'get', {
  summary: 'Get all roles',
  tags: ['RBAC'],
  security: [{ bearerAuth: [] }],
  parameters: [
    { name: 'organization_id', in: 'query', schema: { type: 'string' } },
    { name: 'scope', in: 'query', schema: { type: 'string', enum: ['global', 'organization', 'tournament', 'match', 'overlay'] } },
    { name: 'is_system', in: 'query', schema: { type: 'boolean' } }
  ],
  responses: { 200: { description: 'List of roles' } }
});

router.get(
  '/roles/:id',
  authMiddleware,
  [param('id').isUUID()],
  validate,
  asyncHandler(async (req, res) => {
    const role = await rbacService.getRoleById(req.params.id);
    res.json({ success: true, data: role });
  })
);

addRoute('/rbac/roles/{id}', 'get', {
  summary: 'Get role by ID',
  tags: ['RBAC'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Role with permissions' } }
});

router.post(
  '/roles',
  authMiddleware,
  requirePermission('rbac:manage'),
  [
    body('name').notEmpty().trim().withMessage('Role name is required'),
    body('description').optional().trim(),
    body('scope').optional().isIn(['global', 'organization', 'tournament', 'match', 'overlay']),
    body('permission_ids').optional().isArray(),
    body('organization_id').optional().isUUID()
  ],
  validate,
  asyncHandler(async (req, res) => {
    const role = await rbacService.createRole(req.body, req.user.userId);
    res.status(201).json({ success: true, data: role });
  })
);

addRoute('/rbac/roles', 'post', {
  summary: 'Create custom role',
  tags: ['RBAC'],
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
            description: { type: 'string' },
            scope: { type: 'string', enum: ['global', 'organization', 'tournament', 'match', 'overlay'] },
            permission_ids: { type: 'array', items: { type: 'string' } },
            organization_id: { type: 'string' }
          }
        }
      }
    }
  },
  responses: { 201: { description: 'Role created' } }
});

router.put(
  '/roles/:id',
  authMiddleware,
  requirePermission('rbac:manage'),
  [
    body('name').optional().trim(),
    body('description').optional().trim(),
    body('permission_ids').optional().isArray()
  ],
  validate,
  asyncHandler(async (req, res) => {
    const role = await rbacService.updateRole(req.params.id, req.user.userId, req.body);
    res.json({ success: true, data: role });
  })
);

addRoute('/rbac/roles/{id}', 'put', {
  summary: 'Update role',
  tags: ['RBAC'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Role updated' } }
});

router.delete(
  '/roles/:id',
  authMiddleware,
  requirePermission('rbac:manage'),
  [param('id').isUUID()],
  validate,
  asyncHandler(async (req, res) => {
    await rbacService.deleteRole(req.params.id, req.user.userId);
    res.json({ success: true, data: { message: 'Role deleted' } });
  })
);

addRoute('/rbac/roles/{id}', 'delete', {
  summary: 'Delete role',
  tags: ['RBAC'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Role deleted' } }
});

router.post(
  '/roles/:id/permissions',
  authMiddleware,
  requirePermission('rbac:manage'),
  [body('permission_ids').isArray().withMessage('Permission IDs required')],
  validate,
  asyncHandler(async (req, res) => {
    const result = await rbacService.addPermissionsToRole(req.params.id, req.body.permission_ids);
    res.json({ success: true, data: result });
  })
);

addRoute('/rbac/roles/{id}/permissions', 'post', {
  summary: 'Add permissions to role',
  tags: ['RBAC'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Permissions added' } }
});

router.delete(
  '/roles/:id/permissions/:permId',
  authMiddleware,
  requirePermission('rbac:manage'),
  [param('id').isUUID(), param('permId').isUUID()],
  validate,
  asyncHandler(async (req, res) => {
    await rbacService.removePermissionFromRole(req.params.id, req.params.permId);
    res.json({ success: true, data: { message: 'Permission removed' } });
  })
);

addRoute('/rbac/roles/{id}/permissions/{permId}', 'delete', {
  summary: 'Remove permission from role',
  tags: ['RBAC'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Permission removed' } }
});

router.get(
  '/users/:userId/permissions',
  authMiddleware,
  [
    param('userId').isUUID(),
    query('organization_id').optional().isUUID()
  ],
  validate,
  asyncHandler(async (req, res) => {
    const permissions = await rbacService.getUserPermissions(req.params.userId, req.query.organization_id);
    res.json({ success: true, data: permissions });
  })
);

addRoute('/rbac/users/{userId}/permissions', 'get', {
  summary: 'Get user effective permissions',
  tags: ['RBAC'],
  security: [{ bearerAuth: [] }],
  parameters: [
    { name: 'userId', in: 'path', required: true, schema: { type: 'string' } },
    { name: 'organization_id', in: 'query', schema: { type: 'string' } }
  ],
  responses: { 200: { description: 'User permissions' } }
});

router.get(
  '/users/:userId/roles',
  authMiddleware,
  [param('userId').isUUID()],
  validate,
  asyncHandler(async (req, res) => {
    const roles = await rbacService.getUserRoles(req.params.userId);
    res.json({ success: true, data: roles });
  })
);

addRoute('/rbac/users/{userId}/roles', 'get', {
  summary: 'Get user roles',
  tags: ['RBAC'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'User roles' } }
});

router.post(
  '/users/:userId/roles',
  authMiddleware,
  requirePermission('rbac:manage'),
  [
    body('role_id').isUUID().withMessage('Role ID required'),
    body('organization_id').optional().isUUID(),
    body('tournament_id').optional().isUUID(),
    body('match_id').optional().isUUID()
  ],
  validate,
  asyncHandler(async (req, res) => {
    const result = await rbacService.assignRoleToUser(req.params.userId, req.user.userId, req.body);
    res.status(201).json({ success: true, data: result });
  })
);

addRoute('/rbac/users/{userId}/roles', 'post', {
  summary: 'Assign role to user',
  tags: ['RBAC'],
  security: [{ bearerAuth: [] }],
  responses: { 201: { description: 'Role assigned' } }
});

router.delete(
  '/users/:userId/roles/:roleId',
  authMiddleware,
  requirePermission('rbac:manage'),
  [param('userId').isUUID(), param('roleId').isUUID()],
  validate,
  asyncHandler(async (req, res) => {
    await rbacService.removeRoleFromUser(req.params.userId, req.params.roleId, req.user.userId);
    res.json({ success: true, data: { message: 'Role removed' } });
  })
);

addRoute('/rbac/users/{userId}/roles/{roleId}', 'delete', {
  summary: 'Remove role from user',
  tags: ['RBAC'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Role removed' } }
});

export default router;