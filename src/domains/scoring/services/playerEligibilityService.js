import db from '../../../infrastructure/postgres/index.js';
import matchRepository from '../../matches/repositories/matchRepository.js';
import teamRepository from '../../teams/repositories/teamRepository.js';
import { NotFoundError, ValidationError } from '../../../core/errors/index.js';
import { generateUUID } from '../../../core/utils/index.js';
import logger from '../../../core/logger/index.js';

export class PlayerEligibilityService {
  async initializeMatchEligibility(matchId, userId) {
    const match = await matchRepository.findById(matchId);
    if (!match) {
      throw new NotFoundError('Match not found');
    }

    const existing = await db.query(
      `SELECT COUNT(*) as count FROM player_eligibility WHERE match_id = ?`,
      [matchId]
    );

    if (existing[0].count > 0) {
      logger.warn('Player eligibility already initialized', { matchId });
      return await this.getMatchEligibility(matchId);
    }

    const homePlayers = await this.getTeamSquad(match.home_team_id);
    const awayPlayers = await this.getTeamSquad(match.away_team_id);

    await db.transaction(async (connection) => {
      for (const player of homePlayers) {
        await connection.execute(
          `INSERT INTO player_eligibility (id, match_id, player_id, team_id, is_in_squad, checked_by)
           VALUES (?, ?, ?, ?, TRUE, ?)`,
          [generateUUID(), matchId, player.id, match.home_team_id, userId]
        );
      }

      for (const player of awayPlayers) {
        await connection.execute(
          `INSERT INTO player_eligibility (id, match_id, player_id, team_id, is_in_squad, checked_by)
           VALUES (?, ?, ?, ?, TRUE, ?)`,
          [generateUUID(), matchId, player.id, match.away_team_id, userId]
        );
      }

      await connection.commit();
    });

    logger.info('Player eligibility initialized', { matchId, homeCount: homePlayers.length, awayCount: awayPlayers.length });

    return await this.getMatchEligibility(matchId);
  }

  async getTeamSquad(teamId) {
    const [players] = await db.query(
      `SELECT p.* FROM players p
       JOIN player_teams pt ON p.id = pt.player_id
       WHERE pt.team_id = ? AND pt.is_active = TRUE AND pt.deleted_at IS NULL`,
      [teamId]
    );
    return players;
  }

  async setLineup(matchId, teamId, lineup, bench = []) {
    const match = await matchRepository.findById(matchId);
    if (!match) {
      throw new NotFoundError('Match not found');
    }

    if (lineup.length < 7 || lineup.length > 11) {
      throw new ValidationError('Lineup must have 7-11 players');
    }

    if (bench.length > 7) {
      throw new ValidationError('Bench cannot have more than 7 players');
    }

    await db.transaction(async (connection) => {
      await connection.execute(
        `UPDATE player_eligibility SET is_starting = FALSE, is_on_bench = FALSE WHERE match_id = ? AND team_id = ?`,
        [matchId, teamId]
      );

      for (const player of lineup) {
        await connection.execute(
          `UPDATE player_eligibility SET is_starting = TRUE, is_in_squad = TRUE WHERE match_id = ? AND team_id = ? AND player_id = ?`,
          [matchId, teamId, player.player_id]
        );
      }

      for (const player of bench) {
        await connection.execute(
          `UPDATE player_eligibility SET is_on_bench = TRUE, is_in_squad = TRUE WHERE match_id = ? AND team_id = ? AND player_id = ?`,
          [matchId, teamId, player.player_id]
        );
      }

      await connection.commit();
    });

    logger.info('Lineup set', { matchId, teamId, starters: lineup.length, bench: bench.length });

    return { starters: lineup.length, bench: bench.length };
  }

  async validatePlayerForEvent(matchId, playerId, teamId, eventType) {
    const eligibility = await this.getPlayerEligibility(matchId, playerId);

    if (!eligibility) {
      return { valid: false, reason: 'Player not registered for this match' };
    }

    if (eligibility.eligibility_status !== 'eligible') {
      return { valid: false, reason: `Player is ${eligibility.eligibility_status}` };
    }

    if (!eligibility.is_starting && !eligibility.is_on_bench) {
      return { valid: false, reason: 'Player is not in match squad' };
    }

    if (eventType === 'substitution') {
      return { valid: true };
    }

    if (!eligibility.is_starting) {
      return { valid: false, reason: 'Player is not on the field (substitute)' };
    }

    const suspendedPlayers = await this.getSuspendedPlayers(matchId, teamId);
    if (suspendedPlayers.includes(playerId)) {
      return { valid: false, reason: 'Player is suspended' };
    }

    const redCards = await this.getPlayerRedCards(matchId, playerId);
    if (redCards.length > 0) {
      return { valid: false, reason: 'Player has received a red card' };
    }

    return { valid: true };
  }

