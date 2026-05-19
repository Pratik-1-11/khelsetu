import { Router } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import scoringService from './services/scoringService.js';
import substitutionService from './services/substitutionService.js';
import matchPeriodService from './services/matchPeriodService.js';
import varService from './services/varService.js';
import penaltyShootoutService from './services/penaltyShootoutService.js';
import eventCorrectionService from './services/eventCorrectionService.js';
import playerEligibilityService from './services/playerEligibilityService.js';
import matchRepository from '../matches/repositories/matchRepository.js';
import { authMiddleware } from '../../core/auth/jwt.js';
import { asyncHandler, ValidationError } from '../../core/errors/index.js';
import { addRoute } from '../../docs/swagger.js';
import db from '../../infrastructure/postgres/index.js';
import { generateUUID } from '../../core/utils/index.js';

const router = Router({ mergeParams: true });

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    throw new ValidationError('Validation failed', errors.array());
  }
  next();
};

router.post(
  '/lineup',
  authMiddleware,
  [
    body('team_id').isUUID().withMessage('Team ID is required'),
    body('players').isArray({ min: 7, max: 11 }).withMessage('Must have 7-11 players'),
    body('players.*.player_id').isUUID(),
    body('players.*.position').optional().isString(),
    body('players.*.shirt_number').optional().isInt({ min: 1, max: 99 }),
    body('bench').optional().isArray({ max: 7 })
  ],
  validate,
  asyncHandler(async (req, res) => {
    const { team_id, players, bench = [] } = req.body;
    
    await db.query('DELETE FROM match_lineups WHERE match_id = ? AND team_id = ?', [req.params.matchId, team_id]);
    
    for (const player of players) {
      await db.query(
        `INSERT INTO match_lineups (id, match_id, team_id, player_id, position, is_starting, is_on_bench, shirt_number)
         VALUES (?, ?, ?, ?, ?, TRUE, FALSE, ?)`,
        [generateUUID(), req.params.matchId, team_id, player.player_id, player.position, player.shirt_number]
      );
    }
    
    for (const player of bench) {
      await db.query(
        `INSERT INTO match_lineups (id, match_id, team_id, player_id, position, is_starting, is_on_bench, shirt_number)
         VALUES (?, ?, ?, ?, ?, FALSE, TRUE, ?)`,
        [generateUUID(), req.params.matchId, team_id, player.player_id, player.position, player.shirt_number]
      );
    }

    res.status(201).json({ success: true, message: 'Lineup saved' });
  })
);

addRoute('/scoring/matches/{matchId}/football/lineup', 'post', {
  summary: 'Set match lineup',
  tags: ['Football Scoring'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['team_id', 'players'],
          properties: {
            team_id: { type: 'string' },
            players: { type: 'array', items: { type: 'object' } },
            bench: { type: 'array' }
          }
        }
      }
    }
  },
  responses: { 201: { description: 'Lineup saved' } }
});

router.post(
  '/substitutions',
  authMiddleware,
  [
    body('team_id').isUUID().withMessage('Team ID is required'),
    body('player_in_id').isUUID().withMessage('Player coming in is required'),
    body('player_out_id').isUUID().withMessage('Player going out is required'),
    body('minute').isInt({ min: 0, max: 130 }).withMessage('Valid minute required'),
    body('reason').optional().isIn(['tactical', 'injury', 'red_card', 'other'])
  ],
  validate,
  asyncHandler(async (req, res) => {
    const result = await substitutionService.performSubstitution(
      req.params.matchId,
      req.body.team_id,
      req.body.player_in_id,
      req.body.player_out_id,
      req.body.minute,
      req.body.reason || 'tactical'
    );
    res.status(201).json({ success: true, data: result });
  })
);

addRoute('/scoring/matches/{matchId}/football/substitutions', 'post', {
  summary: 'Perform substitution',
  tags: ['Football Scoring'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['team_id', 'player_in_id', 'player_out_id', 'minute'],
          properties: {
            team_id: { type: 'string' },
            player_in_id: { type: 'string' },
            player_out_id: { type: 'string' },
            minute: { type: 'integer' },
            reason: { type: 'string', enum: ['tactical', 'injury', 'red_card', 'other'] }
          }
        }
      }
    }
  },
  responses: { 201: { description: 'Substitution performed' } }
});

