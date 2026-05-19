import db from '../../../infrastructure/postgres/index.js';
import matchRepository from '../../matches/repositories/matchRepository.js';
import { NotFoundError, ValidationError, ConflictError } from '../../../core/errors/index.js';
import { generateUUID } from '../../../core/utils/index.js';
import logger from '../../../core/logger/index.js';
import ws from '../../../core/websocket/index.js';

export class SubstitutionService {
  async validateSubstitution(matchId, teamId, playerInId, playerOutId, minute) {
    const match = await matchRepository.findById(matchId);
    if (!match) {
      throw new NotFoundError('Match not found');
    }

    if (match.status !== 'live') {
      throw new ValidationError('Can only make substitutions in live matches');
    }

    const [lineup] = await db.query(
      `SELECT * FROM match_lineups WHERE match_id = ? AND team_id = ?`,
      [matchId, teamId]
    );

    const isPlayerOnField = lineup.some(p => p.player_id === playerOutId && p.is_starting);
    const isPlayerOnBench = lineup.some(p => p.player_id === playerInId && p.is_on_bench);
    const isPlayerAlreadyOnField = lineup.some(p => p.player_id === playerInId && p.is_starting);
    const isPlayerOutAlreadySubbed = lineup.some(p => p.player_id === playerOutId && !p.is_starting && p.minutes_played > 0);

    if (!isPlayerOnField && !isPlayerOnBench) {
      throw new ValidationError('Player to come on is not in match squad');
    }

    if (isPlayerOnField && isPlayerAlreadyOnField) {
      throw new ValidationError('Player is already on the field');
    }

    if (isPlayerOnBench && !isPlayerOnField) {
      // This is valid - coming from bench
    } else if (isPlayerOnField) {
      // This is valid - going off
    }

    if (isPlayerOutAlreadySubbed) {
      throw new ValidationError('Player has already been substituted');
    }

    const [limits] = await db.query(
      `SELECT * FROM team_substitution_limits WHERE match_id = ? AND team_id = ?`,
      [matchId, teamId]
    );

    if (!limits.length) {
      await db.query(
        `INSERT INTO team_substitution_limits (id, match_id, team_id, max_substitutions) VALUES (?, ?, ?, 5)`,
        [generateUUID(), matchId, teamId]
      );
    }

    const [updatedLimits] = await db.query(
      `SELECT * FROM team_substitution_limits WHERE match_id = ? AND team_id = ?`,
      [matchId, teamId]
    );

    const [periods] = await db.query(
      `SELECT period_type FROM match_periods WHERE match_id = ? AND status = 'in_progress' ORDER BY period_number DESC LIMIT 1`,
      [matchId]
    );

    const isExtraTime = periods[0]?.period_type?.startsWith('extra_time');
    const maxSubs = isExtraTime 
      ? (updatedLimits[0].max_substitutions + updatedLimits[0].extra_time_substitutions)
      : updatedLimits[0].max_substitutions;

    if (updatedLimits[0].substitutions_used >= maxSubs) {
      throw new ValidationError(`Maximum ${maxSubs} substitutions reached for this team`);
    }

    const [redCards] = await db.query(
      `SELECT * FROM player_match_cards WHERE match_id = ? AND team_id = ? AND card_type IN ('red', 'second_yellow') AND is_active = TRUE`,
      [matchId, teamId]
    );

    const redCardedPlayerIds = redCards.map(c => c.player_id);
    if (redCardedPlayerIds.includes(playerOutId)) {
      throw new ValidationError('Cannot substitute a player who has been sent off');
    }

    return { valid: true, canProceed: true };
  }

