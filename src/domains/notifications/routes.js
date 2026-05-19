import { Router } from 'express';
import { body, validationResult } from 'express-validator';
import notificationService from './services/notificationService.js';
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

router.get('/', authMiddleware, asyncHandler(async (req, res) => {
  const result = await notificationService.getUserNotifications(req.user.userId, {
    page: parseInt(req.query.page) || 1,
    limit: parseInt(req.query.limit) || 20,
    unreadOnly: req.query.unread === 'true'
  });
  res.json({ success: true, data: result.data, pagination: result.pagination });
}));

addRoute('/notifications', 'get', {
  summary: 'Get user notifications',
  tags: ['Notifications'],
  security: [{ bearerAuth: [] }],
  parameters: [
    { name: 'unread', in: 'query', schema: { type: 'boolean' } },
    { name: 'page', in: 'query', schema: { type: 'integer' } },
    { name: 'limit', in: 'query', schema: { type: 'integer' } }
  ],
  responses: { 200: { description: 'List of notifications' } }
});

router.get('/unread-count', authMiddleware, asyncHandler(async (req, res) => {
  const count = await notificationService.getUnreadCount(req.user.userId);
  res.json({ success: true, data: { count } });
}));

addRoute('/notifications/unread-count', 'get', {
  summary: 'Get unread notification count',
  tags: ['Notifications'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Unread count' } }
});

router.post('/read-all', authMiddleware, asyncHandler(async (req, res) => {
  const count = await notificationService.markAllAsRead(req.user.userId);
  res.json({ success: true, data: { marked_count: count } });
}));

addRoute('/notifications/read-all', 'post', {
  summary: 'Mark all as read',
  tags: ['Notifications'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'All marked as read' } }
});

router.post('/:id/read', authMiddleware, asyncHandler(async (req, res) => {
  const notification = await notificationService.markAsRead(req.params.id, req.user.userId);
  res.json({ success: true, data: notification });
}));

addRoute('/notifications/{id}/read', 'post', {
  summary: 'Mark notification as read',
  tags: ['Notifications'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Notification marked as read' } }
});

router.delete('/:id', authMiddleware, asyncHandler(async (req, res) => {
  await notificationService.delete(req.params.id, req.user.userId);
  res.json({ success: true, data: { message: 'Notification deleted' } });
}));

addRoute('/notifications/{id}', 'delete', {
  summary: 'Delete notification',
  tags: ['Notifications'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Notification deleted' } }
});

export default router;