router.get('/substitutions', authMiddleware, asyncHandler(async (req, res) => {
  const substitutions = await substitutionService.getMatchSubstitutions(req.params.matchId);
  res.json({ success: true, data: substitutions });
}));

router.get('/substitutions/:teamId/status', authMiddleware, asyncHandler(async (req, res) => {
  const status = await substitutionService.getTeamSubstitutionStatus(req.params.matchId, req.params.teamId);
  res.json({ success: true, data: status });
}));

addRoute('/scoring/matches/{matchId}/football/substitutions/{teamId}/status', 'get', {
  summary: 'Get team substitution status',
  tags: ['Football Scoring'],
  security: [{ bearerAuth: [] }],
  parameters: [{
    name: 'teamId',
    in: 'path',
    required: true,
    schema: { type: 'string', format: 'uuid' }
  }],
  responses: { 200: { description: 'Team substitution status' } }
});

addRoute('/scoring/matches/{matchId}/football/substitutions', 'get', {
  summary: 'Get match substitutions',
  tags: ['Football Scoring'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'List of substitutions' } }
});

router.post(
  '/period/start',
  authMiddleware,
  [
    body('period').isIn(['first_half', 'second_half', 'extra_time_first', 'extra_time_second', 'penalties'])
      .withMessage('Valid period required')
  ],
  validate,
  asyncHandler(async (req, res) => {
    const match = await matchRepository.findById(req.params.matchId);
    
    if (req.body.period === 'first_half') {
      const result = await matchPeriodService.startFirstHalf(req.params.matchId, req.user.userId);
      return res.json({ success: true, data: result });
    }
    
    if (req.body.period === 'second_half') {
      const result = await matchPeriodService.startSecondHalf(req.params.matchId);
      return res.json({ success: true, data: result });
    }
    
    if (req.body.period === 'extra_time_first') {
      const result = await matchPeriodService.startExtraTime(req.params.matchId);
      return res.json({ success: true, data: result });
    }
    
    if (req.body.period === 'penalties') {
      const result = await matchPeriodService.startPenalties(req.params.matchId);
      return res.json({ success: true, data: result });
    }
    
    throw new ValidationError('Invalid period transition');
  })
);

router.post(
  '/period/end',
  authMiddleware,
  [
    body('injury_time').optional().isInt({ min: 0, max: 15 })
  ],
  validate,
  asyncHandler(async (req, res) => {
    const currentPeriod = await matchPeriodService.getCurrentPeriod(req.params.matchId);
    
    if (!currentPeriod) {
      throw new ValidationError('No active period');
    }
    
    let result;
    
    if (currentPeriod.period_type === 'first_half') {
      result = await matchPeriodService.startHalftime(req.params.matchId, req.body.injury_time || 0);
    } else if (currentPeriod.period_type === 'second_half') {
      result = await matchPeriodService.endSecondHalf(req.params.matchId, req.body.injury_time || 0);
    } else if (currentPeriod.period_type === 'extra_time_first') {
      result = await matchPeriodService.endExtraTime(req.params.matchId, req.body.injury_time || 0);
    } else if (currentPeriod.period_type === 'extra_time_second') {
      result = await matchPeriodService.endExtraTime(req.params.matchId, req.body.injury_time || 0);
    } else {
      throw new ValidationError('Cannot end this period directly');
    }
    
    res.json({ success: true, data: result });
  })
);

addRoute('/scoring/matches/{matchId}/football/period/start', 'post', {
  summary: 'Start match period',
  tags: ['Football Scoring'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['period'],
          properties: {
            period: { type: 'string', enum: ['first_half', 'second_half', 'extra_time_first', 'penalties'] }
          }
        }
      }
    }
  },
  responses: { 200: { description: 'Period started' } }
});

addRoute('/scoring/matches/{matchId}/football/period/end', 'post', {
  summary: 'End current period',
  tags: ['Football Scoring'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            injury_time: { type: 'integer' }
          }
        }
      }
    }
  },
  responses: { 200: { description: 'Period ended' } }
});