  async performSubstitution(matchId, teamId, playerInId, playerOutId, minute, reason = 'tactical') {
    await this.validateSubstitution(matchId, teamId, playerInId, playerOutId, minute);

    const match = await matchRepository.findById(matchId);

    return await db.transaction(async (connection) => {
      const [currentOrder] = await connection.query(
        `SELECT COALESCE(MAX(substitution_order), 0) + 1 as next_order FROM substitution_events WHERE match_id = ? AND team_id = ?`,
        [matchId, teamId]
      );

      const subId = generateUUID();
      await connection.execute(
        `INSERT INTO substitution_events (id, match_id, team_id, player_in_id, player_out_id, minute, substitution_order, reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [subId, matchId, teamId, playerInId, playerOutId, minute, currentOrder[0].next_order, reason]
      );

      await connection.execute(
        `UPDATE match_lineups SET is_starting = FALSE, minutes_played = ? WHERE match_id = ? AND team_id = ? AND player_id = ?`,
        [minute, matchId, teamId, playerOutId]
      );

      await connection.execute(
        `UPDATE match_lineups SET is_starting = TRUE, is_on_bench = FALSE WHERE match_id = ? AND team_id = ? AND player_id = ?`,
        [matchId, teamId, playerInId]
      );

      await connection.execute(
        `UPDATE team_substitution_limits SET substitutions_used = substitutions_used + 1 WHERE match_id = ? AND team_id = ?`,
        [matchId, teamId]
      );

      const [lineup] = await connection.query(
        `SELECT ml.*, p.first_name, p.last_name FROM match_lineups ml JOIN players p ON ml.player_id = p.id WHERE ml.match_id = ? AND ml.team_id = ?`,
        [matchId, teamId]
      );

      const [scoringEvent] = await connection.query(
        `INSERT INTO scoring_events (id, match_id, organization_id, event_type, team_id, player_id, player_in_id, player_out_id, minute, created_at, sequence_number)
         VALUES (?, ?, ?, 'substitution', ?, ?, ?, ?, ?, NOW(), (SELECT COALESCE(MAX(sequence_number), 0) + 1 FROM scoring_events WHERE match_id = ?))`,
        [generateUUID(), matchId, match.organization_id, teamId, playerInId, playerOutId, playerInId, minute, matchId]
      );

      await connection.commit();

      ws.emitToMatch(matchId, 'match:substitution', {
        matchId,
        teamId,
        playerInId,
        playerOutId,
        minute,
        reason,
        lineup: lineup.map(p => ({
          playerId: p.player_id,
          name: `${p.first_name} ${p.last_name}`,
          isStarting: p.is_starting,
          position: p.position
        })),
        timestamp: new Date().toISOString()
      });

      logger.info('Substitution performed', { matchId, subId, playerInId, playerOutId, minute });

      return {
        success: true,
        substitutionId: subId,
        minute,
        playerInId,
        playerOutId
      };
    });
  }

  async getMatchSubstitutions(matchId) {
    const [substitutions] = await db.query(
      `SELECT s.*, pi.first_name as player_in_first, pi.last_name as player_in_last,
              po.first_name as player_out_first, po.last_name as player_out_last
       FROM substitution_events s
       LEFT JOIN players pi ON s.player_in_id = pi.id
       LEFT JOIN players po ON s.player_out_id = po.id
       WHERE s.match_id = ?
       ORDER BY s.minute ASC`,
      [matchId]
    );

    return substitutions;
  }

  async getTeamSubstitutionStatus(matchId, teamId) {
    const [limits] = await db.query(
      `SELECT * FROM team_substitution_limits WHERE match_id = ? AND team_id = ?`,
      [matchId, teamId]
    );

    const [periods] = await db.query(
      `SELECT period_type FROM match_periods WHERE match_id = ? AND status = 'in_progress' ORDER BY period_number DESC LIMIT 1`,
      [matchId]
    );

    const isExtraTime = periods[0]?.period_type?.startsWith('extra_time');

    const limitsWithMax = limits[0] || { max_substitutions: 5, substitutions_used: 0, extra_time_substitutions: 1, extra_time_substitutions_used: 0 };
    const maxSubs = isExtraTime 
      ? limitsWithMax.max_substitutions + limitsWithMax.extra_time_substitutions
      : limitsWithMax.max_substitutions;

    return {
      maxSubstitutions: maxSubs,
      used: limitsWithMax.substitutions_used,
      remaining: maxSubs - limitsWithMax.substitutions_used,
      isExtraTime,
      canSubstitute: limitsWithMax.substitutions_used < maxSubs
    };
  }
}

export default new SubstitutionService();