  async getPlayerEligibility(matchId, playerId) {
    const [eligibility] = await db.query(
      `SELECT * FROM player_eligibility WHERE match_id = ? AND player_id = ?`,
      [matchId, playerId]
    );
    return eligibility[0] || null;
  }

  async getMatchEligibility(matchId) {
    const [eligibility] = await db.query(
      `SELECT pe.*, p.first_name, p.last_name, p.jersey_number, t.name as team_name
       FROM player_eligibility pe
       JOIN players p ON pe.player_id = p.id
       JOIN teams t ON pe.team_id = t.id
       WHERE pe.match_id = ?
       ORDER BY pe.team_id, pe.is_starting DESC, pe.is_on_bench DESC`,
      [matchId]
    );

    return eligibility;
  }

  async getTeamEligibility(matchId, teamId) {
    const [eligibility] = await db.query(
      `SELECT pe.*, p.first_name, p.last_name, p.jersey_number
       FROM player_eligibility pe
       JOIN players p ON pe.player_id = p.id
       WHERE pe.match_id = ? AND pe.team_id = ?
       ORDER BY pe.is_starting DESC, pe.is_on_bench DESC`,
      [matchId, teamId]
    );

    return eligibility;
  }

  async getSuspendedPlayers(matchId, teamId) {
    const [suspended] = await db.query(
      `SELECT player_id FROM player_eligibility 
       WHERE match_id = ? AND team_id = ? AND eligibility_status = 'suspended'`,
      [matchId, teamId]
    );
    return suspended.map(s => s.player_id);
  }

  async getPlayerRedCards(matchId, playerId) {
    const [cards] = await db.query(
      `SELECT * FROM player_match_cards 
       WHERE match_id = ? AND player_id = ? AND card_type IN ('red', 'second_yellow') AND is_active = TRUE`,
      [matchId, playerId]
    );
    return cards;
  }

  async suspendPlayer(matchId, playerId, reason, until = null) {
    const eligibility = await this.getPlayerEligibility(matchId, playerId);
    if (!eligibility) {
      throw new NotFoundError('Player eligibility not found');
    }

    await db.query(
      `UPDATE player_eligibility SET eligibility_status = 'suspended', suspension_reason = ?, suspension_until = ? WHERE id = ?`,
      [reason, until, eligibility.id]
    );

    logger.info('Player suspended', { matchId, playerId, reason, until });

    return { playerId, status: 'suspended', reason, until };
  }

  async unsuspendPlayer(matchId, playerId) {
    const eligibility = await this.getPlayerEligibility(matchId, playerId);
    if (!eligibility) {
      throw new NotFoundError('Player eligibility not found');
    }

    await db.query(
      `UPDATE player_eligibility SET eligibility_status = 'eligible', suspension_reason = NULL, suspension_until = NULL WHERE id = ?`,
      [eligibility.id]
    );

    logger.info('Player unsuspended', { matchId, playerId });

    return { playerId, status: 'eligible' };
  }

  async updatePlayerStatus(matchId, playerId, status, reason = null) {
    const eligibility = await this.getPlayerEligibility(matchId, playerId);
    if (!eligibility) {
      throw new NotFoundError('Player eligibility not found');
    }

    const validStatuses = ['eligible', 'ineligible', 'suspended', 'pending'];
    if (!validStatuses.includes(status)) {
      throw new ValidationError('Invalid status');
    }

    await db.query(
      `UPDATE player_eligibility SET eligibility_status = ? WHERE id = ?`,
      [status, eligibility.id]
    );

    logger.info('Player status updated', { matchId, playerId, status, reason });

    return { playerId, status };
  }

  async markPlayerOnField(matchId, playerId, isOnField) {
    const eligibility = await this.getPlayerEligibility(matchId, playerId);
    if (!eligibility) {
      throw new NotFoundError('Player eligibility not found');
    }

    if (!eligibility.is_starting && !eligibility.is_on_bench) {
      throw new ValidationError('Player not in match squad');
    }

    await db.query(
      `UPDATE player_eligibility SET is_starting = ? WHERE id = ?`,
      [isOnField, eligibility.id]
    );

    return { playerId, isOnField };
  }

  async getStartingLineup(matchId, teamId) {
    const [players] = await db.query(
      `SELECT p.*, pe.jersey_number FROM player_eligibility pe
       JOIN players p ON pe.player_id = p.id
       WHERE pe.match_id = ? AND pe.team_id = ? AND pe.is_starting = TRUE
       ORDER BY pe.jersey_number`,
      [matchId, teamId]
    );
    return players;
  }

  async getBenchPlayers(matchId, teamId) {
    const [players] = await db.query(
      `SELECT p.*, pe.jersey_number FROM player_eligibility pe
       JOIN players p ON pe.player_id = p.id
       WHERE pe.match_id = ? AND pe.team_id = ? AND pe.is_on_bench = TRUE
       ORDER BY pe.jersey_number`,
      [matchId, teamId]
    );
    return players;
  }
}

export default new PlayerEligibilityService();