import db from '../../../infrastructure/postgres/index.js';
import matchRepository from '../../matches/repositories/matchRepository.js';
import { NotFoundError, ValidationError, ConflictError } from '../../../core/errors/index.js';
import { generateUUID } from '../../../core/utils/index.js';
import logger from '../../../core/logger/index.js';
import ws from '../../../core/websocket/index.js';

const PERIOD_TYPES = {
  FIRST_HALF: 'first_half',
  HALFTIME: 'halftime',
  SECOND_HALF: 'second_half',
  EXTRA_TIME_FIRST: 'extra_time_first',
  EXTRA_TIME_SECOND: 'extra_time_second',
  PENALTIES: 'penalties',
  FINISHED: 'finished'
};

const PERIOD_DURATION = {
  first_half: 45,
  halftime: 15,
  second_half: 45,
  extra_time_first: 15,
  extra_time_second: 15,
  penalties: null
};

export class MatchPeriodService {
  async initializeMatchPeriods(matchId) {
    const match = await matchRepository.findById(matchId);
    if (!match) {
      throw new NotFoundError('Match not found');
    }

    const existing = await db.query(
      `SELECT COUNT(*) as count FROM match_periods WHERE match_id = ?`,
      [matchId]
    );

    if (existing[0].count > 0) {
      logger.warn('Match periods already initialized', { matchId });
      return await this.getCurrentPeriod(matchId);
    }

    const id = generateUUID();
    await db.query(
      `INSERT INTO match_periods (id, match_id, organization_id, period_number, period_type, status, created_at)
       VALUES (?, ?, ?, 1, 'first_half', 'pending', NOW())`,
      [id, matchId, match.organization_id]
    );

    logger.info('Match periods initialized', { matchId });

    return await this.getCurrentPeriod(matchId);
  }

  async startFirstHalf(matchId, userId) {
    const match = await matchRepository.findById(matchId);
    if (!match) {
      throw new NotFoundError('Match not found');
    }

    if (match.status !== 'scheduled') {
      throw new ValidationError('Match must be scheduled to start first half');
    }

    await db.transaction(async (connection) => {
      const [periods] = await connection.query(
        `SELECT * FROM match_periods WHERE match_id = ? AND status = 'pending' ORDER BY period_number LIMIT 1`,
        [matchId]
      );

      if (!periods.length || periods[0].period_type !== 'first_half') {
        throw new ValidationError('First half cannot be started');
      }

      await connection.execute(
        `UPDATE match_periods SET status = 'in_progress', start_time = NOW() WHERE id = ?`,
        [periods[0].id]
      );

      await connection.execute(
        `UPDATE matches SET status = 'live', started_at = NOW(), current_period_id = ? WHERE id = ?`,
        [periods[0].id, matchId]
      );

      await connection.commit();
    });

    ws.emitToMatch(matchId, 'match:period_start', {
      matchId,
      period: 'first_half',
      timestamp: new Date().toISOString()
    });

    logger.info('First half started', { matchId });

    return await this.getCurrentPeriod(matchId);
  }

  async endHalf(matchId, injuryTimeMinutes = 0) {
    const currentPeriod = await this.getCurrentPeriod(matchId);
    if (!currentPeriod) {
      throw new NotFoundError('No active period found');
    }

    if (currentPeriod.period_type === 'first_half') {
      return await this.startHalftime(matchId, injuryTimeMinutes);
    } else if (currentPeriod.period_type === 'second_half') {
      return await this.endSecondHalf(matchId, injuryTimeMinutes);
    }

    throw new ValidationError(`Cannot end ${currentPeriod.period_type}`);
  }

  async startHalftime(matchId, injuryTimeMinutes = 0) {
    const currentPeriod = await this.getCurrentPeriod(matchId);
    if (currentPeriod?.period_type !== 'first_half') {
      throw new ValidationError('First half must be in progress');
    }

    await db.transaction(async (connection) => {
      await connection.execute(
        `UPDATE match_periods SET status = 'completed', end_time = NOW(), injury_time_minutes = ? WHERE id = ?`,
        [injuryTimeMinutes, currentPeriod.id]
      );

      const halftimeId = generateUUID();
      const [match] = await connection.query('SELECT organization_id FROM matches WHERE id = ?', [matchId]);

      await connection.execute(
        `INSERT INTO match_periods (id, match_id, organization_id, period_number, period_type, status, start_time, end_time)
         VALUES (?, ?, ?, 2, 'halftime', 'completed', NOW(), NOW())`,
        [halftimeId, matchId, match[0].organization_id]
      );

      await connection.execute(
        `UPDATE matches SET status = 'halftime' WHERE id = ?`,
        [matchId]
      );

      await connection.commit();
    });

    ws.emitToMatch(matchId, 'match:halftime', {
      matchId,
      injuryTime: injuryTimeMinutes,
      timestamp: new Date().toISOString()
    });

    logger.info('Halftime started', { matchId, injuryTime: injuryTimeMinutes });

    return await this.getCurrentPeriod(matchId);
  }

