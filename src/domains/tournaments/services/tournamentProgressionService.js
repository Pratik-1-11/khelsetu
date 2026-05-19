import db from '../../../infrastructure/postgres/index.js';
import matchRepository from '../../matches/repositories/matchRepository.js';
import fixtureService from './fixtureService.js';
import { NotFoundError, ValidationError, ConflictError } from '../../../core/errors/index.js';
import { generateUUID } from '../../../core/utils/index.js';
import logger from '../../../core/logger/index.js';
import ws from '../../../core/websocket/index.js';

const KNOCKOUT_ROUNDS = [
  { name: 'Preliminary Round', number: 0 },
  { name: 'Round of 64', number: 1 },
  { name: 'Round of 32', number: 2 },
  { name: 'Round of 16', number: 3 },
  { name: 'Quarter Finals', number: 4 },
  { name: 'Semi Finals', number: 5 },
  { name: 'Third Place Playoff', number: 6 },
  { name: 'Final', number: 7 }
];

export class TournamentProgressionService {
  async initializeKnockoutStructure(tournamentId, format = 'single_elimination') {
    const tournament = await db.query('SELECT * FROM tournaments WHERE id = ?', [tournamentId]);
    if (!tournament[0]) {
      throw new NotFoundError('Tournament not found');
    }

    if (tournament[0].format !== 'knockout' && tournament[0].format !== 'double_elimination') {
      throw new ValidationError('Tournament is not a knockout format');
    }

    const [existing] = await db.query(
      `SELECT COUNT(*) as count FROM tournament_progression WHERE tournament_id = ?`,
      [tournamentId]
    );

    if (existing[0].count > 0) {
      logger.warn('Knockout structure already initialized', { tournamentId });
      return await this.getProgression(tournamentId);
    }

    const teams = await db.query(
      `SELECT team_id FROM tournament_teams WHERE tournament_id = ? AND status = 'confirmed' ORDER BY seed_number`,
      [tournamentId]
    );

    const teamIds = teams.map(t => t.team_id);

    if (teamIds.length < 2) {
      throw new ValidationError('At least 2 teams required for knockout');
    }

    const numRounds = Math.ceil(Math.log2(teamIds.length));
    const rounds = KNOCKOUT_ROUNDS.slice(-numRounds);

    for (let i = 0; i < numRounds; i++) {
      const roundName = rounds[i]?.name || `Round ${i + 1}`;
      const matchesInRound = Math.pow(2, numRounds - i - 1);

      for (let j = 0; j < matchesInRound; j++) {
        await db.query(
          `INSERT INTO tournament_progression (id, tournament_id, round_name, round_number, status)
           VALUES (?, ?, ?, ?, 'pending')`,
          [generateUUID(), tournamentId, roundName, i + 1]
        );
      }
    }

    await db.query(
      `UPDATE tournaments SET status = 'in_progress' WHERE id = ?`,
      [tournamentId]
    );

    logger.info('Knockout structure initialized', { tournamentId, rounds: numRounds, teams: teamIds.length });

    return await this.getProgression(tournamentId);
  }

  async progressToNextRound(tournamentId) {
    const progression = await this.getProgression(tournamentId);
    
    const currentRound = progression.find(p => p.status === 'in_progress');
    if (!currentRound) {
      throw new ValidationError('No round currently in progress');
    }

    const roundMatches = progression.filter(p => p.round_number === currentRound.round_number);
    const completedMatches = roundMatches.filter(p => p.status === 'completed');

    if (completedMatches.length < roundMatches.length) {
      throw new ValidationError('Not all matches in current round are completed');
    }

    const nextRoundNumber = currentRound.round_number + 1;
    const nextRoundProgression = progression.filter(p => p.round_number === nextRoundNumber);

    if (nextRoundProgression.length === 0) {
      await this.completeTournament(tournamentId);
      return { tournamentCompleted: true };
    }

    const winners = roundMatches.map(m => m.winner_id).filter(Boolean);
    const nextMatches = progression.filter(p => p.round_number === nextRoundNumber);

    for (let i = 0; i < nextMatches.length; i += 2) {
      if (winners[i] && winners[i + 1]) {
        await db.query(
          `UPDATE tournament_progression SET home_team_id = ?, away_team_id = ?, status = 'scheduled' WHERE id = ?`,
          [winners[i], winners[i + 1], nextMatches[i].id]
        );
      }
    }

    await db.query(
      `UPDATE tournament_progression SET status = 'in_progress' WHERE tournament_id = ? AND round_number = ?`,
      [tournamentId, nextRoundNumber]
    );

    ws.emitToTournament(tournamentId, 'tournament:round_progressed', {
      tournamentId,
      completedRound: currentRound.round_number,
      nextRound: nextRoundNumber,
      timestamp: new Date().toISOString()
    });

    logger.info('Progressed to next round', { tournamentId, nextRound: nextRoundNumber });

    return await this.getProgression(tournamentId);
  }

