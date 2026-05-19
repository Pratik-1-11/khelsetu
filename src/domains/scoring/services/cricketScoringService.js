/**
 * Cricket Scoring Service - Production Grade
 * Event-driven architecture with deterministic replay
 */

import cricketEngine from '../engines/cricketScoringEngine.js';
import matchRepository from '../../matches/repositories/matchRepository.js';
import { NotFoundError, ForbiddenError, ValidationError, ConflictError } from '../../../core/errors/index.js';
import logger from '../../../core/logger/index.js';
import ws from '../../../core/websocket/index.js';
import db from '../../../infrastructure/postgres/index.js';
import { generateUUID } from '../../../core/utils/index.js';

const INNINGS_STATUS = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  ABANDONED: 'abandoned',
  FORFEITED: 'forfeited',
  SUPER_OVER: 'super_over'
};

const REVIEW_STATUS = {
  PENDING: 'pending',
  SUCCESS: 'success',
  LOST: 'lost',
  WITHDRAWN: 'withdrawn'
};

const SUPER_OVER_STATUS = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  ABANDONED: 'abandoned'
};

export class CricketScoringService {
  /**
   * Start first innings
   */
  async startInnings(matchId, userId, inningsNumber = 1, battingTeamId, bowlingTeamId) {
    const match = await matchRepository.findById(matchId);
    if (!match) throw new NotFoundError('Match not found');

    if (match.status !== 'live') {
      throw new ValidationError('Match must be live to start innings');
    }

    const connection = await db.getConnection();
    try {
      const inningsId = generateUUID();

      await connection.query(
        `INSERT INTO cricket_innings (id, match_id, innings_number, batting_team_id, bowling_team_id, status, innings_type)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [inningsId, matchId, inningsNumber, battingTeamId, bowlingTeamId, INNINGS_STATUS.IN_PROGRESS,
         inningsNumber === 1 ? 'first' : inningsNumber === 2 ? 'second' : 'super_over']
      );

      logger.info('Innings started', { matchId, inningsId, inningsNumber });

      return { innings_id: inningsId, innings_number: inningsNumber, status: 'in_progress' };
    } finally {
      connection.release();
    }
  }

  /**
   * Add delivery event - CORE FUNCTION
   * NEVER mutate score directly - always add event
   */
  async addDelivery(matchId, userId, deliveryData) {
    const match = await matchRepository.findById(matchId);
    if (!match) throw new NotFoundError('Match not found');

    if (match.status !== 'live') {
      throw new ValidationError('Match must be live to add deliveries');
    }

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      const [innings] = await connection.query(
        `SELECT * FROM cricket_innings WHERE match_id = ? AND status = 'in_progress' ORDER BY innings_number DESC LIMIT 1`,
        [matchId]
      );

      if (!innings.length) {
        throw new ValidationError('No active innings found. Start innings first.');
      }

      const inningsData = innings[0];

      const [lastDelivery] = await connection.query(
        `SELECT * FROM cricket_deliveries WHERE match_id = ? AND innings_id = ? ORDER BY sequence_number DESC LIMIT 1`,
        [matchId, inningsData.id]
      );

      const sequenceNumber = lastDelivery ? lastDelivery.sequence_number + 1 : 1;
      const overNumber = lastDelivery ? lastDelivery.over_number : 1;
      const ballInOver = lastDelivery ? lastDelivery.ball_in_over + 1 : 1;

      const finalBallInOver = ballInOver > 6 ? 1 : ballInOver;
      const finalOverNumber = ballInOver > 6 ? overNumber + 1 : overNumber;

      const { valid, errors, warnings } = cricketEngine.validateEvent(
        deliveryData.event_type || 'delivery',
        { ...deliveryData, over_number: finalOverNumber, ball_in_over: finalBallInOver }
      );

      if (!valid && errors.length > 0) {
        throw new ValidationError(errors.join(', '));
      }

      const deliveryId = generateUUID();

      const totalRuns = this.calculateTotalRuns(deliveryData);
      const strikeRotated = this.shouldRotateStrike(totalRuns, deliveryData);

      const sql = `
        INSERT INTO cricket_deliveries (
          id, match_id, innings_id, sequence_number, over_number, ball_in_over,
          delivery_type, batter_runs, extra_runs, overthrow_runs, bye_runs, leg_bye_runs,
          penalty_runs, total_runs, wicket, wicket_type, wicket_detail,
          bowler_id, striker_id, non_striker_id, fielder_id,
          striker_end, strike_rotated,
          is_no_ball, is_wide, is_bye, is_leg_bye, is_free_hit, is_overthrow,
          is_powerplay, powerplay_type, runs_from_delivery,
          is_valid, validation_notes, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;

      await connection.query(sql, [
        deliveryId, matchId, inningsData.id,
        sequenceNumber, finalOverNumber, finalBallInOver,
        deliveryData.delivery_type || 'legal',
        deliveryData.batter_runs || 0,
        deliveryData.extra_runs || 0,
        deliveryData.overthrow_runs || 0,
        deliveryData.bye_runs || 0,
        deliveryData.leg_bye_runs || 0,
        deliveryData.penalty_runs || 0,
        totalRuns,
        deliveryData.wicket || false,
        deliveryData.wicket_type || 'none',
        deliveryData.wicket_detail || null,
        deliveryData.bowler_id,
        deliveryData.striker_id,
        deliveryData.non_striker_id,
        deliveryData.fielder_id || null,
        deliveryData.striker_end || 'pitch',
        strikeRotated,
        deliveryData.delivery_type === 'no_ball',
        deliveryData.delivery_type === 'wide',
        deliveryData.is_bye || false,
        deliveryData.is_leg_bye || false,
        deliveryData.is_free_hit || false,
        deliveryData.is_overthrow || false,
        this.isInPowerplay(finalOverNumber),
        this.getPowerplayType(finalOverNumber),
        this.classifyRuns(deliveryData),
        true,
        warnings?.join('; ') || 'valid',
        userId
      ]);

      await this.updateInningsStats(connection, inningsData.id, totalRuns, deliveryData);
      await this.updateBatterStats(connection, inningsData.id, deliveryData);
      await this.updateBowlerStats(connection, inningsData.id, deliveryData);
      await this.updatePartnership(connection, inningsData.id, deliveryData);
      await this.createSnapshot(connection, matchId, inningsData.id, sequenceNumber);

      const [inningsRow] = await connection.query(
        `SELECT * FROM cricket_innings WHERE id = ?`,
        [inningsData.id]
      );

      await connection.commit();

      ws.emitToMatch(matchId, 'cricket:delivery', {
        delivery_id: deliveryId,
        sequence_number: sequenceNumber,
        over: finalOverNumber,
        ball: finalBallInOver,
        total_runs: totalRuns,
        wicket: deliveryData.wicket || false,
        innings: inningsRow[0],
        timestamp: new Date().toISOString()
      });

      logger.info('Delivery added', { matchId, deliveryId, sequenceNumber, totalRuns });

      return {
        delivery_id: deliveryId,
        sequence_number: sequenceNumber,
        over: finalOverNumber,
        ball: finalBallInOver,
        total_runs: totalRuns,
        wickets: inningsRow[0].wickets_fallen,
        overs: innings[0].overs_bowled,
        innings_status: innings[0]
      };

    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  calculateTotalRuns(data) {
    let total = data.batter_runs || 0;

    if (data.delivery_type === 'no_ball') {
      total += 1 + (data.batter_runs || 0);
    } else if (data.delivery_type === 'wide') {
      total += 1 + (data.runs_from_delivery || 0);
    }

    if (data.is_bye) total += data.bye_runs || 0;
    if (data.is_leg_bye) total += data.leg_bye_runs || 0;
    if (data.penalty_runs) total += data.penalty_runs;
    if (data.overthrow_runs) total += data.overthrow_runs;

    return total;
  }

  shouldRotateStrike(totalRuns, data) {
    if (data.wicket) return true;
    if (data.delivery_type !== 'legal') return false;
    return totalRuns % 2 === 1;
  }

  classifyRuns(data) {
    const runs = data.batter_runs || 0;
    const isBoundary = data.is_boundary || false;

    if (runs === 0) return 'dot';
    if (runs === 1) return 'single';
    if (runs === 2) return 'double';
    if (runs === 3) return 'triple';
    if (runs === 4 || isBoundary) return data.delivery_type === 'no_ball' ? 'four' : 'boundary_four';
    if (runs === 6 || runs > 6) return data.delivery_type === 'no_ball' ? 'six' : 'boundary_six';
    return 'single';
  }

  isInPowerplay(overNumber) {
    return overNumber <= 6;
  }

  getPowerplayType(overNumber) {
    if (overNumber <= 6) return 'mandatory';
    if (overNumber <= 10) return 'strategic';
    return 'non_powerplay';
  }

  async updateInningsStats(connection, inningsId, runs, delivery) {
    const [innings] = await connection.query(
      `SELECT * FROM cricket_innings WHERE id = ?`,
      [inningsId]
    );

    const currentRuns = (innings[0].total_runs || 0) + runs;
    const currentWickets = (innings[0].wickets_fallen || 0) + (delivery.wicket ? 1 : 0);

    const [legalBalls] = await connection.query(
      `SELECT COUNT(*) as balls FROM cricket_deliveries
       WHERE innings_id = ? AND delivery_type = 'legal' AND is_reversed = FALSE`,
      [inningsId]
    );

    const oversBowled = cricketEngine.calculateOvers(legalBalls[0].balls);
    const runRate = cricketEngine.calculateRunRate(currentRuns, legalBalls[0].balls);

    let targetRuns = null;
    let requiredRunRate = null;

    if (innings[0].innings_number === 2 && innings[0].target_runs) {
      const remainingOvers = 20 - oversBowled;
      requiredRunRate = remainingOvers > 0 ? ((innings[0].target_runs - currentRuns) / remainingOvers).toFixed(2) : 0;
    }

    await connection.query(
      `UPDATE cricket_innings SET
       total_runs = ?, wickets_fallen = ?, overs_bowled = ?, balls_bowled = ?,
       current_run_rate = ?, required_run_rate = ?, updated_at = NOW()
       WHERE id = ?`,
      [currentRuns, currentWickets, oversBowled, legalBalls[0].balls, runRate, requiredRunRate, inningsId]
    );

    await matchRepository.update(innings[0].match_id, {
      home_score: currentRuns,
      away_score: currentWickets
    });
  }

  async updateBatterStats(connection, inningsId, delivery) {
    if (!delivery.striker_id) return;

    const [existing] = await connection.query(
      `SELECT * FROM cricket_batter_stats WHERE innings_id = ? AND batter_id = ?`,
      [inningsId, delivery.striker_id]
    );

    const isOut = delivery.wicket && delivery.striker_id === delivery.striker_id;
    const isOnStrike = delivery.strike_rotated === false;

    if (existing.length === 0) {
      await connection.query(
        `INSERT INTO cricket_batter_stats (id, match_id, innings_id, batter_id, runs, balls_faced, fours, sixes, is_not_out, is_on_strike)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          generateUUID(),
          delivery.match_id,
          inningsId,
          delivery.striker_id,
          delivery.batter_runs || 0,
          delivery.delivery_type === 'legal' ? 1 : 0,
          (delivery.runs_from_delivery === 'four' || delivery.runs_from_delivery === 'boundary_four') ? 1 : 0,
          (delivery.runs_from_delivery === 'six' || delivery.runs_from_delivery === 'boundary_six') ? 1 : 0,
          !isOut,
          isOnStrike
        ]
      );
    } else {
      await connection.query(
        `UPDATE cricket_batter_stats SET
         runs = runs + ?, balls_faced = balls_faced + ?,
         fours = fours + ?, sixes = sixes + ?,
         is_not_out = ?, is_on_strike = ?,
         strike_rate = ((runs + ?) / (balls_faced + ?)) * 100
         WHERE innings_id = ? AND batter_id = ?`,
        [
          delivery.batter_runs || 0,
          delivery.delivery_type === 'legal' ? 1 : 0,
          (delivery.runs_from_delivery === 'four' || delivery.runs_from_delivery === 'boundary_four') ? 1 : 0,
          (delivery.runs_from_delivery === 'six' || delivery.runs_from_delivery === 'boundary_six') ? 1 : 0,
          !isOut,
          isOnStrike,
          delivery.batter_runs || 0,
          delivery.delivery_type === 'legal' ? 1 : 0,
          inningsId,
          delivery.striker_id
        ]
      );
    }
  }

  async updateBowlerStats(connection, inningsId, delivery) {
    if (!delivery.bowler_id) return;

    const [existing] = await connection.query(
      `SELECT * FROM cricket_bowler_stats WHERE innings_id = ? AND bowler_id = ?`,
      [inningsId, delivery.bowler_id]
    );

    const isLegal = delivery.delivery_type === 'legal';
    const isNoBall = delivery.delivery_type === 'no_ball';
    const isWide = delivery.delivery_type === 'wide';

    let runsConceded = delivery.batter_runs || 0;
    if (isNoBall) runsConceded += 1;
    if (isWide) runsConceded += 1 + (delivery.runs_from_delivery || 0);

    if (existing.length === 0) {
      await connection.query(
        `INSERT INTO cricket_bowler_stats (id, match_id, innings_id, bowler_id, overs_bowled, legal_balls, runs_conceded, wickets, no_balls, wides)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          generateUUID(),
          delivery.match_id,
          inningsId,
          delivery.bowler_id,
          isLegal ? 1 : 0,
          isLegal ? 1 : 0,
          runsConceded,
          delivery.wicket ? 1 : 0,
          isNoBall ? 1 : 0,
          isWide ? 1 : 0
        ]
      );
    } else {
      const legalBalls = existing[0].legal_balls + (isLegal ? 1 : 0);
      const overs = cricketEngine.calculateOvers(legalBalls);

      await connection.query(
        `UPDATE cricket_bowler_stats SET
         overs_bowled = ?, legal_balls = ?,
         runs_conceded = runs_conceded + ?, wickets = wickets + ?,
         no_balls = no_balls + ?, wides = wides + ?,
         economy_rate = (runs_conceded + ?) / ?
         WHERE innings_id = ? AND bowler_id = ?`,
        [
          overs, legalBalls,
          runsConceded,
          delivery.wicket ? 1 : 0,
          isNoBall ? 1 : 0,
          isWide ? 1 : 0,
          runsConceded,
          overs || 1,
          inningsId,
          delivery.bowler_id
        ]
      );
    }
  }

  async updatePartnership(connection, inningsId, delivery) {
    const [current] = await connection.query(
      `SELECT * FROM cricket_partnerships WHERE innings_id = ? AND is_current = TRUE`,
      [inningsId]
    );

    const totalRuns = this.calculateTotalRuns(delivery);

    if (current.length === 0) {
      if (!delivery.striker_id || !delivery.non_striker_id) return;

      await connection.query(
        `INSERT INTO cricket_partnerships (id, match_id, innings_id, batsman1_id, batsman2_id, runs, balls, is_current)
         VALUES (?, ?, ?, ?, ?, ?, ?, TRUE)`,
        [
          generateUUID(),
          delivery.match_id,
          inningsId,
          delivery.striker_id,
          delivery.non_striker_id,
          totalRuns,
          delivery.delivery_type === 'legal' ? 1 : 0
        ]
      );
    } else {
      await connection.query(
        `UPDATE cricket_partnerships SET
         runs = runs + ?, balls = balls + ?,
         fours = fours + ?, sixes = sixes + ?
         WHERE id = ?`,
        [
          totalRuns,
          delivery.delivery_type === 'legal' ? 1 : 0,
          (delivery.runs_from_delivery === 'four' || delivery.runs_from_delivery === 'boundary_four') ? 1 : 0,
          (delivery.runs_from_delivery === 'six' || delivery.runs_from_delivery === 'boundary_six') ? 1 : 0,
          current[0].id
        ]
      );

      if (delivery.wicket) {
        await connection.query(
          `UPDATE cricket_partnerships SET is_current = FALSE, is_broken = TRUE, wicket_ball_id = ?
           WHERE id = ?`,
          [delivery.delivery_id, current[0].id]
        );
      }
    }
  }

  async createSnapshot(connection, matchId, inningsId, sequenceNumber) {
    const [innings] = await connection.query(
      `SELECT * FROM cricket_innings WHERE id = ?`,
      [inningsId]
    );

    const [deliveries] = await connection.query(
      `SELECT * FROM cricket_deliveries WHERE innings_id = ? AND is_reversed = FALSE ORDER BY sequence_number DESC LIMIT 1`,
      [inningsId]
    );

    const [batters] = await connection.query(
      `SELECT * FROM cricket_batter_stats WHERE innings_id = ? AND is_on_strike = TRUE`,
      [inningsId]
    );

    const [partnership] = await connection.query(
      `SELECT * FROM cricket_partnerships WHERE innings_id = ? AND is_current = TRUE`,
      [inningsId]
    );

    const snapshotData = {
      innings: innings[0],
      last_delivery: deliveries[0] || null,
      striker: batters[0] || null,
      partnership: partnership[0] || null
    };

    await connection.query(
      `INSERT INTO cricket_match_snapshots (id, match_id, sequence_number, innings_number, over_number, ball_in_over, total_runs, wickets_fallen, overs_completed, striker_id, non_striker_id, bowler_id, partnership_runs, snapshot_data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        generateUUID(),
        matchId,
        sequenceNumber,
        innings[0].innings_number,
        deliveries[0]?.over_number || 1,
        deliveries[0]?.ball_in_over || 1,
        innings[0].total_runs,
        innings[0].wickets_fallen,
        innings[0].overs_bowled,
        batters[0]?.batter_id || null,
        batters[1]?.batter_id || null,
        deliveries[0]?.bowler_id || null,
        partnership[0]?.runs || 0,
        JSON.stringify(snapshotData)
      ]
    );
  }

  /**
   * UNDO DELIVERY - Restore previous state
   */
  async undoDelivery(matchId, deliveryId, userId) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      const [delivery] = await connection.query(
        `SELECT * FROM cricket_deliveries WHERE id = ?`,
        [deliveryId]
      );

      if (!delivery.length) {
        throw new NotFoundError('Delivery not found');
      }

      if (delivery[0].is_reversed) {
        throw new ValidationError('Delivery already reversed');
      }

      await connection.query(
        `UPDATE cricket_deliveries SET is_reversed = TRUE, reversed_at = NOW(), reversed_by = ? WHERE id = ?`,
        [userId, deliveryId]
      );

      const [allDeliveries] = await connection.query(
        `SELECT * FROM cricket_deliveries
         WHERE match_id = ? AND innings_id = ? AND is_reversed = FALSE
         ORDER BY sequence_number DESC`,
        [matchId, delivery[0].innings_id]
      );

      let totalRuns = 0;
      let wickets = 0;

      for (const d of allDeliveries) {
        totalRuns += d.total_runs;
        if (d.wicket) wickets++;
      }

      const [legalBalls] = await connection.query(
        `SELECT COUNT(*) as balls FROM cricket_deliveries
         WHERE innings_id = ? AND delivery_type = 'legal' AND is_reversed = FALSE`,
        [delivery[0].innings_id]
      );

      const overs = cricketEngine.calculateOvers(legalBalls[0].balls);

      await connection.query(
        `UPDATE cricket_innings SET
         total_runs = ?, wickets_fallen = ?, overs_bowled = ?, balls_bowled = ?
         WHERE id = ?`,
        [totalRuns, wickets, overs, legalBalls[0].balls, delivery[0].innings_id]
      );

      await this.createSnapshot(connection, matchId, delivery[0].innings_id, delivery[0].sequence_number);

      await connection.commit();

      ws.emitToMatch(matchId, 'cricket:delivery_undone', {
        delivery_id: deliveryId,
        sequence_number: delivery[0].sequence_number,
        new_total: totalRuns,
        timestamp: new Date().toISOString()
      });

      return { success: true, new_total: totalRuns, wickets };

    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * GET INNINGS STATS
   */
  async getInningsStats(matchId, inningsNumber = 1) {
    const connection = await db.getConnection();
    try {
      const [innings] = await connection.query(
        `SELECT * FROM cricket_innings WHERE match_id = ? AND innings_number = ?`,
        [matchId, inningsNumber]
      );

      if (!innings.length) {
        throw new NotFoundError('Innings not found');
      }

      const [deliveries] = await connection.query(
        `SELECT * FROM cricket_deliveries WHERE innings_id = ? AND is_reversed = FALSE ORDER BY sequence_number`,
        [innings[0].id]
      );

      const [batters] = await connection.query(
        `SELECT * FROM cricket_batter_stats WHERE innings_id = ? ORDER BY runs DESC`,
        [innings[0].id]
      );

      const [bowlers] = await connection.query(
        `SELECT * FROM cricket_bowler_stats WHERE innings_id = ? ORDER BY wickets DESC, economy_rate ASC`,
        [innings[0].id]
      );

      const [partnerships] = await connection.query(
        `SELECT * FROM cricket_partnerships WHERE innings_id = ? ORDER BY runs DESC`,
        [innings[0].id]
      );

      return {
        innings: innings[0],
        deliveries,
        batters,
        bowlers,
        partnerships
      };
    } finally {
      connection.release();
    }
  }

  /**
   * DETERMINISTIC REPLAY TEST
   * Critical for ensuring data integrity
   */
  async testDeterministicReplay(matchId) {
    return await cricketEngine.testDeterministicReplay(matchId);
  }

  /**
   * ========================================
   * SUPER OVER MANAGEMENT
   * ========================================
   */
  async initializeSuperOver(matchId, team1Id, team2Id) {
    const connection = await db.getConnection();
    try {
      const [existing] = await connection.query(
        `SELECT COUNT(*) as count FROM cricket_super_overs WHERE match_id = ?`,
        [matchId]
      );

      const superOverNumber = existing[0].count + 1;

      const superOverId = generateUUID();
      await connection.query(
        `INSERT INTO cricket_super_overs (id, match_id, super_over_number, team1_id, team2_id, status)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [superOverId, matchId, superOverNumber, team1Id, team2Id, SUPER_OVER_STATUS.IN_PROGRESS]
      );

      logger.info('Super over initialized', { matchId, superOverId, superOverNumber });

      return { super_over_id: superOverId, super_over_number: superOverNumber };
    } finally {
      connection.release();
    }
  }

  async addSuperOverDelivery(superOverId, battingTeamId, deliveryData) {
    const connection = await db.getConnection();
    try {
      const [existingDeliveries] = await connection.query(
        `SELECT COUNT(*) as count FROM cricket_super_over_deliveries WHERE super_over_id = ?`,
        [superOverId]
      );

      const sequenceNumber = existingDeliveries[0].count + 1;
      const totalRuns = this.calculateTotalRuns(deliveryData);

      const deliveryId = generateUUID();
      await connection.query(
        `INSERT INTO cricket_super_over_deliveries (
          id, super_over_id, match_id, batting_team_id, sequence_number,
          delivery_type, batter_runs, extra_runs, total_runs, wicket, wicket_type,
          bowler_id, striker_id, non_striker_id, is_powerplay
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          deliveryId, superOverId, deliveryData.match_id, battingTeamId, sequenceNumber,
          deliveryData.delivery_type || 'legal',
          deliveryData.batter_runs || 0,
          deliveryData.extra_runs || 0,
          totalRuns,
          deliveryData.wicket || false,
          deliveryData.wicket_type || null,
          deliveryData.bowler_id,
          deliveryData.striker_id,
          deliveryData.non_striker_id,
          sequenceNumber <= 6
        ]
      );

      return { delivery_id: deliveryId, sequence_number: sequenceNumber, total_runs: totalRuns };
    } finally {
      connection.release();
    }
  }

  async completeSuperOver(matchId) {
    const connection = await db.getConnection();
    try {
      const [superOver] = await connection.query(
        `SELECT * FROM cricket_super_overs WHERE match_id = ? AND status = 'in_progress' ORDER BY super_over_number DESC LIMIT 1`,
        [matchId]
      );

      if (!superOver.length) throw new NotFoundError('No active super over found');

      const [deliveries] = await connection.query(
        `SELECT * FROM cricket_super_over_deliveries WHERE super_over_id = ? ORDER BY sequence_number`,
        [superOver[0].id]
      );

      const team1Deliveries = deliveries.filter(d => d.batting_team_id === superOver[0].team1_id);
      const team2Deliveries = deliveries.filter(d => d.batting_team_id === superOver[0].team2_id);

      const team1Runs = team1Deliveries.reduce((sum, d) => sum + d.total_runs, 0);
      const team1Wickets = team1Deliveries.filter(d => d.wicket).length;
      const team1Balls = team1Deliveries.filter(d => d.delivery_type === 'legal').length;

      const team2Runs = team2Deliveries.reduce((sum, d) => sum + d.total_runs, 0);
      const team2Wickets = team2Deliveries.filter(d => d.wicket).length;
      const team2Balls = team2Deliveries.filter(d => d.delivery_type === 'legal').length;

      let winnerTeamId = null;
      if (team1Runs > team2Runs) winnerTeamId = superOver[0].team1_id;
      else if (team2Runs > team1Runs) winnerTeamId = superOver[0].team2_id;

      await connection.query(
        `UPDATE cricket_super_overs SET
         team1_runs = ?, team1_wickets = ?, team1_balls_bowled = ?,
         team2_runs = ?, team2_wickets = ?, team2_balls_bowled = ?,
         winner_team_id = ?, status = ?, completed_at = NOW()
         WHERE id = ?`,
        [team1Runs, team1Wickets, team1Balls, team2Runs, team2Wickets, team2Balls, winnerTeamId, SUPER_OVER_STATUS.COMPLETED, superOver[0].id]
      );

      ws.emitToMatch(matchId, 'cricket:super_over_completed', {
        super_over_id: superOver[0].id,
        team1_runs: team1Runs,
        team2_runs: team2Runs,
        winner: winnerTeamId,
        timestamp: new Date().toISOString()
      });

      return {
        super_over_id: superOver[0].id,
        team1_runs: team1Runs,
        team2_runs: team2Runs,
        winner: winnerTeamId
      };
    } finally {
      connection.release();
    }
  }

  /**
   * ========================================
   * DRS / REVIEW SYSTEM
   * ========================================
   */
  async initializeReviewConfig(matchId, maxReviewsPerInnings = 1) {
    const connection = await db.getConnection();
    try {
      const [match] = await connection.query(
        `SELECT home_team_id, away_team_id FROM matches WHERE id = ?`,
        [matchId]
      );

      if (!match.length) throw new NotFoundError('Match not found');

      const configId = generateUUID();
      await connection.query(
        `INSERT INTO cricket_review_configs (id, match_id, team1_reviews_remaining, team2_reviews_remaining, max_reviews_per_innings)
         VALUES (?, ?, ?, ?, ?)`,
        [configId, matchId, maxReviewsPerInnings, maxReviewsPerInnings, maxReviewsPerInnings]
      );

      return { review_config_id: configId, team1_reviews: maxReviewsPerInnings, team2_reviews: maxReviewsPerInnings };
    } finally {
      connection.release();
    }
  }

  async requestReview(matchId, teamId, reviewData) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      const [config] = await connection.query(
        `SELECT * FROM cricket_review_configs WHERE match_id = ?`,
        [matchId]
      );

      if (!config.length) throw new NotFoundError('Review config not found');

      const isTeam1 = config[0].team1_reviews_remaining > 0;
      const currentReviews = isTeam1 ? config[0].team1_reviews_remaining : config[0].team2_reviews_remaining;

      if (currentReviews <= 0) {
        throw new ValidationError('No reviews remaining for this team');
      }

      const reviewId = generateUUID();
      await connection.query(
        `INSERT INTO cricket_player_reviews (
          id, match_id, team_id, innings_number, review_type, decision_original,
          batter_id, bowler_id, ball_sequence_number, over_number, ball_in_over,
          on_field_umpire_id, requested_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          reviewId, matchId, teamId, reviewData.innings_number, reviewData.review_type,
          reviewData.decision_original, reviewData.batter_id, reviewData.bowler_id,
          reviewData.ball_sequence_number, reviewData.over_number, reviewData.ball_in_over,
          reviewData.on_field_umpire_id, reviewData.requested_by
        ]
      );

      if (isTeam1) {
        await connection.query(
          `UPDATE cricket_review_configs SET team1_reviews_remaining = team1_reviews_remaining - 1 WHERE id = ?`,
          [config[0].id]
        );
      } else {
        await connection.query(
          `UPDATE cricket_review_configs SET team2_reviews_remaining = team2_reviews_remaining - 1 WHERE id = ?`,
          [config[0].id]
        );
      }

      await connection.commit();

      ws.emitToMatch(matchId, 'cricket:review_requested', {
        review_id: reviewId,
        team_id: teamId,
        reviews_remaining: currentReviews - 1,
        timestamp: new Date().toISOString()
      });

      return { review_id: reviewId, reviews_remaining: currentReviews - 1 };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async processReviewDecision(reviewId, decision) {
    const connection = await db.getConnection();
    try {
      const [review] = await connection.query(
        `SELECT * FROM cricket_player_reviews WHERE id = ?`,
        [reviewId]
      );

      if (!review.length) throw new NotFoundError('Review not found');

      const isUmpireCall = review[0].decision_original !== decision;
      const isSuccess = decision === 'out' && review[0].decision_original === 'not_out';

      await connection.query(
        `UPDATE cricket_player_reviews SET
         decision_final = ?, is_umpire_call = ?, is_wicket = ?, result_comment = ?, decided_by = ?
         WHERE id = ?`,
        [decision, isUmpireCall, isSuccess, isSuccess ? 'Review upheld' : 'Review lost', decision, reviewId]
      );

      const [config] = await connection.query(
        `SELECT * FROM cricket_review_configs WHERE match_id = ?`,
        [review[0].match_id]
      );

      if (!isSuccess && config.length > 0) {
        const isTeam1 = review[0].team_id === config[0].team1_reviews_remaining;
        if (isTeam1) {
          await connection.query(
            `UPDATE cricket_review_configs SET team1_reviews_remaining = team1_reviews_remaining - 1 WHERE id = ?`,
            [config[0].id]
          );
        } else {
          await connection.query(
            `UPDATE cricket_review_configs SET team2_reviews_remaining = team2_reviews_remaining - 1 WHERE id = ?`,
            [config[0].id]
          );
        }
      }

      ws.emitToMatch(review[0].match_id, 'cricket:review_decided', {
        review_id: reviewId,
        decision: decision,
        is_success: isSuccess,
        is_umpire_call: isUmpireCall,
        timestamp: new Date().toISOString()
      });

      return { success: isSuccess, is_umpire_call: isUmpireCall, decision: decision };
    } finally {
      connection.release();
    }
  }

  async getReviewStatus(matchId) {
    const connection = await db.getConnection();
    try {
      const [config] = await connection.query(
        `SELECT * FROM cricket_review_configs WHERE match_id = ?`,
        [matchId]
      );

      const [reviews] = await connection.query(
        `SELECT * FROM cricket_player_reviews WHERE match_id = ? ORDER BY created_at DESC`,
        [matchId]
      );

      return {
        config: config[0] || null,
        reviews: reviews
      };
    } finally {
      connection.release();
    }
  }

  /**
   * ========================================
   * FOLLOW-ON DETECTION
   * ========================================
   */
  async checkFollowOn(matchId) {
    const connection = await db.getConnection();
    try {
      const [firstInnings] = await connection.query(
        `SELECT * FROM cricket_innings WHERE match_id = ? AND innings_number = 1 AND status = 'completed'`,
        [matchId]
      );

      const [secondInnings] = await connection.query(
        `SELECT * FROM cricket_innings WHERE match_id = ? AND innings_number = 2 AND status = 'in_progress'`,
        [matchId]
      );

      if (!firstInnings.length || !secondInnings.length) {
        return { available: false, reason: 'Innings not in correct state' };
      }

      const result = cricketEngine.calculateFollowOnRecommendation(
        firstInnings[0].total_runs,
        firstInnings[0].overs_bowled,
        secondInnings[0].overs_bowled,
        'TEST'
      );

      if (result.recommended) {
        const logId = generateUUID();
        await connection.query(
          `INSERT INTO cricket_followon_logs (id, match_id, innings_triggered, lead_runs, recommended)
           VALUES (?, ?, ?, ?, ?)`,
          [logId, matchId, 1, result.lead_runs, true]
        );
      }

      return {
        available: true,
        recommended: result.recommended,
        lead_runs: result.lead_runs,
        threshold: result.threshold,
        reason: result.reason
      };
    } finally {
      connection.release();
    }
  }

  /**
   * ========================================
   * ENHANCED ANALYTICS
   * ========================================
   */
  async calculateMatchAnalytics(matchId, inningsNumber = 1) {
    const connection = await db.getConnection();
    try {
      const [innings] = await connection.query(
        `SELECT * FROM cricket_innings WHERE match_id = ? AND innings_number = ?`,
        [matchId, inningsNumber]
      );

      if (!innings.length) throw new NotFoundError('Innings not found');

      const [deliveries] = await connection.query(
        `SELECT * FROM cricket_deliveries WHERE innings_id = ? AND is_reversed = FALSE ORDER BY sequence_number`,
        [innings[0].id]
      );

      const phases = ['powerplay', 'middle', 'death', 'overall'];
      const analytics = {};

      for (const phase of phases) {
        const phaseStats = cricketEngine.calculatePhaseStats(deliveries, phase);
        analytics[phase] = phaseStats;
      }

      analytics.momentum = cricketEngine.calculateMomentum(deliveries);
      analytics.death_overs = cricketEngine.calculateDeathOversStats(deliveries);

      const wicketsInHand = 10 - innings[0].wickets_fallen;
      const oversRemaining = cricketEngine.formatConfig[this.format].maxOvers - innings[0].overs_bowled;
      analytics.pressure_index = cricketEngine.calculatePressureIndex(wicketsInHand, oversRemaining);
      analytics.projected_score = cricketEngine.calculateProjectedScore(innings[0]);

      return analytics;
    } finally {
      connection.release();
    }
  }

  async recordOverStats(inningsId, overNumber, deliveries) {
    const connection = await db.getConnection();
    try {
      const overDeliveries = deliveries.filter(d => d.over_number === overNumber);

      let runs = 0, wickets = 0, noBalls = 0, wides = 0, byes = 0, legByes = 0, penalty = 0, overthrow = 0;
      let maiden = true;

      const ballData = [];
      for (let i = 1; i <= 6; i++) {
        const ball = overDeliveries.find(d => d.ball_in_over === i);
        if (ball) {
          runs += ball.total_runs || 0;
          if (ball.wicket) wickets++;
          if (ball.delivery_type === 'no_ball') noBalls++;
          if (ball.delivery_type === 'wide') wides++;
          if (ball.is_bye) byes += ball.bye_runs || 0;
          if (ball.is_leg_bye) legByes += ball.leg_bye_runs || 0;
          if (ball.penalty_runs) penalty += ball.penalty_runs;
          if (ball.is_overthrow) overthrow += ball.overthrow_runs || 0;

          if (ball.delivery_type === 'legal' && (ball.batter_runs > 0 || ball.is_bye || ball.is_leg_bye)) {
            maiden = false;
          }

          ballData.push({ runs: ball.batter_runs || 0, type: ball.delivery_type });
        } else {
          ballData.push({ runs: null, type: null });
        }
      }

      const isMaiden = maiden && wides === 0 && noBalls === 0;
      const isWicketMaiden = isMaiden && wickets > 0;

      const overId = generateUUID();
      await connection.query(
        `INSERT INTO cricket_fallow_overs (
          id, match_id, innings_id, over_number, bowler_id, runs_conceded, wickets_taken,
          is_maiden, is_wicket_maiden, ball_1_runs, ball_1_type, ball_2_runs, ball_2_type,
          ball_3_runs, ball_3_type, ball_4_runs, ball_4_type, ball_5_runs, ball_5_type,
          ball_6_runs, ball_6_type, no_balls, wides, byes, leg_byes, penalty_runs, overthrow_runs
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          overId, overDeliveries[0]?.match_id, inningsId, overNumber, overDeliveries[0]?.bowler_id,
          runs, wickets, isMaiden, isWicketMaiden,
          ballData[0]?.runs, ballData[0]?.type, ballData[1]?.runs, ballData[1]?.type,
          ballData[2]?.runs, ballData[2]?.type, ballData[3]?.runs, ballData[3]?.type,
          ballData[4]?.runs, ballData[4]?.type, ballData[5]?.runs, ballData[5]?.type,
          noBalls, wides, byes, legByes, penalty, overthrow
        ]
      );

      return { over_id: overId, is_maiden: isMaiden };
    } finally {
      connection.release();
    }
  }
}