  async startSecondHalf(matchId) {
    const match = await matchRepository.findById(matchId);
    if (match.status !== 'halftime') {
      throw new ValidationError('Match must be at halftime to start second half');
    }

    await db.transaction(async (connection) => {
      const [periods] = await connection.query(
        `SELECT * FROM match_periods WHERE match_id = ? AND period_type = 'second_half' AND status = 'pending'`,
        [matchId]
      );

      if (!periods.length) {
        const [match] = await connection.query('SELECT organization_id FROM matches WHERE id = ?', [matchId]);
        const secondHalfId = generateUUID();

        await connection.execute(
          `INSERT INTO match_periods (id, match_id, organization_id, period_number, period_type, status, created_at)
           VALUES (?, ?, ?, 3, 'second_half', 'in_progress', NOW())`,
          [secondHalfId, matchId, match[0].organization_id]
        );
      } else {
        await connection.execute(
          `UPDATE match_periods SET status = 'in_progress', start_time = NOW() WHERE id = ?`,
          [periods[0].id]
        );
      }

      await connection.execute(
        `UPDATE matches SET status = 'live' WHERE id = ?`,
        [matchId]
      );

      await connection.commit();
    });

    ws.emitToMatch(matchId, 'match:period_start', {
      matchId,
      period: 'second_half',
      timestamp: new Date().toISOString()
    });

    logger.info('Second half started', { matchId });

    return await this.getCurrentPeriod(matchId);
  }

  async endSecondHalf(matchId, injuryTimeMinutes = 0) {
    const match = await matchRepository.findById(matchId);

    if (!['live', 'halftime'].includes(match.status)) {
      throw new ValidationError('Second half cannot be ended');
    }

    const [currentPeriod] = await db.query(
      `SELECT * FROM match_periods WHERE match_id = ? AND status = 'in_progress' ORDER BY period_number DESC LIMIT 1`,
      [matchId]
    );

    if (!currentPeriod.length || currentPeriod[0].period_type !== 'second_half') {
      throw new ValidationError('Second half is not in progress');
    }

    await db.transaction(async (connection) => {
      await connection.execute(
        `UPDATE match_periods SET status = 'completed', end_time = NOW(), injury_time_minutes = ? WHERE id = ?`,
        [injuryTimeMinutes, currentPeriod[0].id]
      );

      const isKnockout = match.metadata?.is_knockout || false;
      const isDraw = match.home_score === match.away_score;

      if (isKnockout && isDraw) {
        const [matchData] = await connection.query('SELECT organization_id FROM matches WHERE id = ?', [matchId]);
        const etId = generateUUID();

        await connection.execute(
          `INSERT INTO match_periods (id, match_id, organization_id, period_number, period_type, status, created_at)
           VALUES (?, ?, ?, 4, 'extra_time_first', 'pending', NOW())`,
          [etId, matchId, matchData[0].organization_id]
        );

        await connection.execute(
          `UPDATE matches SET status = 'extra_time' WHERE id = ?`,
          [matchId]
        );
      } else {
        await connection.execute(
          `UPDATE matches SET status = 'completed', ended_at = NOW() WHERE id = ?`,
          [matchId]
        );
      }

      await connection.commit();
    });

    ws.emitToMatch(matchId, 'match:full_time', {
      matchId,
      injuryTime: injuryTimeMinutes,
      goToExtraTime: match.home_score === match.away_score,
      timestamp: new Date().toISOString()
    });

    logger.info('Second half ended', { matchId, injuryTime: injuryTimeMinutes });

    return await this.getCurrentPeriod(matchId);
  }

  async startExtraTime(matchId) {
    const match = await matchRepository.findById(matchId);
    if (match.status !== 'extra_time') {
      throw new ValidationError('Match must be in extra time state');
    }

    await db.transaction(async (connection) => {
      const [periods] = await connection.query(
        `SELECT * FROM match_periods WHERE match_id = ? AND period_type = 'extra_time_first' AND status = 'pending'`,
        [matchId]
      );

      if (periods.length) {
        await connection.execute(
          `UPDATE match_periods SET status = 'in_progress', start_time = NOW() WHERE id = ?`,
          [periods[0].id]
        );
      }

      await connection.execute(
        `UPDATE matches SET status = 'live' WHERE id = ?`,
        [matchId]
      );

      await connection.commit();
    });

    ws.emitToMatch(matchId, 'match:period_start', {
      matchId,
      period: 'extra_time_first',
      timestamp: new Date().toISOString()
    });

    logger.info('Extra time started', { matchId });

    return await this.getCurrentPeriod(matchId);
  }

