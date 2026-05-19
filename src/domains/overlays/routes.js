import { Router } from 'express';
import { body, validationResult } from 'express-validator';
import overlayService from './services/overlayService.js';
import { authMiddleware, optionalAuthMiddleware } from '../../core/auth/jwt.js';
import { asyncHandler, ValidationError } from '../../core/errors/index.js';
import { addRoute } from '../../docs/swagger.js';

const router = Router({ mergeParams: true });

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) throw new ValidationError('Validation failed', errors.array());
  next();
};

router.post('/templates', authMiddleware, [
  body('organization_id').isUUID(), body('name').notEmpty(), body('template_config').isObject()
], validate, asyncHandler(async (req, res) => {
  const template = await overlayService.createTemplate(req.body, req.user.userId);
  res.status(201).json({ success: true, data: template });
}));

addRoute('/overlays/templates', 'post', {
  summary: 'Create overlay template', tags: ['Overlays'], security: [{ bearerAuth: [] }],
  responses: { 201: { description: 'Template created' } }
});

router.get('/templates', authMiddleware, asyncHandler(async (req, res) => {
  const { organization_id } = req.query;
  if (!organization_id) throw new ValidationError('organization_id required');
  const templates = await overlayService.getTemplates(organization_id, req.user.userId);
  res.json({ success: true, data: templates });
}));

addRoute('/overlays/templates', 'get', {
  summary: 'Get overlay templates', tags: ['Overlays'], security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'List of templates' } }
});

router.get('/templates/:id', authMiddleware, asyncHandler(async (req, res) => {
  const template = await overlayService.getTemplate(req.params.id, req.user.userId);
  res.json({ success: true, data: template });
}));

router.post('/', authMiddleware, [
  body('organization_id').isUUID(), body('template_id').isUUID(), body('name').notEmpty()
], validate, asyncHandler(async (req, res) => {
  const overlay = await overlayService.createLiveOverlay(req.body, req.user.userId);
  res.status(201).json({ success: true, data: overlay });
}));

addRoute('/overlays', 'post', {
  summary: 'Create live overlay', tags: ['Overlays'], security: [{ bearerAuth: [] }],
  responses: { 201: { description: 'Overlay created' } }
});

router.get('/', authMiddleware, asyncHandler(async (req, res) => {
  const overlays = await overlayService.getLiveOverlays(req.query.tournament_id, req.query.match_id, req.user.userId);
  res.json({ success: true, data: overlays });
}));

addRoute('/overlays', 'get', {
  summary: 'Get live overlays', tags: ['Overlays'], security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'List of overlays' } }
});

router.post('/:id/activate', authMiddleware, asyncHandler(async (req, res) => {
  const overlay = await overlayService.activateOverlay(req.params.id, req.user.userId);
  res.json({ success: true, data: overlay });
}));

addRoute('/overlays/{id}/activate', 'post', {
  summary: 'Activate overlay', tags: ['Overlays'], security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Overlay activated' } }
});

router.post('/:id/deactivate', authMiddleware, asyncHandler(async (req, res) => {
  const overlay = await overlayService.deactivateOverlay(req.params.id, req.user.userId);
  res.json({ success: true, data: overlay });
}));

addRoute('/overlays/{id}/deactivate', 'post', {
  summary: 'Deactivate overlay', tags: ['Overlays'], security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Overlay deactivated' } }
});

router.get('/public/:token', optionalAuthMiddleware, asyncHandler(async (req, res) => {
  const overlay = await overlayService.getPublicOverlay(req.params.token);
  res.json({ success: true, data: { name: overlay.name, config: overlay.overlay_config, is_public: overlay.is_public } });
}));

addRoute('/overlays/public/{token}', 'get', {
  summary: 'Get public overlay', tags: ['Overlays'],
  responses: { 200: { description: 'Public overlay data' } }
});

export default router;