import db from '../../../infrastructure/postgres/index.js';
import { ForbiddenError, NotFoundError } from '../../../core/errors/index.js';
import { generateUUID } from '../../../core/utils/index.js';

export class PublicMatchService {
  async checkQuota(userId) {
    const result = await db.query(
      `SELECT matches_allocated, matches_used FROM user_free_matches WHERE user_id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return { allocated: 0, used: 0, remaining: 0, hasQuota: false };
    }

    const { matches_allocated, matches_used } = result.rows[0];
    return {
      allocated: matches_allocated,
      used: matches_used,
      remaining: matches_allocated - matches_used,
      hasQuota: matches_used < matches_allocated,
    };
  }

  async createFreeMatch(userId, data) {
    const quota = await this.checkQuota(userId);
    if (!quota.hasQuota) {
      throw new ForbiddenError('Free match quota exceeded. Create your own organization to host unlimited tournaments.');
    }

    const userResult = await db.query(
      `SELECT first_name, last_name, email, user_type FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [userId]
    );

    if (userResult.rows.length === 0) {
      throw new NotFoundError('User not found');
    }

    const user = userResult.rows[0];

    let organizationId = null;

    if (quota.used === 0) {
      const slugBase = `${user.first_name || 'user'}-free-${generateUUID().substring(0, 8)}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const orgResult = await db.query(
        `INSERT INTO organizations (name, slug, settings, metadata) VALUES ($1, $2, $3, $4) RETURNING id`,
        [`${user.first_name || 'User'}'s Free Org`, slugBase, JSON.stringify({}), JSON.stringify({})]
      );
      organizationId = orgResult.rows[0].id;

      await db.query(
        `INSERT INTO organization_members (organization_id, user_id, role, is_active) VALUES ($1, $2, 'owner', TRUE)`,
        [organizationId, userId]
      );

      const ownerRole = await db.query(
        `SELECT id FROM roles WHERE name = 'owner' AND deleted_at IS NULL LIMIT 1`
      );

      if (ownerRole.rows.length > 0) {
        await db.query(
          `INSERT INTO user_roles (user_id, role_id, organization_id, created_by) VALUES ($1, $2, $3, $4)`,
          [userId, ownerRole.rows[0].id, organizationId, userId]
        );
      }

      await db.query(
        `UPDATE user_free_matches SET first_match_org_id = $1, updated_at = NOW() WHERE user_id = $2`,
        [organizationId, userId]
      );
    } else {
      const quotaResult = await db.query(
        `SELECT first_match_org_id FROM user_free_matches WHERE user_id = $1`,
        [userId]
      );
      organizationId = quotaResult.rows[0]?.first_match_org_id;

      if (!organizationId) {
        throw new ForbiddenError('No organization found. Please create your first match first.');
      }
    }

    let tournamentId = data.tournament_id;

    if (!tournamentId) {
      const sportResult = await db.query(
        `SELECT id FROM sports WHERE slug = $1 AND is_active = TRUE LIMIT 1`,
        [data.sport_slug || 'football']
      );

      if (sportResult.rows.length === 0) {
        throw new NotFoundError('Sport not found');
      }

      const sportId = sportResult.rows[0].id;
      const tournamentResult = await db.query(
        `INSERT INTO tournaments (organization_id, sport_id, name, slug, format, status, settings, metadata, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [
          organizationId,
          sportId,
          data.tournament_name || 'Free Tournament',
          `free-tournament-${generateUUID().substring(0, 8)}`,
          'league',
          'draft',
          JSON.stringify({}),
          JSON.stringify({}),
          userId,
        ]
      );
      tournamentId = tournamentResult.rows[0].id;
    }

    const matchResult = await db.query(
      `INSERT INTO matches (organization_id, tournament_id, home_team_id, away_team_id, status, settings, metadata, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        organizationId,
        tournamentId,
        data.home_team_id,
        data.away_team_id,
        'scheduled',
        JSON.stringify({}),
        JSON.stringify({}),
        userId,
      ]
    );

    await db.query(
      `UPDATE user_free_matches SET matches_used = matches_used + 1, updated_at = NOW() WHERE user_id = $1`,
      [userId]
    );

    const orgResult = await db.query(
      `SELECT id, name, slug FROM organizations WHERE id = $1`,
      [organizationId]
    );

    const tournamentResult = await db.query(
      `SELECT id, name FROM tournaments WHERE id = $1`,
      [tournamentId]
    );

    return {
      match: matchResult.rows[0],
      tournament: tournamentResult.rows[0],
      organization: orgResult.rows[0],
      quota: await this.checkQuota(userId),
    };
  }
}

export default new PublicMatchService();
