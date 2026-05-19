import { Router } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import adminService from './services/adminService.js';
import { authMiddleware } from '../../core/auth/jwt.js';
import { requireSuperAdmin } from '../../core/middleware/requirePermission.js';
import { asyncHandler, ValidationError } from '../../core/errors/index.js';
import { addRoute } from '../../docs/swagger.js';

const router = Router();

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) throw new ValidationError('Validation failed', errors.array());
  next();
};

// ─── USER MANAGEMENT ───

router.post('/users', authMiddleware, requireSuperAdmin(), [
  body('email').isEmail().withMessage('Valid email required'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('first_name').notEmpty().trim().withMessage('First name required'),
  body('last_name').optional().trim(),
  body('phone').optional().trim(),
  body('must_change_password').optional().isBoolean()
], validate, asyncHandler(async (req, res) => {
  const user = await adminService.createUser(req.body, req.user.userId);
  res.status(201).json({ success: true, data: user });
}));

addRoute('/admin/users', 'post', {
  summary: 'Create user (super admin only)',
  tags: ['Admin'],
  security: [{ bearerAuth: [] }],
  responses: { 201: { description: 'User created' } }
});

router.get('/users', authMiddleware, requireSuperAdmin(), [
  query('page').optional().isInt(),
  query('limit').optional().isInt(),
  query('search').optional().isString()
], validate, asyncHandler(async (req, res) => {
  const result = await adminService.listUsers({
    page: parseInt(req.query.page) || 1,
    limit: parseInt(req.query.limit) || 20,
    search: req.query.search
  });
  res.json({ success: true, data: result.data, pagination: result.pagination });
}));

router.get('/users/:id', authMiddleware, requireSuperAdmin(), [param('id').isUUID()], validate,
  asyncHandler(async (req, res) => {
    const user = await adminService.getUser(req.params.id, req.user.userId);
    res.json({ success: true, data: user });
  })
);

router.put('/users/:id', authMiddleware, requireSuperAdmin(), [param('id').isUUID(),
  body('first_name').optional(), body('last_name').optional(),
  body('phone').optional(), body('is_active').optional().isBoolean()
], validate, asyncHandler(async (req, res) => {
  const user = await adminService.updateUser(req.params.id, req.body, req.user.userId);
  res.json({ success: true, data: user });
}));

router.post('/users/:id/reset-password', authMiddleware, requireSuperAdmin(), [param('id').isUUID(),
  body('new_password').isLength({ min: 8 })
], validate, asyncHandler(async (req, res) => {
  await adminService.resetPassword(req.params.id, req.body.new_password, req.user.userId);
  res.json({ success: true, data: { message: 'Password reset successfully' } });
}));

router.post('/users/:id/toggle', authMiddleware, requireSuperAdmin(), [param('id').isUUID()],
  asyncHandler(async (req, res) => {
    const user = await adminService.toggleUser(req.params.id, req.user.userId);
    res.json({ success: true, data: user });
  })
);

// ─── TENANT MANAGEMENT ───

router.post('/tenants', authMiddleware, requireSuperAdmin(), [
  body('org.name').notEmpty().withMessage('Organization name required'),
  body('org.slug').optional().trim(),
  body('org.description').optional(),
  body('org.contact_email').optional().isEmail(),
  body('org.contact_phone').optional().trim(),
  body('org.website').optional().trim(),
  body('org.feature_flags').optional().isObject(),
  body('owner.email').isEmail().withMessage('Owner email required'),
  body('owner.first_name').notEmpty().withMessage('Owner first name required'),
  body('owner.password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('owner.last_name').optional(),
  body('owner.phone').optional(),
  body('subscription.plan_id').isIn(['free', 'starter', 'professional', 'enterprise']).withMessage('Valid plan required'),
  body('subscription.period_months').optional().isInt({ min: 1, max: 120 }).withMessage('Period must be 1-120 months'),
  body('subscription.trial_days').optional().isInt({ min: 0, max: 90 }).withMessage('Trial must be 0-90 days'),
  body('send_invitation').optional().isBoolean()
], validate, asyncHandler(async (req, res) => {
  const result = await adminService.onboardTenant(req.body, req.user.userId);
  res.status(201).json({ success: true, data: result });
}));

addRoute('/admin/tenants', 'post', {
  summary: 'Onboard new tenant with subscription (super admin only)',
  tags: ['Admin'],
  security: [{ bearerAuth: [] }],
  description: `Create a new organization, owner user, and assign a subscription plan.

**Request body:**
- \`org\`: Organization details (name, slug, description, contact info, feature flags)
- \`owner\`: Owner user details (email, password, first_name, last_name, phone)
- \`subscription\`: Subscription config
  - \`plan_id\*: \`free\` | \`starter\` | \`professional\` | \`enterprise\`
  - \`period_months\`: Billing period in months (default: 1)
  - \`trial_days\`: Free trial days before billing starts (default: 0)
- \`send_invitation\`: Send login credentials to owner (default: true)

**Example:**
\`\`\`json
{
  "org": { "name": "Nepal Football Association", "slug": "nfa" },
  "owner": { "email": "admin@nfa.com", "password": "secure123", "first_name": "Ram" },
  "subscription": { "plan_id": "starter", "period_months": 12, "trial_days": 14 }
}
\`\`\`` ,
  requestBody: {
    content: {
      'application/json': {
        example: {
          org: { name: 'Nepal Football Association', slug: 'nfa', description: 'Official football body', contact_email: 'admin@nfa.com' },
          owner: { email: 'admin@nfa.com', password: 'secure123', first_name: 'Ram', last_name: 'Shrestha' },
          subscription: { plan_id: 'starter', period_months: 12, trial_days: 14 },
          send_invitation: true
        }
      }
    }
  },
  responses: {
    201: {
      description: 'Tenant onboarded successfully',
      content: {
        'application/json': {
          example: {
            success: true,
            data: {
              organization: { id: 'uuid', name: 'Nepal Football Association', slug: 'nfa' },
              owner: { id: 'uuid', email: 'admin@nfa.com', first_name: 'Ram' },
              subscription: { plan_id: 'starter', status: 'active', trial_days: 14, current_period_start: '2026-05-19T...', current_period_end: '2027-06-02T...' },
              login_url: 'http://localhost:5173/login',
              credentials_sent: true
            }
          }
        }
      }
    }
  }
});

router.get('/tenants', authMiddleware, requireSuperAdmin(), [
  query('page').optional().isInt(),
  query('limit').optional().isInt(),
  query('status').optional().isIn(['active', 'suspended', 'inactive']),
  query('search').optional().isString()
], validate, asyncHandler(async (req, res) => {
  const result = await adminService.listTenants({
    page: parseInt(req.query.page) || 1,
    limit: parseInt(req.query.limit) || 20,
    status: req.query.status,
    search: req.query.search
  });
  res.json({ success: true, data: result.data, pagination: result.pagination });
}));

router.get('/tenants/:id', authMiddleware, requireSuperAdmin(), [param('id').isUUID()], validate,
  asyncHandler(async (req, res) => {
    const tenant = await adminService.getTenant(req.params.id, req.user.userId);
    res.json({ success: true, data: tenant });
  })
);

router.put('/tenants/:id', authMiddleware, requireSuperAdmin(), [param('id').isUUID(),
  body('name').optional(), body('description').optional(),
  body('status').optional().isIn(['active', 'suspended', 'inactive']),
  body('feature_flags').optional().isObject()
], validate, asyncHandler(async (req, res) => {
  const tenant = await adminService.updateTenant(req.params.id, req.body, req.user.userId);
  res.json({ success: true, data: tenant });
}));

router.post('/tenants/:id/suspend', authMiddleware, requireSuperAdmin(), [param('id').isUUID()],
  asyncHandler(async (req, res) => {
    const tenant = await adminService.suspendTenant(req.params.id, req.user.userId);
    res.json({ success: true, data: tenant });
  })
);

router.post('/tenants/:id/activate', authMiddleware, requireSuperAdmin(), [param('id').isUUID()],
  asyncHandler(async (req, res) => {
    const tenant = await adminService.activateTenant(req.params.id, req.user.userId);
    res.json({ success: true, data: tenant });
  })
);

router.post('/tenants/:id/subscription', authMiddleware, requireSuperAdmin(), [param('id').isUUID(),
  body('plan_id').isIn(['free', 'starter', 'professional', 'enterprise']).withMessage('Valid plan required'),
  body('period_months').optional().isInt({ min: 1, max: 120 }).withMessage('Period must be 1-120 months'),
  body('start_date').optional().isISO8601().withMessage('Valid date required')
], validate, asyncHandler(async (req, res) => {
  const sub = await adminService.assignSubscription(req.params.id, req.body, req.user.userId);
  res.json({ success: true, data: sub });
}));

addRoute('/admin/tenants/{id}/subscription', 'post', {
  summary: 'Assign or change tenant subscription (super admin only)',
  tags: ['Admin'],
  security: [{ bearerAuth: [] }],
  description: `Assign or upgrade/downgrade a tenant's subscription plan.

**Request body:**
- \`plan_id*\`: \`free\` | \`starter\` | \`professional\` | \`enterprise\`
- \`period_months\`: Billing period in months (default: 1)
- \`start_date\`: Custom start date (default: now)

**Example:**
\`\`\`json
{ "plan_id": "professional", "period_months": 6 }
\`\`\``,
  requestBody: {
    content: {
      'application/json': {
        example: { plan_id: 'professional', period_months: 6 }
      }
    }
  },
  responses: {
    200: {
      description: 'Subscription assigned',
      content: {
        'application/json': {
          example: {
            success: true,
            data: { id: 'uuid', plan_id: 'professional', status: 'active', current_period_start: '2026-05-19T...', current_period_end: '2026-11-19T...' }
          }
        }
      }
    }
  }
});

router.get('/tenants/:id/usage', authMiddleware, requireSuperAdmin(), [param('id').isUUID()], validate,
  asyncHandler(async (req, res) => {
    const usage = await adminService.getTenantUsage(req.params.id, req.user.userId);
    res.json({ success: true, data: usage });
  })
);

router.get('/tenants/:id/subscriptions', authMiddleware, requireSuperAdmin(), [param('id').isUUID()], validate,
  asyncHandler(async (req, res) => {
    const result = await db.query(
      `SELECT s.*, p.name as plan_name, p.price as plan_price
       FROM subscriptions s
       LEFT JOIN plans p ON s.plan_id = p.id
       WHERE s.organization_id = $1
       ORDER BY s.created_at DESC`,
      [req.params.id]
    );
    res.json({ success: true, data: result.rows });
  })
);

addRoute('/admin/tenants/{id}/subscriptions', 'get', {
  summary: 'Get tenant subscription history (super admin only)',
  tags: ['Admin'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Subscription history' } }
});

// ─── DASHBOARD ───

router.get('/dashboard', authMiddleware, requireSuperAdmin(),
  asyncHandler(async (req, res) => {
    const stats = await adminService.getDashboard();
    res.json({ success: true, data: stats });
  })
);

addRoute('/admin/dashboard', 'get', {
  summary: 'Get admin dashboard stats',
  tags: ['Admin'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Dashboard statistics' } }
});

// ─── PLANS ───

router.get('/plans', authMiddleware, requireSuperAdmin(),
  asyncHandler(async (req, res) => {
    const plans = await db.query(`SELECT * FROM plans WHERE is_active = TRUE ORDER BY price ASC`);
    res.json({ success: true, data: plans.rows });
  })
);

addRoute('/admin/plans', 'get', {
  summary: 'List available subscription plans (super admin only)',
  tags: ['Admin'],
  security: [{ bearerAuth: [] }],
  description: 'Get all available plans for tenant onboarding and subscription assignment.',
  responses: {
    200: {
      description: 'List of plans',
      content: {
        'application/json': {
          example: {
            success: true,
            data: [
              { id: 'free', name: 'Free', price: 0, interval: 'month', features: { tournaments: 5, teams: 10, players: 50, matches: 100 }, is_active: true },
              { id: 'starter', name: 'Starter', price: 9.99, interval: 'month', features: { tournaments: 20, teams: 50, players: 200, matches: 500 }, is_active: true },
              { id: 'professional', name: 'Professional', price: 29.99, interval: 'month', features: { tournaments: 100, teams: 200, players: 1000, matches: 2000 }, is_active: true },
              { id: 'enterprise', name: 'Enterprise', price: 99.99, interval: 'month', features: { tournaments: -1, teams: -1, players: -1, matches: -1 }, is_active: true }
            ]
          }
        }
      }
    }
  }
});

export default router;