  async endExtraTime(matchId, injuryTimeMinutes = 0) {
    const currentPeriod = await this.getCurrentPeriod(matchId);
    
    if (currentPeriod?.period_type === 'extra_time_first') {
      await db.transaction(async (connection) => {
        await connection.execute(
          `UPDATE match_periods SET status = 'completed', end_time = NOW(), injury_time_minutes = ? WHERE id = ?`,
          [injuryTimeMinutes, currentPeriod.id]
        );

        const [match] = await connection.query('SELECT organization_id FROM matches WHERE id = ?', [matchId]);
        const et2Id = generateUUID();

        await connection.execute(
          `INSERT INTO match_periods (id, match_id, organization_id, period_number, period_type, status, created_at)
           VALUES (?, ?, ?, 5, 'extra_time_second', 'pending', NOW())`,
          [et2Id, matchId, match[0].organization_id]
        );

        await connection.commit();
      });

      return await this.getCurrentPeriod(matchId);
    }

    if (currentPeriod?.period_type === 'extra_time_second') {
      const match = await matchRepository.findById(matchId);
      
      await db.transaction(async (connection) => {
        await connection.execute(
          `UPDATE match_periods SET status = 'completed', end_time = NOW(), injury_time_minutes = ? WHERE id = ?`,
          [injuryTimeMinutes, currentPeriod.id]
        );

        const isDraw = match.home_score === match.away_score;

        if (isDraw) {
          const [matchData] = await connection.query('SELECT organization_id FROM matches WHERE id = ?', [matchId]);
          const penId = generateUUID();

          await connection.execute(
            `INSERT INTO match_periods (id, match_id, organization_id, period_number, period_type, status, created_at)
             VALUES (?, ?, ?, 6, 'penalties', 'pending', NOW())`,
            [penId, matchId, matchData[0].organization_id]
          );

          await connection.execute(
            `UPDATE matches SET status = 'penalties' WHERE id = ?`,
            [matchId]
          );
        } else {
          const winnerId = match.home_score > match.away_score ? match.home_team_id : match.away_team_id;
          await connection.execute(
            `UPDATE matches SET status = 'completed', ended_at = NOW(), winner_id = ? WHERE id = ?`,
            [winnerId, matchId]
          );
        }

        await connection.commit();
      });

      ws.emitToMatch(matchId, 'match:extra_time_full', {
        matchId,
        goToPenalties: match.home_score === match.away_score,
        timestamp: new Date().toISOString()
      });

      return await this.getCurrentPeriod(matchId);
    }

    throw new ValidationError('No extra time period in progress');
  }

  async startPenalties(matchId) {
    const match = await matchRepository.findById(matchId);
    if (match.status !== 'penalties') {
      throw new ValidationError('Match must be in penalties state');
    }

    await db.transaction(async (connection) => {
      const [periods] = await connection.query(
        `SELECT * FROM match_periods WHERE match_id = ? AND period_type = 'penalties' AND status = 'pending'`,
        [matchId]
      );

      if (periods.length) {
        await connection.execute(
          `UPDATE match_periods SET status = 'in_progress', start_time = NOW() WHERE id = ?`,
          [periods[0].id]
        );
      }

      await connection.execute(
        `UPDATE matches SET status = 'live' WHERE id = ?`,
        [matchId]
      );

      await connection.commit();
    });

    ws.emitToMatch(matchId, 'match:period_start', {
      matchId,
      period: 'penalties',
      timestamp: new Date().toISOString()
    });

    return await this.getCurrentPeriod(matchId);
  }

  async endMatch(matchId, winnerId = null) {
    const match = await matchRepository.findById(matchId);

    if (!['live', 'halftime', 'extra_time', 'penalties'].includes(match.status)) {
      throw new ValidationError('Match cannot be ended from current state');
    }

    await db.transaction(async (connection) => {
      const [activePeriods] = await connection.query(
        `UPDATE match_periods SET status = 'completed', end_time = NOW() WHERE match_id = ? AND status = 'in_progress'`,
        [matchId]
      );

      await connection.execute(
        `UPDATE matches SET status = 'completed', ended_at = NOW(), winner_id = ? WHERE id = ?`,
        [winnerId, matchId]
      );

      await connection.commit();
    });

    ws.emitToMatch(matchId, 'match:completed', {
      matchId,
      winnerId,
      finalScore: { home: match.home_score, away: match.away_score },
      timestamp: new Date().toISOString()
    });

    logger.info('Match completed', { matchId, winnerId });

    return await matchRepository.findById(matchId);
  }

  async getCurrentPeriod(matchId) {
    const periods = await db.query(
      `SELECT * FROM match_periods WHERE match_id = ? AND status = 'in_progress' ORDER BY period_number DESC LIMIT 1`,
      [matchId]
    );

    return periods[0] || null;
  }

  async getMatchPeriods(matchId) {
    const periods = await db.query(
      `SELECT * FROM match_periods WHERE match_id = ? ORDER BY period_number ASC`,
      [matchId]
    );

    return periods;
  }

  async updateInjuryTime(matchId, minutes) {
    const currentPeriod = await this.getCurrentPeriod(matchId);
    if (!currentPeriod) {
      throw new NotFoundError('No active period');
    }

    await db.query(
      `UPDATE match_periods SET injury_time_minutes = ? WHERE id = ?`,
      [minutes, currentPeriod.id]
    );

    ws.emitToMatch(matchId, 'match:injury_time', {
      matchId,
      period: currentPeriod.period_type,
      injuryTime: minutes,
      timestamp: new Date().toISOString()
    });

    return { injuryTime: minutes };
  }
}

export default new MatchPeriodService();