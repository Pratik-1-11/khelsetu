import { Router } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import authService from './service.js';
import { authMiddleware } from './jwt.js';
import { asyncHandler, ValidationError, NotFoundError } from '../errors/index.js';
import rbacService from '../../domains/rbac/services/rbacService.js';
import membershipRepository from '../../domains/organizations/repositories/membershipRepository.js';
import organizationRepository from '../../domains/organizations/repositories/organizationRepository.js';
import userRepository from '../../domains/organizations/repositories/userRepository.js';
import db from '../../infrastructure/postgres/index.js';
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
  '/register',
  [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('first_name').notEmpty().trim(),
    body('last_name').optional().trim(),
    body('phone').optional().trim()
  ],
  validate,
  asyncHandler(async (req, res) => {
    const result = await authService.register(req.body);
    res.status(201).json({
      success: true,
      data: result
    });
  })
);

addRoute('/auth/register', 'post', {
  summary: 'Register new user',
  tags: ['Auth'],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['email', 'password', 'first_name'],
          properties: {
            email: { type: 'string', format: 'email' },
            password: { type: 'string', minLength: 8 },
            first_name: { type: 'string' },
            last_name: { type: 'string' },
            phone: { type: 'string' }
          }
        },
        example: {
          email: 'user@example.com',
          password: 'securePassword123',
          first_name: 'John',
          last_name: 'Doe'
        }
      }
    }
  },
  responses: {
    201: {
      description: 'User registered successfully',
      content: {
        'application/json': {
          schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'object' } } }
        }
      }
    }
  }
});

router.post(
  '/login',
  [
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty()
  ],
  validate,
  asyncHandler(async (req, res) => {
    const result = await authService.login(req.body);
    res.json({
      success: true,
      data: result
    });
  })
);

addRoute('/auth/login', 'post', {
  summary: 'Login user',
  tags: ['Auth'],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email' },
            password: { type: 'string' }
          }
        },
        example: {
          email: 'user@example.com',
          password: 'securePassword123'
        }
      }
    }
  },
  responses: {
    200: {
      description: 'Login successful',
      content: {
        'application/json': {
          schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'object' } } }
        }
      }
    }
  }
});

router.post(
  '/refresh',
  [
    body('refresh_token').notEmpty()
  ],
  validate,
  asyncHandler(async (req, res) => {
    const result = await authService.refresh(req.body.refresh_token);
    res.json({
      success: true,
      data: result
    });
  })
);

addRoute('/auth/refresh', 'post', {
  summary: 'Refresh access token',
  tags: ['Auth'],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['refresh_token'],
          properties: { refresh_token: { type: 'string' } }
        }
      }
    }
  },
  responses: {
    200: {
      description: 'Tokens refreshed',
      content: {
        'application/json': {
          schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'object' } } }
        }
      }
    }
  }
});

router.post('/logout', authMiddleware, asyncHandler(async (req, res) => {
  const result = await authService.logout(req.token);
  res.json({ success: true, data: result });
}));

addRoute('/auth/logout', 'post', {
  summary: 'Logout user',
  tags: ['Auth'],
  security: [{ bearerAuth: [] }],
  responses: {
    200: { description: 'Logged out successfully' }
  }
});

router.get('/me', authMiddleware, asyncHandler(async (req, res) => {
  const user = await authService.getProfile(req.user.userId);
  res.json({ success: true, data: user });
}));

router.post('/me', authMiddleware, asyncHandler(async (req, res) => {
  throw new NotFoundError('Use GET /api/auth/me to retrieve your profile');
}));

router.get('/navigation', authMiddleware, [query('organization_id').isUUID()], validate,
  asyncHandler(async (req, res) => {
    const { organization_id } = req.query;
    const userId = req.user.userId;

    const membership = await membershipRepository.findByUserAndOrg(userId, organization_id);
    if (!membership) throw new NotFoundError('Not a member of this organization');

    const permissions = await rbacService.getUserPermissions(userId, organization_id);

    const [navRows] = await db.query(
      `SELECT navigation FROM role_navigation WHERE role_name = ?`,
      [membership.role]
    );
    const navigation = navRows.length ? JSON.parse(navRows[0].navigation) : [];

    const org = await organizationRepository.findById(organization_id);
    const featureFlags = org?.feature_flags || {};

    const userOrgs = await userRepository.getUserOrganizations(userId);

    res.json({
      success: true,
      data: {
        membership_role: membership.role,
        permissions: permissions.effective.map(p => p.name),
        navigation,
        feature_flags: featureFlags,
        organizations: userOrgs.map(o => ({
          id: o.id,
          name: o.name,
          slug: o.slug,
          member_role: o.member_role
        }))
      }
    });
  })
);

addRoute('/auth/navigation', 'get', {
  summary: 'Get role-based navigation config',
  tags: ['Auth'],
  security: [{ bearerAuth: [] }],
  parameters: [{ name: 'organization_id', in: 'query', required: true, schema: { type: 'string' } }],
  responses: { 200: { description: 'Navigation config with permissions and feature flags' } }
});

addRoute('/auth/me', 'get', {
  summary: 'Get current user profile',
  tags: ['Auth'],
  security: [{ bearerAuth: [] }],
  responses: {
    200: { description: 'User profile', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'object' } } } } } }
  }
});

router.put(
  '/profile',
  authMiddleware,
  [
    body('first_name').optional().trim(),
    body('last_name').optional().trim(),
    body('phone').optional().trim(),
    body('avatar').optional().trim()
  ],
  validate,
  asyncHandler(async (req, res) => {
    const user = await authService.updateProfile(req.user.userId, req.body);
    res.json({ success: true, data: user });
  })
);

addRoute('/auth/profile', 'put', {
  summary: 'Update user profile',
  tags: ['Auth'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            first_name: { type: 'string' },
            last_name: { type: 'string' },
            phone: { type: 'string' },
            avatar: { type: 'string' }
          }
        }
      }
    }
  },
  responses: {
    200: { description: 'Profile updated' }
  }
});

router.post(
  '/change-password',
  authMiddleware,
  [
    body('current_password').notEmpty(),
    body('new_password').isLength({ min: 8 })
  ],
  validate,
  asyncHandler(async (req, res) => {
    const result = await authService.changePassword(req.user.userId, req.body.current_password, req.body.new_password);
    res.json({ success: true, data: result });
  })
);

addRoute('/auth/change-password', 'post', {
  summary: 'Change password',
  tags: ['Auth'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['current_password', 'new_password'],
          properties: {
            current_password: { type: 'string' },
            new_password: { type: 'string', minLength: 8 }
          }
        }
      }
    }
  },
  responses: {
    200: { description: 'Password changed successfully' }
  }
});

export default router;