router.get('/period/current', authMiddleware, asyncHandler(async (req, res) => {
  const period = await matchPeriodService.getCurrentPeriod(req.params.matchId);
  res.json({ success: true, data: period });
}));

addRoute('/scoring/matches/{matchId}/football/period/current', 'get', {
  summary: 'Get current match period',
  tags: ['Football Scoring'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Current period details' } }
});

router.get('/periods', authMiddleware, asyncHandler(async (req, res) => {
  const periods = await matchPeriodService.getMatchPeriods(req.params.matchId);
  res.json({ success: true, data: periods });
}));

addRoute('/scoring/matches/{matchId}/football/periods', 'get', {
  summary: 'Get all match periods',
  tags: ['Football Scoring'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'List of all periods' } }
});

router.patch(
  '/period/injury-time',
  authMiddleware,
  [body('minutes').isInt({ min: 0, max: 15 })],
  validate,
  asyncHandler(async (req, res) => {
    const result = await matchPeriodService.updateInjuryTime(req.params.matchId, req.body.minutes);
    res.json({ success: true, data: result });
  })
);

addRoute('/scoring/matches/{matchId}/football/period/injury-time', 'patch', {
  summary: 'Update injury time',
  tags: ['Football Scoring'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['minutes'],
          properties: {
            minutes: { type: 'integer', minimum: 0, maximum: 15 }
          }
        }
      }
    }
  },
  responses: { 200: { description: 'Injury time updated' } }
});

router.get('/cards/:playerId', authMiddleware, asyncHandler(async (req, res) => {
  const cards = await scoringService.getPlayerCardsInMatch(req.params.matchId, req.params.playerId);
  res.json({ success: true, data: cards });
}));

router.post('/verify-replay', authMiddleware, asyncHandler(async (req, res) => {
  const result = await scoringService.deterministicReplay(req.params.matchId);
  res.json({ success: true, data: result });
}));

addRoute('/scoring/matches/{matchId}/football/verify-replay', 'post', {
  summary: 'Verify deterministic replay',
  tags: ['Football Scoring'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Replay verification result' } }
});

router.post(
  '/match/end',
  authMiddleware,
  [
    body('winner_id').optional().isUUID()
  ],
  validate,
  asyncHandler(async (req, res) => {
    const result = await matchPeriodService.endMatch(req.params.matchId, req.body.winner_id || null);
    res.json({ success: true, data: result });
  })
);

addRoute('/scoring/matches/{matchId}/football/match/end', 'post', {
  summary: 'End match',
  tags: ['Football Scoring'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            winner_id: { type: 'string' }
          }
        }
      }
    }
  },
  responses: { 200: { description: 'Match ended' } }
});

router.post(
  '/var/initiate',
  authMiddleware,
  [
    body('review_type').isIn(['goal', 'penalty', 'red_card', 'goal_denial', 'other']).withMessage('Valid review type required'),
    body('original_event_id').isUUID().withMessage('Original event ID required'),
    body('original_decision').isString().withMessage('Original decision required')
  ],
  validate,
  asyncHandler(async (req, res) => {
    const result = await varService.initiateReview(
      req.params.matchId,
      req.body.review_type,
      req.body.original_event_id,
      req.body.original_decision,
      req.user.userId
    );
    res.status(201).json({ success: true, data: result });
  })
);

addRoute('/scoring/matches/{matchId}/football/var/initiate', 'post', {
  summary: 'Initiate VAR review',
  tags: ['Football VAR'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['review_type', 'original_event_id', 'original_decision'],
          properties: {
            review_type: { type: 'string', enum: ['goal', 'penalty', 'red_card', 'goal_denial', 'other'] },
            original_event_id: { type: 'string' },
            original_decision: { type: 'string' }
          }
        }
      }
    }
  },
  responses: { 201: { description: 'VAR review initiated' } }
});

router.patch(
  '/var/:reviewId/status',
  authMiddleware,
  [
    body('status').isIn(['check_initiated', 'in_progress', 'decision_pending', 'completed']).withMessage('Valid status required')
  ],
  validate,
  asyncHandler(async (req, res) => {
    const result = await varService.updateReviewStatus(req.params.reviewId, req.body.status, req.user.userId);
    res.json({ success: true, data: result });
  })
);

