import db from '../../../infrastructure/postgres/index.js';
import matchRepository from '../../matches/repositories/matchRepository.js';
import matchPeriodService from './matchPeriodService.js';
import { NotFoundError, ValidationError, ConflictError } from '../../../core/errors/index.js';
import { generateUUID } from '../../../core/utils/index.js';
import logger from '../../../core/logger/index.js';
import ws from '../../../core/websocket/index.js';

const SHOOTOUT_STATUS = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  ABANDONED: 'abandoned'
};

const KICK_RESULT = {
  SCORED: 'scored',
  MISSED: 'missed',
  SAVED: 'saved',
  POST: 'post',
  BLOCKED: 'blocked',
  NEUTRAL_MISS: 'neutral_miss'
};

export class PenaltyShootoutService {
  async initialize(matchId, homeTeamId, awayTeamId, homeKickers = [], awayKickers = []) {
    const match = await matchRepository.findById(matchId);
    if (!match) {
      throw new NotFoundError('Match not found');
    }

    if (match.status !== 'penalties' && match.status !== 'live') {
      throw new ValidationError('Match must be in penalties state');
    }

    const existing = await this.getShootout(matchId);
    if (existing) {
      throw new ConflictError('Penalty shootout already initialized');
    }

    const shootoutId = generateUUID();

    await db.transaction(async (connection) => {
      await connection.execute(
        `INSERT INTO penalty_shootouts (id, match_id, organization_id, status, current_kick_team)
         VALUES (?, ?, ?, ?, ?)`,
        [shootoutId, matchId, match.organization_id, SHOOTOUT_STATUS.PENDING, homeTeamId]
      );

      for (let i = 0; i < homeKickers.length; i++) {
        await connection.execute(
          `INSERT INTO penalty_kick_orders (id, shootout_id, team_id, player_id, kick_order)
           VALUES (?, ?, ?, ?, ?)`,
          [generateUUID(), shootoutId, homeTeamId, homeKickers[i], i + 1]
        );
      }

      for (let i = 0; i < awayKickers.length; i++) {
        await connection.execute(
          `INSERT INTO penalty_kick_orders (id, shootout_id, team_id, player_id, kick_order)
           VALUES (?, ?, ?, ?, ?)`,
          [generateUUID(), shootoutId, awayTeamId, awayKickers[i], i + 1]
        );
      }

      await connection.commit();
    });

    ws.emitToMatch(matchId, 'penalties:initialized', {
      matchId,
      shootoutId,
      homeKickers,
      awayKickers,
      timestamp: new Date().toISOString()
    });

    logger.info('Penalty shootout initialized', { matchId, shootoutId, homeKickers: homeKickers.length, awayKickers: awayKickers.length });

    return { shootoutId, status: SHOOTOUT_STATUS.PENDING };
  }

  async start(matchId) {
    const shootout = await this.getShootout(matchId);
    if (!shootout) {
      throw new NotFoundError('Penalty shootout not initialized');
    }

    if (shootout.status !== SHOOTOUT_STATUS.PENDING) {
      throw new ValidationError('Shootout already started or completed');
    }

    await db.query(
      `UPDATE penalty_shootouts SET status = ? WHERE id = ?`,
      [SHOOTOUT_STATUS.IN_PROGRESS, shootout.id]
    );

    ws.emitToMatch(matchId, 'penalties:started', {
      matchId,
      shootoutId: shootout.id,
      timestamp: new Date().toISOString()
    });

    logger.info('Penalty shootout started', { matchId, shootoutId: shootout.id });

    return { status: SHOOTOUT_STATUS.IN_PROGRESS };
  }

