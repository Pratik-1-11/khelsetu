import { Router } from 'express';
import { body, validationResult } from 'express-validator';
import syncService from './services/syncService.js';
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
  '/queue',
  authMiddleware,
  [
    body('operation').isIn(['create', 'update', 'delete']).withMessage('Valid operation required'),
    body('entity_type').notEmpty().withMessage('Entity type required'),
    body('payload').isObject().withMessage('Payload required'),
    body('client_event_id').optional().isString(),
    body('idempotency_key').optional().isString(),
    body('device_id').optional().isString()
  ],
  validate,
  asyncHandler(async (req, res) => {
    const organizationId = req.headers['x-organization-id'];
    if (!organizationId) {
      throw new ValidationError('Organization ID required in header');
    }

    const result = await syncService.queueOperation(organizationId, req.user.userId, {
      ...req.body,
      device_id: req.body.device_id || req.headers['x-device-id']
    });

    res.status(result.existing || result.duplicate ? 200 : 201).json({ success: true, data: result });
  })
);

addRoute('/sync/queue', 'post', {
  summary: 'Queue operation for sync',
  tags: ['Sync'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['operation', 'entity_type', 'payload'],
          properties: {
            operation: { type: 'string', enum: ['create', 'update', 'delete'] },
            entity_type: { type: 'string' },
            payload: { type: 'object' },
            client_event_id: { type: 'string' },
            idempotency_key: { type: 'string' },
            device_id: { type: 'string' }
          }
        }
      }
    }
  },
  responses: { 201: { description: 'Operation queued' } }
});

router.post('/process', authMiddleware, asyncHandler(async (req, res) => {
  const organizationId = req.headers['x-organization-id'];
  const deviceId = req.headers['x-device-id'];

  if (!organizationId) {
    throw new ValidationError('Organization ID required in header');
  }

  const result = await syncService.processQueue(organizationId, deviceId);
  res.json({ success: true, data: result });
}));

addRoute('/sync/process', 'post', {
  summary: 'Process pending sync items',
  tags: ['Sync'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Queue processed' } }
});

router.get('/status', authMiddleware, asyncHandler(async (req, res) => {
  const organizationId = req.headers['x-organization-id'];
  const deviceId = req.headers['x-device-id'];

  if (!organizationId) {
    throw new ValidationError('Organization ID required in header');
  }

  const result = await syncService.getSyncStatus(organizationId, deviceId);
  res.json({ success: true, data: result });
}));

addRoute('/sync/status', 'get', {
  summary: 'Get sync status',
  tags: ['Sync'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Sync status' } }
});

router.post(
  '/conflicts/:syncItemId/resolve',
  authMiddleware,
  [body('resolution').isIn(['accept_server', 'accept_client', 'discard']).withMessage('Valid resolution required')],
  validate,
  asyncHandler(async (req, res) => {
    const result = await syncService.resolveConflict(req.params.syncItemId, req.body.resolution);
    res.json({ success: true, data: result });
  })
);

addRoute('/sync/conflicts/{syncItemId}/resolve', 'post', {
  summary: 'Resolve sync conflict',
  tags: ['Sync'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Conflict resolved' } }
});

router.post(
  '/device/register',
  authMiddleware,
  [
    body('device_id').notEmpty().withMessage('Device ID required'),
    body('device_name').optional().trim(),
    body('device_type').optional().trim(),
    body('os_version').optional().trim(),
    body('app_version').optional().trim()
  ],
  validate,
  asyncHandler(async (req, res) => {
    const organizationId = req.headers['x-organization-id'];
    if (!organizationId) {
      throw new ValidationError('Organization ID required in header');
    }

    const device = await syncService.registerDevice(organizationId, req.user.userId, req.body);
    res.status(201).json({ success: true, data: device });
  })
);

addRoute('/sync/device/register', 'post', {
  summary: 'Register device',
  tags: ['Sync'],
  security: [{ bearerAuth: [] }],
  responses: { 201: { description: 'Device registered' } }
});

router.get('/device', authMiddleware, asyncHandler(async (req, res) => {
  const organizationId = req.headers['x-organization-id'];
  const deviceId = req.headers['x-device-id'];

  if (!organizationId || !deviceId) {
    throw new ValidationError('Organization ID and Device ID required in headers');
  }

  const device = await syncService.getDeviceInfo(organizationId, deviceId);
  res.json({ success: true, data: device });
}));

addRoute('/sync/device', 'get', {
  summary: 'Get device info',
  tags: ['Sync'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Device info' } }
});

export default router;