addRoute('/scoring/matches/{matchId}/football/var/{reviewId}/status', 'patch', {
  summary: 'Update VAR review status',
  tags: ['Football VAR'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['status'],
          properties: {
            status: { type: 'string', enum: ['check_initiated', 'in_progress', 'decision_pending', 'completed'] }
          }
        }
      }
    }
  },
  responses: { 200: { description: 'VAR status updated' } }
});

router.post(
  '/var/:reviewId/decision',
  authMiddleware,
  [
    body('decision').isIn(['confirmed', 'overturned', 'changed_to_penalty', 'changed_to_free_kick', 'no_goal', 'no_penalty', 'no_red_card']).withMessage('Valid decision required'),
    body('reason').isString().withMessage('VAR reason required')
  ],
  validate,
  asyncHandler(async (req, res) => {
    const result = await varService.makeDecision(req.params.reviewId, req.body.decision, req.body.reason, req.user.userId);
    res.json({ success: true, data: result });
  })
);

addRoute('/scoring/matches/{matchId}/football/var/:reviewId/decision', 'post', {
  summary: 'Make VAR decision',
  tags: ['Football VAR'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['decision', 'reason'],
          properties: {
            decision: { type: 'string', enum: ['confirmed', 'overturned', 'changed_to_penalty', 'changed_to_free_kick', 'no_goal', 'no_penalty', 'no_red_card'] },
            reason: { type: 'string' }
          }
        }
      }
    }
  },
  responses: { 200: { description: 'VAR decision made' } }
});

router.get('/var', authMiddleware, asyncHandler(async (req, res) => {
  const reviews = await varService.getMatchReviews(req.params.matchId);
  res.json({ success: true, data: reviews });
}));

router.get('/var/stats', authMiddleware, asyncHandler(async (req, res) => {
  const stats = await varService.getReviewStats(req.params.matchId);
  res.json({ success: true, data: stats });
}));

addRoute('/scoring/matches/{matchId}/football/var/stats', 'get', {
  summary: 'Get VAR review statistics',
  tags: ['Football VAR'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'VAR statistics' } }
});

addRoute('/scoring/matches/{matchId}/football/var', 'get', {
  summary: 'Get VAR reviews',
  tags: ['Football VAR'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'List of VAR reviews' } }
});

router.post(
  '/penalties/initialize',
  authMiddleware,
  [
    body('home_kickers').isArray({ min: 5 }).withMessage('At least 5 home kickers required'),
    body('away_kickers').isArray({ min: 5 }).withMessage('At least 5 away kickers required')
  ],
  validate,
  asyncHandler(async (req, res) => {
    const match = await matchRepository.findById(req.params.matchId);
    const result = await penaltyShootoutService.initialize(
      req.params.matchId,
      match.home_team_id,
      match.away_team_id,
      req.body.home_kickers,
      req.body.away_kickers
    );
    res.status(201).json({ success: true, data: result });
  })
);

addRoute('/scoring/matches/{matchId}/football/penalties/initialize', 'post', {
  summary: 'Initialize penalty shootout',
  tags: ['Football Penalty Shootout'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['home_kickers', 'away_kickers'],
          properties: {
            home_kickers: { type: 'array', items: { type: 'string' } },
            away_kickers: { type: 'array', items: { type: 'string' } }
          }
        }
      }
    }
  },
  responses: { 201: { description: 'Penalty shootout initialized' } }
});

router.post('/penalties/start', authMiddleware, asyncHandler(async (req, res) => {
  const result = await penaltyShootoutService.start(req.params.matchId);
  res.json({ success: true, data: result });
}));

