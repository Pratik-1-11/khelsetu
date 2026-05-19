import db from '../../infrastructure/postgres/index.js';
import { ForbiddenError } from '../errors/index.js';

const PLANS = [
  { id: 'free', name: 'Free', features: { tournaments: 5, teams: 10, players: 50, matches: 100 } },
  { id: 'starter', name: 'Starter', features: { tournaments: 5, teams: 50, players: 200, matches: 500 } },
  { id: 'professional', name: 'Professional', features: { tournaments: 20, teams: 200, players: 1000, matches: 2000 } },
  { id: 'enterprise', name: 'Enterprise', features: { tournaments: -1, teams: -1, players: -1, matches: -1 } }
];

export function enforceLimits(resourceType) {
  return async (req, res, next) => {
    const orgId = req.body.organization_id;
    if (!orgId) return next();

    const [sub] = await db.query(
      `SELECT plan_id FROM subscriptions WHERE organization_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1`,
      [orgId]
    );

    const planId = sub[0]?.plan_id || 'free';
    const plan = PLANS.find(p => p.id === planId);
    if (!plan) return next();

    const limit = plan.features[resourceType];
    if (limit === -1) return next();

    let count = 0;
    switch (resourceType) {
      case 'tournaments':
        [[{ count }]] = await db.query(
          `SELECT COUNT(*) as count FROM tournaments WHERE organization_id = ? AND deleted_at IS NULL`,
          [orgId]
        );
        break;
      case 'teams':
        [[{ count }]] = await db.query(
          `SELECT COUNT(*) as count FROM teams WHERE organization_id = ? AND deleted_at IS NULL`,
          [orgId]
        );
        break;
      case 'players':
        [[{ count }]] = await db.query(
          `SELECT COUNT(*) as count FROM players WHERE organization_id = ? AND deleted_at IS NULL`,
          [orgId]
        );
        break;
      case 'matches':
        [[{ count }]] = await db.query(
          `SELECT COUNT(*) as count FROM matches m JOIN tournaments t ON m.tournament_id = t.id WHERE t.organization_id = ? AND m.deleted_at IS NULL`,
          [orgId]
        );
        break;
      default:
        return next();
    }

    if (count >= limit) {
      throw new ForbiddenError(
        `Plan limit reached for ${resourceType} (${count}/${limit}). Upgrade your plan to create more.`
      );
    }
    next();
  };
}

