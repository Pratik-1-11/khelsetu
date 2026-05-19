import { Router } from 'express';
import { body, validationResult } from 'express-validator';
import { FormationRepository, TacticalAnnotationRepository } from './repositories/tacticalRepository.js';
import { authMiddleware } from '../../core/auth/jwt.js';
import { asyncHandler, ValidationError } from '../../core/errors/index.js';
import { addRoute } from '../../docs/swagger.js';

const router = Router({ mergeParams: true });
const formationRepo = new FormationRepository();
const annotationRepo = new TacticalAnnotationRepository();

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) throw new ValidationError('Validation failed', errors.array());
  next();
};

router.post('/formations', authMiddleware, [
  body('match_id').isUUID(), body('team_id').isUUID(), body('formation_name').notEmpty(), body('positions').isArray()
], validate, asyncHandler(async (req, res) => {
  const formation = await formationRepo.create({ ...req.body, organization_id: req.headers['x-organization-id'], created_by: req.user.userId });
  res.status(201).json({ success: true, data: formation });
}));

addRoute('/visualization/formations', 'post', {
  summary: 'Create formation', tags: ['Visualization'], security: [{ bearerAuth: [] }],
  responses: { 201: { description: 'Formation created' } }
});

router.get('/formations/match/:matchId/team/:teamId', authMiddleware, asyncHandler(async (req, res) => {
  const formation = await formationRepo.findByMatch(req.params.matchId, req.params.teamId);
  res.json({ success: true, data: formation });
}));

addRoute('/visualization/formations/match/{matchId}/team/{teamId}', 'get', {
  summary: 'Get formation for match', tags: ['Visualization'], security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Formation data' } }
});

router.put('/formations/:id', authMiddleware, asyncHandler(async (req, res) => {
  const formation = await formationRepo.update(req.params.id, req.body);
  res.json({ success: true, data: formation });
}));

addRoute('/visualization/formations/{id}', 'put', {
  summary: 'Update formation', tags: ['Visualization'], security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Formation updated' } }
});

router.post('/annotations', authMiddleware, [
  body('match_id').isUUID(), body('annotation_type').isIn(['note', 'arrow', 'circle', 'highlight', 'formation_change']),
  body('coordinates').isObject()
], validate, asyncHandler(async (req, res) => {
  const annotation = await annotationRepo.create({ ...req.body, organization_id: req.headers['x-organization-id'], created_by: req.user.userId });
  res.status(201).json({ success: true, data: annotation });
}));

addRoute('/visualization/annotations', 'post', {
  summary: 'Create annotation', tags: ['Visualization'], security: [{ bearerAuth: [] }],
  responses: { 201: { description: 'Annotation created' } }
});

router.get('/annotations/match/:matchId', authMiddleware, asyncHandler(async (req, res) => {
  const annotations = await annotationRepo.findByMatch(req.params.matchId);
  res.json({ success: true, data: annotations });
}));

addRoute('/visualization/annotations/match/{matchId}', 'get', {
  summary: 'Get match annotations', tags: ['Visualization'], security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'List of annotations' } }
});

router.delete('/annotations/:id', authMiddleware, asyncHandler(async (req, res) => {
  await annotationRepo.delete(req.params.id);
  res.json({ success: true, data: { message: 'Deleted' } });
}));

addRoute('/visualization/annotations/{id}', 'delete', {
  summary: 'Delete annotation', tags: ['Visualization'], security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Deleted' } }
});

export default router;