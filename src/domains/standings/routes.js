import { Router } from 'express';
import standingRepository from './repositories/standingRepository.js';
import { authMiddleware } from '../../core/auth/jwt.js';
import { asyncHandler } from '../../core/errors/index.js';
import { addRoute } from '../../docs/swagger.js';

const router = Router();

router.get('/tournament/:tournamentId', authMiddleware, asyncHandler(async (req, res) => {
  const standings = await standingRepository.findByTournament(req.params.tournamentId, req.query.group_name);
  res.json({ success: true, data: standings });
}));

addRoute('/standings/tournament/{tournamentId}', 'get', {
  summary: 'Get tournament standings',
  tags: ['Standings'],
  security: [{ bearerAuth: [] }],
  parameters: [{ name: 'group_name', in: 'query', schema: { type: 'string' } }],
  responses: { 200: { description: 'Standings list' } }
});

router.post('/tournament/:tournamentId/recalculate', authMiddleware, asyncHandler(async (req, res) => {
  const standings = await standingRepository.recalculateForTournament(req.params.tournamentId);
  res.json({ success: true, data: standings });
}));

addRoute('/standings/tournament/{tournamentId}/recalculate', 'post', {
  summary: 'Recalculate standings',
  tags: ['Standings'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Recalculated standings' } }
});

router.post('/tournament/:tournamentId/snapshot', authMiddleware, asyncHandler(async (req, res) => {
  const snapshot = await standingRepository.createSnapshot(req.params.tournamentId, req.body.group_name);
  res.status(201).json({ success: true, data: snapshot });
}));

addRoute('/standings/tournament/{tournamentId}/snapshot', 'post', {
  summary: 'Create standings snapshot',
  tags: ['Standings'],
  security: [{ bearerAuth: [] }],
  responses: { 201: { description: 'Snapshot created' } }
});

router.get('/tournament/:tournamentId/snapshots', authMiddleware, asyncHandler(async (req, res) => {
  const snapshots = await standingRepository.getSnapshots(req.params.tournamentId, parseInt(req.query.limit) || 10);
  res.json({ success: true, data: snapshots });
}));

addRoute('/standings/tournament/{tournamentId}/snapshots', 'get', {
  summary: 'Get standings history',
  tags: ['Standings'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'List of snapshots' } }
});

export default router;