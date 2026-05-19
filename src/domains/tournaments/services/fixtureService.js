import db from '../../../infrastructure/postgres/index.js';
import { generateUUID } from '../../../core/utils/index.js';
import logger from '../../../core/logger/index.js';

export class FixtureService {
  generateLeagueFixtures(teams, groups = null) {
    const fixtures = [];
    const numTeams = teams.length;

    if (numTeams < 2) {
      throw new Error('Need at least 2 teams to generate fixtures');
    }

    const teamList = [...teams];
    const rounds = numTeams % 2 === 0 ? numTeams - 1 : numTeams;
    const matchesPerRound = Math.floor(numTeams / 2);

    for (let round = 1; round <= rounds; round++) {
      const roundFixtures = [];

      for (let match = 0; match < matchesPerRound; match++) {
        const homeIndex = (round - 1 + match) % (numTeams - 1);
        let awayIndex = (numTeams - 1 - match + round - 1) % (numTeams - 1);

        if (round % 2 === 1) {
          awayIndex = numTeams - 1 - awayIndex;
        }

        if (homeIndex === numTeams - 1 || awayIndex === numTeams - 1) continue;

        const group = groups ? groups[match % groups.length] : null;

        roundFixtures.push({
          home_team_id: teamList[homeIndex].team_id,
          away_team_id: teamList[awayIndex].team_id,
          home_position: homeIndex + 1,
          away_position: awayIndex + 1,
          round_number: round,
          group_name: group,
          status: 'pending'
        });
      }

      if (round % 2 === 1 && numTeams % 2 === 1) {
        const byeTeam = teamList[numTeams - 1];
        const teamIndex = (round - 1) % (numTeams - 1);
        roundFixtures.push({
          home_team_id: teamList[teamIndex].team_id,
          away_team_id: byeTeam.team_id,
          home_position: teamIndex + 1,
          away_position: numTeams,
          round_number: round,
          group_name: null,
          status: 'bye'
        });
      }

      fixtures.push(...roundFixtures);
    }

    return fixtures;
  }

  generateKnockoutFixtures(teams) {
    const numTeams = teams.length;
    const rounds = Math.ceil(Math.log2(numTeams));
    const bracketSize = Math.pow(2, rounds);
    const byes = bracketSize - numTeams;

    const fixtures = [];
    let matchNumber = 1;

    for (let round = 1; round <= rounds; round++) {
      const matchesInRound = bracketSize / Math.pow(2, round);

      for (let match = 0; match < matchesInRound; match++) {
        const seedPosition = match * 2;
        if (seedPosition >= numTeams) break;

        const fixture = {
          round_number: round,
          match_number: matchNumber++,
          group_name: null,
          status: 'pending'
        };

        if (round === 1) {
          if (match < byes) {
            fixture.home_team_id = teams[seedPosition].team_id;
            fixture.away_team_id = null;
            fixture.status = 'bye';
            fixture.home_position = seedPosition + 1;
            fixture.away_position = seedPosition + 2;
          } else {
            const awayPos = seedPosition + 1;
            fixture.home_team_id = teams[seedPosition].team_id;
            fixture.away_team_id = awayPos < numTeams ? teams[awayPos].team_id : null;
            fixture.home_position = seedPosition + 1;
            fixture.away_position = seedPosition + 2;
          }
        } else {
          fixture.home_team_id = null;
          fixture.away_team_id = null;
          fixture.home_position = match * 2 + 1;
          fixture.away_position = match * 2 + 2;
        }

        fixtures.push(fixture);
      }
    }

    return fixtures;
  }

  async saveFixtures(tournamentId, fixtures) {
    const createdFixtures = [];

    for (const fixture of fixtures) {
      const id = generateUUID();
      const sql = `
        INSERT INTO fixtures (id, tournament_id, round_number, home_team_id, away_team_id, home_position, away_position, group_name, status, metadata, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
      `;
      await db.query(sql, [
        id, tournamentId, fixture.round_number, fixture.home_team_id, fixture.away_team_id,
        fixture.home_position, fixture.away_position, fixture.group_name, fixture.status,
        JSON.stringify(fixture.metadata || {})
      ]);
      createdFixtures.push({ id, ...fixture });
    }

    logger.info('Fixtures generated', { tournamentId, count: createdFixtures.length });
    return createdFixtures;
  }

  async getFixturesByTournament(tournamentId) {
    const sql = `
      SELECT f.*, ht.name as home_team_name, at.name as away_team_name
      FROM fixtures f
      LEFT JOIN teams ht ON f.home_team_id = ht.id
      LEFT JOIN teams at ON f.away_team_id = at.id
      WHERE f.tournament_id = ? AND f.deleted_at IS NULL
      ORDER BY f.round_number, f.home_position
    `;
    return db.query(sql, [tournamentId]);
  }

  async updateFixture(fixtureId, data) {
    const updateFields = [];
    const params = [];

    if (data.home_team_id !== undefined) {
      updateFields.push('home_team_id = ?');
      params.push(data.home_team_id);
    }
    if (data.away_team_id !== undefined) {
      updateFields.push('away_team_id = ?');
      params.push(data.away_team_id);
    }
    if (data.status !== undefined) {
      updateFields.push('status = ?');
      params.push(data.status);
    }
    if (data.match_id !== undefined) {
      updateFields.push('match_id = ?');
      params.push(data.match_id);
    }

    if (updateFields.length === 0) return null;

    params.push(fixtureId);
    const sql = `UPDATE fixtures SET ${updateFields.join(', ')}, updated_at = NOW() WHERE id = ?`;
    await db.query(sql, params);

    const getSql = `SELECT * FROM fixtures WHERE id = ?`;
    const rows = await db.query(getSql, [fixtureId]);
    return rows[0];
  }

  async generateAndSaveFixtures(tournamentId, teams, format = 'league', groups = null) {
    let fixtures;

    if (format === 'league') {
      fixtures = this.generateLeagueFixtures(teams, groups);
    } else if (format === 'knockout' || format === 'single_elimination') {
      fixtures = this.generateKnockoutFixtures(teams);
    } else {
      throw new Error(`Unsupported tournament format: ${format}`);
    }

    return this.saveFixtures(tournamentId, fixtures);
  }
}

export default new FixtureService();