addRoute('/scoring/matches/{matchId}/football/penalties/start', 'post', {
  summary: 'Start penalty shootout',
  tags: ['Football Penalty Shootout'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Penalty shootout started' } }
});

router.post(
  '/penalties/kick',
  authMiddleware,
  [
    body('team_id').isUUID().withMessage('Team ID required'),
    body('kicker_player_id').isUUID().withMessage('Kicker player ID required'),
    body('goalkeeper_player_id').optional().isUUID(),
    body('result').isIn(['scored', 'missed', 'saved', 'post', 'blocked', 'neutral_miss']).withMessage('Valid result required')
  ],
  validate,
  asyncHandler(async (req, res) => {
    const result = await penaltyShootoutService.recordKick(
      req.params.matchId,
      req.body.team_id,
      req.body.kicker_player_id,
      req.body.goalkeeper_player_id,
      req.body.result
    );
    res.json({ success: true, data: result });
  })
);

addRoute('/scoring/matches/{matchId}/football/penalties/kick', 'post', {
  summary: 'Record penalty kick',
  tags: ['Football Penalty Shootout'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['team_id', 'kicker_player_id', 'result'],
          properties: {
            team_id: { type: 'string' },
            kicker_player_id: { type: 'string' },
            goalkeeper_player_id: { type: 'string' },
            result: { type: 'string', enum: ['scored', 'missed', 'saved', 'post', 'blocked', 'neutral_miss'] }
          }
        }
      }
    }
  },
  responses: { 200: { description: 'Kick recorded' } }
});

router.get('/penalties/status', authMiddleware, asyncHandler(async (req, res) => {
  const status = await penaltyShootoutService.getShootoutStatus(req.params.matchId);
  res.json({ success: true, data: status });
}));

router.get('/penalties/kicks', authMiddleware, asyncHandler(async (req, res) => {
  const kicks = await penaltyShootoutService.getKicks(req.params.matchId);
  res.json({ success: true, data: kicks });
}));

addRoute('/scoring/matches/{matchId}/football/penalties/kicks', 'get', {
  summary: 'Get all penalty kicks',
  tags: ['Football Penalty Shootout'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'List of penalty kicks' } }
});

router.get('/penalties/next-kicker', authMiddleware, asyncHandler(async (req, res) => {
  const kicker = await penaltyShootoutService.getNextKicker(req.params.matchId);
  res.json({ success: true, data: kicker });
}));

addRoute('/scoring/matches/{matchId}/football/penalties/next-kicker', 'get', {
  summary: 'Get next kicker',
  tags: ['Football Penalty Shootout'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Next kicker details' } }
});

router.post('/penalties/abandon', authMiddleware, [body('reason').isString()], validate, asyncHandler(async (req, res) => {
  await penaltyShootoutService.abandon(req.params.matchId, req.body.reason);
  res.json({ success: true, message: 'Penalty shootout abandoned' });
}));

addRoute('/scoring/matches/{matchId}/football/penalties/abandon', 'post', {
  summary: 'Abandon penalty shootout',
  tags: ['Football Penalty Shootout'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['reason'],
          properties: {
            reason: { type: 'string' }
          }
        }
      }
    }
  },
  responses: { 200: { description: 'Penalty shootout abandoned' } }
});

addRoute('/scoring/matches/{matchId}/football/penalties/status', 'get', {
  summary: 'Get penalty shootout status',
  tags: ['Football Penalty Shootout'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Shootout status' } }
});

router.post(
  '/events/:eventId/correct',
  authMiddleware,
  [
    body('player_id').optional().isUUID(),
    body('team_id').optional().isUUID(),
    body('minute').optional().isInt({ min: 0, max: 130 }),
    body('metadata').optional().isObject(),
    body('reason').isString().withMessage('Correction reason required'),
    body('justification').optional().isString()
  ],
  validate,
  asyncHandler(async (req, res) => {
    const result = await eventCorrectionService.correctEvent(req.params.eventId, req.body, req.user.userId);
    res.json({ success: true, data: result });
  })
);

router.post(
  '/events/:eventId/undo',
  authMiddleware,
  [
    body('reason').isString().withMessage('Undo reason required'),
    body('justification').optional().isString()
  ],
  validate,
  asyncHandler(async (req, res) => {
    const result = await eventCorrectionService.undoEvent(req.params.eventId, req.user.userId, req.body.reason, req.body.justification);
    res.json({ success: true, data: result });
  })
);

addRoute('/scoring/matches/{matchId}/football/events/{eventId}/undo', 'post', {
  summary: 'Undo scoring event',
  tags: ['Football Scoring'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['reason'],
          properties: {
            reason: { type: 'string' },
            justification: { type: 'string' }
          }
        }
      }
    }
  },
  responses: { 200: { description: 'Event undone' } }
});

