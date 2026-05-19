import express from 'express';
import basketballController from './basketballController.js';
import { authMiddleware } from '../../core/auth/jwt.js';
import { addRoute } from '../../docs/swagger.js';

const router = express.Router();

router.post('/matches/:matchId/basketball/initialize', authMiddleware, basketballController.initializeMatch);
router.post('/matches/:matchId/basketball/field-goal', authMiddleware, basketballController.handleFieldGoal);
router.post('/matches/:matchId/basketball/free-throw', authMiddleware, basketballController.handleFreeThrow);
router.post('/matches/:matchId/basketball/rebound', authMiddleware, basketballController.handleRebound);
router.post('/matches/:matchId/basketball/assist', authMiddleware, basketballController.handleAssist);
router.post('/matches/:matchId/basketball/steal', authMiddleware, basketballController.handleSteal);
router.post('/matches/:matchId/basketball/turnover', authMiddleware, basketballController.handleTurnover);
router.post('/matches/:matchId/basketball/block', authMiddleware, basketballController.handleBlock);
router.post('/matches/:matchId/basketball/foul', authMiddleware, basketballController.handleFoul);
router.post('/matches/:matchId/basketball/timeout', authMiddleware, basketballController.handleTimeout);

router.post('/matches/:matchId/basketball/period/start', authMiddleware, basketballController.startPeriod);
router.post('/matches/:matchId/basketball/period/end', authMiddleware, basketballController.endPeriod);
router.post('/matches/:matchId/basketball/overtime/start', authMiddleware, basketballController.startOvertime);
router.post('/matches/:matchId/basketball/end', authMiddleware, basketballController.endMatch);

router.get('/matches/:matchId/basketball/state', basketballController.getGameState);
router.get('/matches/:matchId/basketball/stats', basketballController.getMatchStats);
router.get('/matches/:matchId/basketball/fouls/:teamId', basketballController.getTeamFouls);

router.post('/matches/:matchId/basketball/clock/game', authMiddleware, basketballController.updateGameClock);
router.post('/matches/:matchId/basketball/clock/shot', authMiddleware, basketballController.setShotClock);

// Swagger Documentation

addRoute('/matches/{matchId}/basketball/initialize', 'post', {
  summary: 'Initialize basketball match',
  tags: ['Basketball Scoring'],
  security: [{ bearerAuth: [] }],
  parameters: [{ in: 'path', name: 'matchId', required: true, schema: { type: 'string' } }],
  responses: { 200: { description: 'Match initialized' } }
});

addRoute('/matches/{matchId}/basketball/field-goal', 'post', {
  summary: 'Record field goal (2pt or 3pt)',
  tags: ['Basketball Scoring'],
  security: [{ bearerAuth: [] }],
  parameters: [{ in: 'path', name: 'matchId', required: true, schema: { type: 'string' } }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['team_id', 'player_id'],
          properties: {
            team_id: { type: 'string', description: 'Scoring team ID' },
            player_id: { type: 'string', description: 'Scoring player ID' },
            is_three_pointer: { type: 'boolean', default: false },
            shot_type: { type: 'string', enum: ['layup', 'dunk', 'jump_shot', 'hook', 'fadeaway'] },
            zone: { type: 'string', description: 'Shot zone' },
            distance: { type: 'number', description: 'Shot distance in feet' },
            is_and_one: { type: 'boolean', description: 'And-one situation' },
            is_shooting_foul: { type: 'boolean', description: 'Fouled on shot' },
            fouling_team_id: { type: 'string', description: 'Team that fouled' },
            fouled_player_id: { type: 'string', description: 'Player who was fouled' }
          }
        }
      }
    }
  },
  responses: { 201: { description: 'Field goal recorded' } }
});

addRoute('/matches/{matchId}/basketball/free-throw', 'post', {
  summary: 'Record free throw result',
  tags: ['Basketball Scoring'],
  security: [{ bearerAuth: [] }],
  parameters: [{ in: 'path', name: 'matchId', required: true, schema: { type: 'string' } }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['team_id', 'player_id', 'made', 'sequence_id'],
          properties: {
            team_id: { type: 'string' },
            player_id: { type: 'string' },
            made: { type: 'boolean', description: 'Whether free throw was made' },
            sequence_id: { type: 'string', description: 'Free throw sequence ID' }
          }
        }
      }
    }
  },
  responses: { 201: { description: 'Free throw recorded' } }
});