  async recordKick(matchId, teamId, kickerPlayerId, goalkeeperPlayerId, result) {
    const shootout = await this.getShootout(matchId);
    if (!shootout) {
      throw new NotFoundError('Penalty shootout not found');
    }

    if (shootout.status !== SHOOTOUT_STATUS.IN_PROGRESS) {
      throw new ValidationError('Shootout not in progress');
    }

    const validResults = Object.values(KICK_RESULT);
    if (!validResults.includes(result)) {
      throw new ValidationError('Invalid kick result');
    }

    const isHomeTeam = teamId === (await matchRepository.findById(matchId)).home_team_id;
    const currentKicks = isHomeTeam ? shootout.home_kicks_taken : shootout.away_kicks_taken;
    const nextKickNumber = currentKicks + 1;
    const isSuddenDeath = shootout.is_sudden_death;

    const kickId = generateUUID();

    await db.transaction(async (connection) => {
      await connection.execute(
        `INSERT INTO penalty_kicks (id, shootout_id, match_id, team_id, kicker_player_id, goalkeeper_player_id, kick_number, round_number, result, is_sudden_death)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [kickId, shootout.id, matchId, teamId, kickerPlayerId, goalkeeperPlayerId, nextKickNumber, shootout.round_number, result, isSuddenDeath]
      );

      const scoreChange = result === KICK_RESULT.SCORED ? 1 : 0;
      const kicksTakenUpdate = isHomeTeam ? 'home_kicks_taken = home_kicks_taken + 1' : 'away_kicks_taken = away_kicks_taken + 1';
      const scoreUpdate = isHomeTeam ? 'home_score = home_score + ?' : 'away_score = away_score + ?';

      await connection.execute(
        `UPDATE penalty_shootouts SET ${kicksTakenUpdate}, ${scoreUpdate} WHERE id = ?`,
        [scoreChange, shootout.id]
      );

      const kickOrderUpdate = isHomeTeam ? 
        'UPDATE penalty_kick_orders SET is_kicked = TRUE WHERE shootout_id = ? AND team_id = ? AND kick_order = ?' :
        'UPDATE penalty_kick_orders SET is_kicked = TRUE WHERE shootout_id = ? AND team_id = ? AND kick_order = ?';
      
      await connection.execute(
        `UPDATE penalty_kick_orders SET is_kicked = TRUE WHERE shootout_id = ? AND team_id = ? AND kick_order = ?`,
        [shootout.id, teamId, nextKickNumber]
      );

      await connection.commit();
    });

    const updatedShootout = await this.getShootout(matchId);
    const isFinished = this.checkShootoutFinish(updatedShootout);

    if (isFinished.finished) {
      await this.completeShootout(matchId, isFinished.winnerId);
    } else if (this.shouldStartSuddenDeath(updatedShootout)) {
      await this.startSuddenDeath(matchId);
    } else {
      await this.prepareNextKick(matchId, updatedShootout);
    }

    ws.emitToMatch(matchId, 'penalties:kick_recorded', {
      matchId,
      kickId,
      kickNumber: nextKickNumber,
      result,
      teamId,
      kickerPlayerId,
      score: { home: updatedShootout.home_score, away: updatedShootout.away_score },
      suddenDeath: isSuddenDeath,
      timestamp: new Date().toISOString()
    });

    logger.info('Penalty kick recorded', { matchId, kickId, result, kickNumber: nextKickNumber });

    return { kickId, result, score: { home: updatedShootout.home_score, away: updatedShootout.away_score }, finished: isFinished.finished };
  }

  checkShootoutFinish(shootout) {
    const { home_score, away_score, home_kicks_taken, away_kicks_taken, round_number } = shootout;

    if (round_number < 5) {
      return { finished: false, winnerId: null };
    }

    if (round_number === 5) {
      if (home_score !== away_score) {
        return { finished: true, winnerId: home_score > away_score ? shootout.home_team_id : shootout.away_team_id };
      }
      return { finished: false, winnerId: null, goToSuddenDeath: true };
    }

    if (shootout.is_sudden_death && home_kicks_taken === away_kicks_taken) {
      if (home_score !== away_score) {
        return { finished: true, winnerId: home_score > away_score ? shootout.home_team_id : shootout.away_team_id };
      }
    }

    return { finished: false, winnerId: null };
  }

  shouldStartSuddenDeath(shootout) {
    if (shootout.round_number >= 5 && shootout.home_score === shootout.away_score && !shootout.is_sudden_death) {
      return true;
    }
    return false;
  }

  async startSuddenDeath(matchId) {
    const shootout = await this.getShootout(matchId);
    
    await db.query(
      `UPDATE penalty_shootouts SET is_sudden_death = TRUE, round_number = round_number + 1 WHERE id = ?`,
      [shootout.id]
    );

    ws.emitToMatch(matchId, 'penalties:sudden_death', {
      matchId,
      round: shootout.round_number + 1,
      timestamp: new Date().toISOString()
    });

    logger.info('Sudden death started', { matchId, shootoutId: shootout.id, round: shootout.round_number + 1 });
  }

  async prepareNextKick(matchId, shootout) {
    const { home_kicks_taken, away_kicks_taken, round_number } = shootout;

    let nextTeam, nextKickNumber;

    if (home_kicks_taken === away_kicks_taken) {
      nextTeam = shootout.current_kick_team;
      nextKickNumber = home_kicks_taken + 1;
    } else {
      nextTeam = home_kicks_taken > away_kicks_taken ? shootout.away_team_id : shootout.home_team_id;
      nextKickNumber = Math.max(home_kicks_taken, away_kicks_taken);
    }

    await db.query(
      `UPDATE penalty_shootouts SET current_kick_team = ?, current_kick_order = ? WHERE id = ?`,
      [nextTeam, nextKickNumber, shootout.id]
    );
  }

  async completeShootout(matchId, winnerId) {
    const shootout = await this.getShootout(matchId);
    if (!shootout) return;

    await db.transaction(async (connection) => {
      await connection.execute(
        `UPDATE penalty_shootouts SET status = ?, winner_id = ?, completed_at = NOW() WHERE id = ?`,
        [SHOOTOUT_STATUS.COMPLETED, winnerId, shootout.id]
      );

      await connection.execute(
        `UPDATE matches SET status = 'completed', winner_id = ?, home_penalty_score = ?, away_penalty_score = ?, ended_at = NOW() WHERE id = ?`,
        [winnerId, shootout.home_score, shootout.away_score, matchId]
      );

      await connection.commit();
    });

    ws.emitToMatch(matchId, 'penalties:completed', {
      matchId,
      winnerId,
      homeScore: shootout.home_score,
      awayScore: shootout.away_score,
      timestamp: new Date().toISOString()
    });

    logger.info('Penalty shootout completed', { matchId, winnerId, homeScore: shootout.home_score, awayScore: shootout.away_score });
  }

  async abandon(matchId, reason) {
    const shootout = await this.getShootout(matchId);
    if (!shootout) {
      throw new NotFoundError('Penalty shootout not found');
    }

    await db.query(
      `UPDATE penalty_shootouts SET status = ? WHERE id = ?`,
      [SHOOTOUT_STATUS.ABANDONED, shootout.id]
    );

    await matchPeriodService.endMatch(matchId, null);

    ws.emitToMatch(matchId, 'penalties:abandoned', {
      matchId,
      reason,
      timestamp: new Date().toISOString()
    });

    logger.warn('Penalty shootout abandoned', { matchId, reason });
  }

  async getShootout(matchId) {
    const [shootouts] = await db.query(
      `SELECT ps.*, m.home_team_id, m.away_team_id FROM penalty_shootouts ps JOIN matches m ON ps.match_id = m.id WHERE ps.match_id = ?`,
      [matchId]
    );
    return shootouts[0] || null;
  }

  async getKicks(matchId) {
    const [kicks] = await db.query(
      `SELECT pk.*, p.first_name as kicker_first_name, p.last_name as kicker_last_name,
              pg.first_name as goalkeeper_first_name, pg.last_name as goalkeeper_last_name
       FROM penalty_kicks pk
       LEFT JOIN players p ON pk.kicker_player_id = p.id
       LEFT JOIN players pg ON pk.goalkeeper_player_id = pg.id
       WHERE pk.match_id = ?
       ORDER BY pk.kick_timestamp ASC`,
      [matchId]
    );
    return kicks;
  }

  async getKickOrder(matchId, teamId) {
    const [order] = await db.query(
      `SELECT pko.*, p.first_name, p.last_name
       FROM penalty_kick_orders pko
       JOIN players p ON pko.player_id = p.id
       JOIN penalty_shootouts ps ON pko.shootout_id = ps.id
       WHERE ps.match_id = ? AND pko.team_id = ?
       ORDER BY pko.kick_order ASC`,
      [matchId, teamId]
    );
    return order;
  }

  async getNextKicker(matchId) {
    const shootout = await this.getShootout(matchId);
    if (!shootout || shootout.status !== SHOOTOUT_STATUS.IN_PROGRESS) {
      return null;
    }

    const kickOrder = await this.getKickOrder(matchId, shootout.current_kick_team);
    const nextKicker = kickOrder.find(k => !k.is_kicked);

    return nextKicker || null;
  }

  async getShootoutStatus(matchId) {
    const shootout = await this.getShootout(matchId);
    if (!shootout) {
      return null;
    }

    const kicks = await this.getKicks(matchId);

    return {
      status: shootout.status,
      round: shootout.round_number,
      isSuddenDeath: shootout.is_sudden_death,
      score: {
        home: shootout.home_score,
        away: shootout.away_score
      },
      kicksTaken: {
        home: shootout.home_kicks_taken,
        away: shootout.away_kicks_taken
      },
      currentKickTeam: shootout.current_kick_team,
      winnerId: shootout.winner_id,
      kicks: kicks
    };
  }
}

export default new PenaltyShootoutService();