router.get('/corrections', authMiddleware, asyncHandler(async (req, res) => {
  const corrections = await eventCorrectionService.getCorrections(req.params.matchId);
  res.json({ success: true, data: corrections });
}));

addRoute('/scoring/matches/{matchId}/football/corrections', 'get', {
  summary: 'Get event corrections',
  tags: ['Football Scoring'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'List of corrections' } }
});

addRoute('/scoring/matches/{matchId}/football/events/{eventId}/correct', 'post', {
  summary: 'Correct scoring event',
  tags: ['Football Scoring'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['reason'],
          properties: {
            player_id: { type: 'string' },
            team_id: { type: 'string' },
            minute: { type: 'integer' },
            metadata: { type: 'object' },
            reason: { type: 'string' },
            justification: { type: 'string' }
          }
        }
      }
    }
  },
  responses: { 200: { description: 'Event corrected' } }
});

router.post('/eligibility/initialize', authMiddleware, asyncHandler(async (req, res) => {
  const result = await playerEligibilityService.initializeMatchEligibility(req.params.matchId, req.user.userId);
  res.json({ success: true, data: result });
}));

addRoute('/scoring/matches/{matchId}/football/eligibility/initialize', 'post', {
  summary: 'Initialize match eligibility',
  tags: ['Football Scoring'],
  security: [{ bearerAuth: [] }],
  responses: { 201: { description: 'Eligibility initialized' } }
});

router.post(
  '/eligibility/lineup',
  authMiddleware,
  [
    body('team_id').isUUID(),
    body('lineup').isArray({ min: 7, max: 11 }),
    body('bench').optional().isArray({ max: 7 })
  ],
  validate,
  asyncHandler(async (req, res) => {
    const result = await playerEligibilityService.setLineup(
      req.params.matchId,
      req.body.team_id,
      req.body.lineup,
      req.body.bench || []
    );
    res.json({ success: true, data: result });
  })
);

addRoute('/scoring/matches/{matchId}/football/eligibility/lineup', 'post', {
  summary: 'Set team lineup for eligibility',
  tags: ['Football Scoring'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['team_id', 'lineup'],
          properties: {
            team_id: { type: 'string' },
            lineup: { type: 'array', items: { type: 'object' } },
            bench: { type: 'array', items: { type: 'object' } }
          }
        }
      }
    }
  },
  responses: { 201: { description: 'Lineup set for eligibility' } }
});

router.get('/eligibility', authMiddleware, asyncHandler(async (req, res) => {
  const eligibility = await playerEligibilityService.getMatchEligibility(req.params.matchId);
  res.json({ success: true, data: eligibility });
}));

router.get('/eligibility/team/:teamId', authMiddleware, asyncHandler(async (req, res) => {
  const eligibility = await playerEligibilityService.getTeamEligibility(req.params.matchId, req.params.teamId);
  res.json({ success: true, data: eligibility });
}));

addRoute('/scoring/matches/{matchId}/football/eligibility/team/{teamId}', 'get', {
  summary: 'Get team eligibility',
  tags: ['Football Scoring'],
  security: [{ bearerAuth: [] }],
  parameters: [{
    name: 'teamId',
    in: 'path',
    required: true,
    schema: { type: 'string', format: 'uuid' }
  }],
  responses: { 200: { description: 'Team eligibility details' } }
});

router.get('/eligibility/player/:playerId', authMiddleware, asyncHandler(async (req, res) => {
  const eligibility = await playerEligibilityService.getPlayerEligibility(req.params.matchId, req.params.playerId);
  res.json({ success: true, data: eligibility });
}));

addRoute('/scoring/matches/{matchId}/football/eligibility/player/{playerId}', 'get', {
  summary: 'Get player eligibility',
  tags: ['Football Scoring'],
  security: [{ bearerAuth: [] }],
  parameters: [{
    name: 'playerId',
    in: 'path',
    required: true,
    schema: { type: 'string', format: 'uuid' }
  }],
  responses: { 200: { description: 'Player eligibility details' } }
});

addRoute('/scoring/matches/{matchId}/football/eligibility', 'get', {
  summary: 'Get player eligibility',
  tags: ['Football Scoring'],
  security: [{ bearerAuth: [] }],
  responses: { 200: { description: 'Player eligibility list' } }
});

export default router;