addRoute('/matches/{matchId}/basketball/rebound', 'post', {
  summary: 'Record rebound',
  tags: ['Basketball Scoring'],
  security: [{ bearerAuth: [] }],
  parameters: [{ in: 'path', name: 'matchId', required: true, schema: { type: 'string' } }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['team_id', 'player_id', 'rebound_type'],
          properties: {
            team_id: { type: 'string' },
            player_id: { type: 'string' },
            rebound_type: { type: 'string', enum: ['offensive', 'defensive'] }
          }
        }
      }
    }
  },
  responses: { 201: { description: 'Rebound recorded' } }
});

addRoute('/matches/{matchId}/basketball/assist', 'post', {
  summary: 'Record assist',
  tags: ['Basketball Scoring'],
  security: [{ bearerAuth: [] }],
  parameters: [{ in: 'path', name: 'matchId', required: true, schema: { type: 'string' } }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['team_id', 'player_id', 'assisted_player_id'],
          properties: {
            team_id: { type: 'string' },
            player_id: { type: 'string', description: 'Player who assisted' },
            assisted_player_id: { type: 'string', description: 'Player who scored' }
          }
        }
      }
    }
  },
  responses: { 201: { description: 'Assist recorded' } }
});

addRoute('/matches/{matchId}/basketball/steal', 'post', {
  summary: 'Record steal',
  tags: ['Basketball Scoring'],
  security: [{ bearerAuth: [] }],
  parameters: [{ in: 'path', name: 'matchId', required: true, schema: { type: 'string' } }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['team_id', 'player_id', 'stolen_from_player_id', 'stolen_from_team_id'],
          properties: {
            team_id: { type: 'string' },
            player_id: { type: 'string' },
            stolen_from_player_id: { type: 'string' },
            stolen_from_team_id: { type: 'string' }
          }
        }
      }
    }
  },
  responses: { 201: { description: 'Steal recorded' } }
});

addRoute('/matches/{matchId}/basketball/turnover', 'post', {
  summary: 'Record turnover',
  tags: ['Basketball Scoring'],
  security: [{ bearerAuth: [] }],
  parameters: [{ in: 'path', name: 'matchId', required: true, schema: { type: 'string' } }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['team_id', 'player_id'],
          properties: {
            team_id: { type: 'string' },
            player_id: { type: 'string' },
            turnover_type: { type: 'string', enum: ['traveling', 'double_dribble', 'lost_ball', 'out_of_bounds', 'violation', 'shot_clock'] }
          }
        }
      }
    }
  },
  responses: { 201: { description: 'Turnover recorded' } }
});

addRoute('/matches/{matchId}/basketball/block', 'post', {
  summary: 'Record block',
  tags: ['Basketball Scoring'],
  security: [{ bearerAuth: [] }],
  parameters: [{ in: 'path', name: 'matchId', required: true, schema: { type: 'string' } }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['team_id', 'player_id', 'blocked_player_id'],
          properties: {
            team_id: { type: 'string' },
            player_id: { type: 'string' },
            blocked_player_id: { type: 'string' }
          }
        }
      }
    }
  },
  responses: { 201: { description: 'Block recorded' } }
});

addRoute('/matches/{matchId}/basketball/foul', 'post', {
  summary: 'Record foul',
  tags: ['Basketball Scoring'],
  security: [{ bearerAuth: [] }],
  parameters: [{ in: 'path', name: 'matchId', required: true, schema: { type: 'string' } }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['team_id', 'player_id', 'foul_type'],
          properties: {
            team_id: { type: 'string', description: 'Team committing foul' },
            player_id: { type: 'string', description: 'Player committing foul' },
            foul_type: { type: 'string', enum: ['personal', 'shooting', 'offensive', 'technical', 'flagrant_1', 'flagrant_2'] },
            fouled_player_id: { type: 'string', description: 'Player fouled (for shooting fouls)' },
            fouled_team_id: { type: 'string', description: 'Team that was fouled' },
            is_shooting_foul: { type: 'boolean', default: false },
            shot_type: { type: 'string', enum: ['two_point', 'three_point'] }
          }
        }
      }
    }
  },
  responses: { 201: { description: 'Foul recorded' } }
});

addRoute('/matches/{matchId}/basketball/timeout', 'post', {
  summary: 'Call timeout',
  tags: ['Basketball Scoring'],
  security: [{ bearerAuth: [] }],
  parameters: [{ in: 'path', name: 'matchId', required: true, schema: { type: 'string' } }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['team_id'],
          properties: {
            team_id: { type: 'string' },
            timeout_type: { type: 'string', enum: ['full', 'short'], default: 'full' }
          }
        }
      }
    }
  },
  responses: { 201: { description: 'Timeout called' } }
});

