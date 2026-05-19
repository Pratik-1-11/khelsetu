import { Router } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import billingService from './services/billingService.js';
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
  '/plans',
  asyncHandler(async (req, res) => {
    const plans = await billingService.getAvailablePlans();
    res.json({ success: true, data: plans });
  })
);

addRoute('/billing/plans', 'get', {
  summary: 'Get available subscription plans',
  tags: ['Billing'],
  responses: { 200: { description: 'List of plans' } }
});

router.get(
  '/subscriptions',
  authMiddleware,
  [query('organization_id').isUUID().withMessage('Valid organization ID required')],
  validate,
  asyncHandler(async (req, res) => {
    const subscription = await billingService.getOrganizationSubscription(req.query.organization_id, req.user.userId);
    res.json({ success: true, data: subscription });
  })
);

addRoute('/billing/subscriptions', 'get', {
  summary: 'Get organization subscription',
  tags: ['Billing'],
  security: [{ bearerAuth: [] }],
  parameters: [{ name: 'organization_id', in: 'query', required: true, schema: { type: 'string' } }],
  responses: { 200: { description: 'Subscription details' } }
});

router.post(
  '/subscriptions',
  authMiddleware,
  [
    body('organization_id').isUUID().withMessage('Valid organization ID required'),
    body('plan_id').isUUID().withMessage('Valid plan ID required'),
    body('payment_method_id').optional().isString()
  ],
  validate,
  asyncHandler(async (req, res) => {
    const subscription = await billingService.createSubscription(req.user.userId, req.body);
    res.status(201).json({ success: true, data: subscription });
  })
);

addRoute('/billing/subscriptions', 'post', {
  summary: 'Create subscription',
  tags: ['Billing'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['organization_id', 'plan_id'],
          properties: {
            organization_id: { type: 'string' },
            plan_id: { type: 'string' },
            payment_method_id: { type: 'string' }
          }
        }
      }
    }
  },
  responses: { 201: { description: 'Subscription created' } }
});

router.put(
  '/subscriptions/:id',
  authMiddleware,
  [
    body('plan_id').optional().isUUID(),
    body('status').optional().isIn(['active', 'paused', 'cancelled'])
  ],
  validate,
  asyncHandler(async (req, res) => {
    const subscription = await billingService.updateSubscription(req.params.id, req.user.userId, req.body);
    res.json({ success: true, data: subscription });
  })
);

addRoute('/billing/subscriptions/{id}', 'put', {
  summary: 'Update subscription',
  tags: ['Billing'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Subscription updated' } }
});

router.delete(
  '/subscriptions/:id',
  authMiddleware,
  asyncHandler(async (req, res) => {
    await billingService.cancelSubscription(req.params.id, req.user.userId);
    res.json({ success: true, data: { message: 'Subscription cancelled' } });
  })
);

addRoute('/billing/subscriptions/{id}', 'delete', {
  summary: 'Cancel subscription',
  tags: ['Billing'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Subscription cancelled' } }
});

router.get(
  '/invoices',
  authMiddleware,
  [
    query('organization_id').isUUID().withMessage('Valid organization ID required'),
    query('start_date').optional().isISO8601(),
    query('end_date').optional().isISO8601(),
    query('status').optional().isIn(['pending', 'paid', 'failed', 'cancelled'])
  ],
  validate,
  asyncHandler(async (req, res) => {
    const result = await billingService.getInvoices(req.query.organization_id, req.user.userId, {
      start_date: req.query.start_date,
      end_date: req.query.end_date,
      status: req.query.status,
      page: parseInt(req.query.page) || 1,
      limit: parseInt(req.query.limit) || 20
    });
    res.json({ success: true, data: result.data, pagination: result.pagination });
  })
);

addRoute('/billing/invoices', 'get', {
  summary: 'Get organization invoices',
  tags: ['Billing'],
  security: [{ bearerAuth: [] }],
  parameters: [
    { name: 'organization_id', in: 'query', required: true, schema: { type: 'string' } },
    { name: 'status', in: 'query', schema: { type: 'string', enum: ['pending', 'paid', 'failed', 'cancelled'] } }
  ],
  responses: { 200: { description: 'List of invoices' } }
});

router.get(
  '/invoices/:id',
  authMiddleware,
  [param('id').isUUID()],
  validate,
  asyncHandler(async (req, res) => {
    const invoice = await billingService.getInvoice(req.params.id, req.user.userId);
    res.json({ success: true, data: invoice });
  })
);

addRoute('/billing/invoices/{id}', 'get', {
  summary: 'Get invoice details',
  tags: ['Billing'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Invoice details' } }
});

router.get(
  '/usage',
  authMiddleware,
  [query('organization_id').isUUID().withMessage('Valid organization ID required')],
  validate,
  asyncHandler(async (req, res) => {
    const usage = await billingService.getUsage(req.query.organization_id, req.user.userId);
    res.json({ success: true, data: usage });
  })
);

addRoute('/billing/usage', 'get', {
  summary: 'Get usage statistics',
  tags: ['Billing'],
  security: [{ bearerAuth: [] }],
  parameters: [{ name: 'organization_id', in: 'query', required: true, schema: { type: 'string' } }],
  responses: { 200: { description: 'Usage data' } }
});

router.get(
  '/payment-methods',
  authMiddleware,
  [query('organization_id').isUUID().withMessage('Valid organization ID required')],
  validate,
  asyncHandler(async (req, res) => {
    const methods = await billingService.getPaymentMethods(req.query.organization_id, req.user.userId);
    res.json({ success: true, data: methods });
  })
);

addRoute('/billing/payment-methods', 'get', {
  summary: 'Get payment methods',
  tags: ['Billing'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'List of payment methods' } }
});

router.post(
  '/payment-methods',
  authMiddleware,
  [
    body('organization_id').isUUID().withMessage('Valid organization ID required'),
    body('token').notEmpty().withMessage('Payment token required'),
    body('type').isIn(['card', 'bank']).withMessage('Valid payment type required'),
    body('last_four').optional().isString(),
    body('brand').optional().isString()
  ],
  validate,
  asyncHandler(async (req, res) => {
    const method = await billingService.addPaymentMethod(req.user.userId, req.body);
    res.status(201).json({ success: true, data: method });
  })
);

addRoute('/billing/payment-methods', 'post', {
  summary: 'Add payment method',
  tags: ['Billing'],
  security: [{ bearerAuth: [] }],
  responses: { 201: { description: 'Payment method added' } }
});

router.delete(
  '/payment-methods/:id',
  authMiddleware,
  [param('id').isUUID()],
  validate,
  asyncHandler(async (req, res) => {
    await billingService.removePaymentMethod(req.params.id, req.user.userId);
    res.json({ success: true, data: { message: 'Payment method removed' } });
  })
);

addRoute('/billing/payment-methods/{id}', 'delete', {
  summary: 'Remove payment method',
  tags: ['Billing'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Payment method removed' } }
});

router.post(
  '/webhook',
  asyncHandler(async (req, res) => {
    const result = await billingService.handleWebhook(req.body, req.headers);
    res.json({ success: true, data: result });
  })
);

addRoute('/billing/webhook', 'post', {
  summary: 'Payment webhook',
  tags: ['Billing'],
  description: 'Webhook endpoint for payment provider callbacks',
  responses: { 200: { description: 'Webhook processed' } }
});

export default router;