  async completeMatchAndProgress(matchId, winnerId, score) {
    const [match] = await db.query('SELECT * FROM matches WHERE id = ?', [matchId]);
    if (!match[0]) {
      throw new NotFoundError('Match not found');
    }

    const matchData = match[0];

    await matchRepository.update(matchId, {
      status: 'completed',
      winner_id: winnerId,
      home_score: score.home,
      away_score: score.away,
      ended_at: new Date()
    });

    const [progression] = await db.query(
      `SELECT * FROM tournament_progression WHERE match_id = ?`,
      [matchId]
    );

    if (progression.length > 0) {
      await db.query(
        `UPDATE tournament_progression SET winner_id = ?, status = 'completed' WHERE id = ?`,
        [winnerId, progression[0].id]
      );

      await this.checkRoundCompletion(matchData.tournament_id, progression[0].round_number);
    }

    ws.emitToTournament(matchData.tournament_id, 'match:completed_with_progression', {
      matchId,
      winnerId,
      score,
      timestamp: new Date().toISOString()
    });

    logger.info('Match completed and progressed', { matchId, winnerId });

    return { success: true };
  }

  async checkRoundCompletion(tournamentId, roundNumber) {
    const [roundMatches] = await db.query(
      `SELECT * FROM tournament_progression WHERE tournament_id = ? AND round_number = ?`,
      [tournamentId, roundNumber]
    );

    const allCompleted = roundMatches.every(m => m.status === 'completed');

    if (!allCompleted) {
      return { allCompleted: false };
    }

    const nextRound = await db.query(
      `SELECT * FROM tournament_progression WHERE tournament_id = ? AND round_number = ?`,
      [tournamentId, roundNumber + 1]
    );

    if (nextRound.length === 0) {
      await this.completeTournament(tournamentId);
      return { tournamentCompleted: true, champion: roundMatches[0]?.winner_id };
    }

    return { allCompleted: true, canProgress: true };
  }

  async completeTournament(tournamentId) {
    const [final] = await db.query(
      `SELECT * FROM tournament_progression WHERE tournament_id = ? AND round_number = (SELECT MAX(round_number) FROM tournament_progression WHERE tournament_id = ?)`,
      [tournamentId, tournamentId]
    );

    const championId = final[0]?.winner_id;

    await db.query(
      `UPDATE tournaments SET status = 'completed' WHERE id = ?`,
      [tournamentId]
    );

    const [runnerUp] = await db.query(
      `SELECT winner_id FROM tournament_progression WHERE tournament_id = ? AND round_number = (SELECT MAX(round_number) - 1 FROM tournament_progression WHERE tournament_id = ? AND status = 'completed')`,
      [tournamentId, tournamentId]
    );

    ws.emitToTournament(tournamentId, 'tournament:completed', {
      tournamentId,
      championId,
      runnerUpId: runnerUp[0]?.winner_id,
      timestamp: new Date().toISOString()
    });

    logger.info('Tournament completed', { tournamentId, championId });

    return { championId, runnerUpId: runnerUp[0]?.winner_id };
  }

  async getProgression(tournamentId) {
    const [progression] = await db.query(
      `SELECT tp.*, t1.name as home_team_name, t2.name as away_team_name
       FROM tournament_progression tp
       LEFT JOIN teams t1 ON tp.home_team_id = t1.id
       LEFT JOIN teams t2 ON tp.away_team_id = t2.id
       WHERE tp.tournament_id = ?
       ORDER BY tp.round_number, tp.id`,
      [tournamentId]
    );

    const grouped = {};
    for (const p of progression) {
      if (!grouped[p.round_number]) {
        grouped[p.round_number] = {
          round_number: p.round_number,
          round_name: p.round_name,
          matches: []
        };
      }
      grouped[p.round_number].matches.push(p);
    }

    return Object.values(grouped);
  }

  async getFinalists(tournamentId) {
    const [final] = await db.query(
      `SELECT tp.*, t1.name as home_team_name, t2.name as away_team_name
       FROM tournament_progression tp
       LEFT JOIN teams t1 ON tp.home_team_id = t1.id
       LEFT JOIN teams t2 ON tp.away_team_id = t2.id
       WHERE tp.tournament_id = ? AND tp.round_number = (SELECT MAX(round_number) FROM tournament_progression WHERE tournament_id = ?)`,
      [tournamentId, tournamentId]
    );

    return final[0] || null;
  }

  async getChampion(tournamentId) {
    const [result] = await db.query(
      `SELECT winner_id FROM tournament_progression 
       WHERE tournament_id = ? AND round_number = (SELECT MAX(round_number) FROM tournament_progression WHERE tournament_id = ? AND status = 'completed')
       LIMIT 1`,
      [tournamentId, tournamentId]
    );

    return result[0]?.winner_id || null;
  }

  async assignTeamsToFirstRound(tournamentId, teamIds) {
    const [progression] = await db.query(
      `SELECT * FROM tournament_progression WHERE tournament_id = ? AND round_number = 1 ORDER BY id`,
      [tournamentId]
    );

    if (progression.length * 2 < teamIds.length) {
      throw new ValidationError('Not enough spots for all teams');
    }

    const shuffled = this.shuffleArray([...teamIds]);

    for (let i = 0; i < progression.length; i++) {
      const match = progression[i];
      const homeTeam = shuffled[i * 2];
      const awayTeam = shuffled[i * 2 + 1];

      await db.query(
        `UPDATE tournament_progression SET home_team_id = ?, away_team_id = ?, status = 'scheduled' WHERE id = ?`,
        [homeTeam, awayTeam, match.id]
      );
    }

    await db.query(
      `UPDATE tournament_progression SET status = 'in_progress' WHERE tournament_id = ? AND round_number = 1`,
      [tournamentId]
    );

    logger.info('Teams assigned to first round', { tournamentId, teamCount: teamIds.length });

    return await this.getProgression(tournamentId);
  }

  shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }
}

export default new TournamentProgressionService();