addRoute('/matches/{matchId}/basketball/period/start', 'post', {
  summary: 'Start period (quarter/overtime)',
  tags: ['Basketball Scoring'],
  security: [{ bearerAuth: [] }],
  parameters: [{ in: 'path', name: 'matchId', required: true, schema: { type: 'string' } }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['period_number'],
          properties: {
            period_number: { type: 'integer', minimum: 1, maximum: 7, description: '1-4 for quarters, 5+ for overtime' }
          }
        }
      }
    }
  },
  responses: { 200: { description: 'Period started' } }
});

addRoute('/matches/{matchId}/basketball/period/end', 'post', {
  summary: 'End period',
  tags: ['Basketball Scoring'],
  security: [{ bearerAuth: [] }],
  parameters: [{ in: 'path', name: 'matchId', required: true, schema: { type: 'string' } }],
  requestBody: {
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            period_number: { type: 'integer' },
            injury_time: { type: 'integer', default: 0 }
          }
        }
      }
    }
  },
  responses: { 200: { description: 'Period ended' } }
});

addRoute('/matches/{matchId}/basketball/overtime/start', 'post', {
  summary: 'Start overtime',
  tags: ['Basketball Scoring'],
  security: [{ bearerAuth: [] }],
  parameters: [{ in: 'path', name: 'matchId', required: true, schema: { type: 'string' } }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['overtime_number'],
          properties: {
            overtime_number: { type: 'integer', minimum: 1 }
          }
        }
      }
    }
  },
  responses: { 200: { description: 'Overtime started' } }
});

addRoute('/matches/{matchId}/basketball/end', 'post', {
  summary: 'End basketball match',
  tags: ['Basketball Scoring'],
  security: [{ bearerAuth: [] }],
  parameters: [{ in: 'path', name: 'matchId', required: true, schema: { type: 'string' } }],
  requestBody: {
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            winner_id: { type: 'string', description: 'Winning team ID' }
          }
        }
      }
    }
  },
  responses: { 200: { description: 'Match ended' } }
});

addRoute('/matches/{matchId}/basketball/state', 'get', {
  summary: 'Get game state',
  description: 'Get current basketball game state including possession, fouls, stats, periods',
  tags: ['Basketball Scoring'],
  security: [{ bearerAuth: [] }],
  parameters: [{ in: 'path', name: 'matchId', required: true, schema: { type: 'string' } }],
  responses: { 200: { description: 'Game state object' } }
});

addRoute('/matches/{matchId}/basketball/stats', 'get', {
  summary: 'Get match statistics',
  tags: ['Basketball Scoring'],
  security: [{ bearerAuth: [] }],
  parameters: [{ in: 'path', name: 'matchId', required: true, schema: { type: 'string' } }],
  responses: { 200: { description: 'Player and team statistics' } }
});

addRoute('/matches/{matchId}/basketball/fouls/{teamId}', 'get', {
  summary: 'Get team fouls',
  tags: ['Basketball Scoring'],
  security: [{ bearerAuth: [] }],
  parameters: [
    { in: 'path', name: 'matchId', required: true, schema: { type: 'string' } },
    { in: 'path', name: 'teamId', required: true, schema: { type: 'string' } }
  ],
  responses: { 200: { description: 'Team foul count and bonus status' } }
});

addRoute('/matches/{matchId}/basketball/clock/game', 'post', {
  summary: 'Update game clock',
  tags: ['Basketball Scoring'],
  security: [{ bearerAuth: [] }],
  parameters: [{ in: 'path', name: 'matchId', required: true, schema: { type: 'string' } }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['clock_seconds'],
          properties: {
            clock_seconds: { type: 'integer', minimum: 0, maximum: 720, description: 'Game clock in seconds' }
          }
        }
      }
    }
  },
  responses: { 200: { description: 'Game clock updated' } }
});

addRoute('/matches/{matchId}/basketball/clock/shot', 'post', {
  summary: 'Set shot clock',
  tags: ['Basketball Scoring'],
  security: [{ bearerAuth: [] }],
  parameters: [{ in: 'path', name: 'matchId', required: true, schema: { type: 'string' } }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['seconds'],
          properties: {
            seconds: { type: 'integer', minimum: 0, maximum: 24, description: 'Shot clock in seconds' }
          }
        }
      }
    }
  },
  responses: { 200: { description: 'Shot clock set' } }
});

export default router;