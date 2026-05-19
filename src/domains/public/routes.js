import { Router } from 'express';
import db from '../../infrastructure/postgres/index.js';
import { optionalAuthMiddleware, authMiddleware } from '../../core/auth/jwt.js';
import { asyncHandler } from '../../core/errors/index.js';
import { addRoute } from '../../docs/swagger.js';
import publicMatchService from './services/publicMatchService.js';

const router = Router();

router.get('/tournaments', asyncHandler(async (req, res) => {
  const { status, sport_id, organization_id, page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;

  let sql = `SELECT t.id, t.name, t.slug, t.status, t.start_date, t.end_date, s.name as sport_name, s.slug as sport_slug, o.name as org_name FROM tournaments t LEFT JOIN sports s ON t.sport_id = s.id LEFT JOIN organizations o ON t.organization_id = o.id WHERE t.deleted_at IS NULL AND t.status IN ('registration_open', 'in_progress', 'completed')`;
  const params = [];

  if (status) { sql += ' AND t.status = $' + (params.length + 1); params.push(status); }
  if (sport_id) { sql += ' AND t.sport_id = $' + (params.length + 1); params.push(sport_id); }
  if (organization_id) { sql += ' AND t.organization_id = $' + (params.length + 1); params.push(organization_id); }

  sql += ' ORDER BY t.start_date DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
  params.push(parseInt(limit), offset);

  const result = await db.query(sql, params);
  res.json({ success: true, data: result.rows, pagination: { page: parseInt(page), limit: parseInt(limit) } });
}));

addRoute('/public/tournaments', 'get', {
  summary: 'Get public tournaments', tags: ['Public'], description: 'Public endpoint - no auth required',
  responses: { 200: { description: 'List of public tournaments' } }
});

router.get('/tournaments/:id', asyncHandler(async (req, res) => {
  const sql = `SELECT t.*, s.name as sport_name, o.name as org_name FROM tournaments t LEFT JOIN sports s ON t.sport_id = s.id LEFT JOIN organizations o ON t.organization_id = o.id WHERE t.id = $1 AND t.deleted_at IS NULL`;
  const result = await db.query(sql, [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Tournament not found' } });
  res.json({ success: true, data: result.rows[0] });
}));

addRoute('/public/tournaments/{id}', 'get', {
  summary: 'Get tournament details', tags: ['Public'],
  responses: { 200: { description: 'Tournament details' } }
});

router.get('/tournaments/:id/matches', asyncHandler(async (req, res) => {
  const sql = `SELECT m.id, m.home_score, m.away_score, m.status, m.scheduled_at, ht.name as home_team, at.name as away_team FROM matches m LEFT JOIN teams ht ON m.home_team_id = ht.id LEFT JOIN teams at ON m.away_team_id = at.id WHERE m.tournament_id = $1 AND m.deleted_at IS NULL AND m.status IN ('scheduled', 'live', 'completed') ORDER BY m.scheduled_at`;
  const result = await db.query(sql, [req.params.id]);
  res.json({ success: true, data: result.rows });
}));

router.get('/tournaments/:id/standings', asyncHandler(async (req, res) => {
  const sql = `SELECT s.position, s.played, s.won, s.drawn, s.lost, s.goals_for, s.goals_against, s.points, t.name as team_name FROM standings s JOIN teams t ON s.team_id = t.id WHERE s.tournament_id = $1 ORDER BY s.position`;
  const result = await db.query(sql, [req.params.id]);
  res.json({ success: true, data: result.rows });
}));

router.get('/matches/:id', asyncHandler(async (req, res) => {
  const sql = `SELECT m.*, ht.name as home_team, at.name as away_team, t.name as tournament_name FROM matches m LEFT JOIN teams ht ON m.home_team_id = ht.id LEFT JOIN teams at ON m.away_team_id = at.id LEFT JOIN tournaments t ON m.tournament_id = t.id WHERE m.id = $1 AND m.deleted_at IS NULL`;
  const result = await db.query(sql, [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Match not found' } });
  res.json({ success: true, data: result.rows[0] });
}));

router.get('/matches/:id/score', asyncHandler(async (req, res) => {
  const sql = `SELECT home_score, away_score, status, started_at, ended_at FROM matches WHERE id = $1`;
  const result = await db.query(sql, [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Match not found' } });
  res.json({ success: true, data: result.rows[0] });
}));

addRoute('/public/matches/{id}/score', 'get', {
  summary: 'Get match score (no login)', tags: ['Public'],
  responses: { 200: { description: 'Current score' } }
});

router.get('/teams/:id', asyncHandler(async (req, res) => {
  const sql = `SELECT t.*, o.name as org_name FROM teams t LEFT JOIN organizations o ON t.organization_id = o.id WHERE t.id = $1 AND t.deleted_at IS NULL`;
  const result = await db.query(sql, [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Team not found' } });
  res.json({ success: true, data: result.rows[0] });
}));

router.get('/sports', asyncHandler(async (req, res) => {
  const sql = `SELECT id, name, slug, icon FROM sports WHERE is_active = TRUE AND deleted_at IS NULL ORDER BY name`;
  const result = await db.query(sql, []);
  res.json({ success: true, data: result.rows });
}));

router.get('/tournaments/:id/teams', asyncHandler(async (req, res) => {
  const sql = `SELECT t.id, t.name, t.slug, t.logo, tt.seed_number, tt.status as registration_status FROM tournament_teams tt JOIN teams t ON tt.team_id = t.id WHERE tt.tournament_id = $1 AND tt.deleted_at IS NULL AND t.deleted_at IS NULL ORDER BY tt.seed_number ASC, t.name`;
  const result = await db.query(sql, [req.params.id]);
  res.json({ success: true, data: result.rows });
}));

router.get('/tournaments/:id/fixtures', asyncHandler(async (req, res) => {
  const sql = `SELECT m.id, m.round_number, m.group_name, m.scheduled_at, m.venue, m.status, ht.id as home_team_id, ht.name as home_team, ht.logo as home_logo, at.id as away_team_id, at.name as away_team, at.logo as away_logo, m.home_score, m.away_score FROM matches m LEFT JOIN teams ht ON m.home_team_id = ht.id LEFT JOIN teams at ON m.away_team_id = at.id WHERE m.tournament_id = $1 AND m.deleted_at IS NULL ORDER BY m.round_number, m.group_name, m.scheduled_at`;
  const result = await db.query(sql, [req.params.id]);
  res.json({ success: true, data: result.rows });
}));

router.get('/teams/:id/players', asyncHandler(async (req, res) => {
  const sql = `SELECT p.id, p.first_name, p.last_name, p.jersey_number, p.position, p.photo, pt.role, pt.is_active FROM player_teams pt JOIN players p ON pt.player_id = p.id WHERE pt.team_id = $1 AND pt.is_active = TRUE AND p.deleted_at IS NULL ORDER BY pt.role DESC, p.jersey_number`;
  const result = await db.query(sql, [req.params.id]);
  res.json({ success: true, data: result.rows });
}));

router.get('/players/:id', asyncHandler(async (req, res) => {
  const sql = `SELECT p.*, o.name as org_name FROM players p LEFT JOIN organizations o ON p.organization_id = o.id WHERE p.id = $1 AND p.deleted_at IS NULL`;
  const result = await db.query(sql, [req.params.id]);
  if (!result.rows[0]) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Player not found' } });
  res.json({ success: true, data: result.rows[0] });
}));

router.get('/search', asyncHandler(async (req, res) => {
  const { q, type, limit = 10 } = req.query;
  if (!q) return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'Search query required' } });

  const results = { tournaments: [], teams: [], players: [] };
  const searchTerm = `%${q}%`;

  if (!type || type === 'tournaments') {
    const tournaments = await db.query(
      `SELECT id, name, slug, 'tournament' as type FROM tournaments WHERE name LIKE $1 AND deleted_at IS NULL AND status IN ('registration_open', 'in_progress', 'completed') LIMIT $2`,
      [searchTerm, parseInt(limit)]
    );
    results.tournaments = tournaments.rows;
  }

  if (!type || type === 'teams') {
    const teams = await db.query(
      `SELECT id, name, slug, 'team' as type FROM teams WHERE name LIKE $1 AND deleted_at IS NULL LIMIT $2`,
      [searchTerm, parseInt(limit)]
    );
    results.teams = teams.rows;
  }

  if (!type || type === 'players') {
    const players = await db.query(
      `SELECT id, first_name, last_name, first_name || ' ' || COALESCE(last_name, '') as name, 'player' as type FROM players WHERE (first_name LIKE $1 OR last_name LIKE $1) AND deleted_at IS NULL LIMIT $2`,
      [searchTerm, parseInt(limit)]
    );
    results.players = players.rows;
  }

  res.json({ success: true, data: results });
}));

router.get('/user/quota', authMiddleware, asyncHandler(async (req, res) => {
  const quota = await publicMatchService.checkQuota(req.user.userId);
  res.json({ success: true, data: quota });
}));

addRoute('/public/user/quota', 'get', {
  summary: 'Check free match quota', tags: ['Public'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Quota info' } }
});

router.post('/matches/create', authMiddleware, asyncHandler(async (req, res) => {
  const { home_team_id, away_team_id, tournament_id, tournament_name, sport_slug } = req.body;
  if (!home_team_id || !away_team_id) {
    return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'home_team_id and away_team_id required' } });
  }
  const result = await publicMatchService.createFreeMatch(req.user.userId, {
    home_team_id, away_team_id, tournament_id, tournament_name, sport_slug,
  });
  res.status(201).json({ success: true, data: result });
}));

addRoute('/public/matches/create', 'post', {
  summary: 'Create free match (login required)', tags: ['Public'],
  security: [{ bearerAuth: [] }],
  responses: { 201: { description: 'Match created' } }
});

router.get('/plans', asyncHandler(async (req, res) => {
  const result = await db.query(`SELECT id, name, price, interval, features FROM plans WHERE is_active = TRUE ORDER BY price ASC`);
  res.json({ success: true, data: result.rows });
}));

addRoute('/public/plans', 'get', {
  summary: 'List available plans (no login)', tags: ['Public'],
  responses: { 200: { description: 'List of plans' } }
});

export default router;
