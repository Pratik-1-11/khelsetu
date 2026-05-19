import tournamentRepository from '../repositories/tournamentRepository.js';
import sportRepository from '../repositories/sportRepository.js';
import organizationRepository from '../../organizations/repositories/organizationRepository.js';
import { NotFoundError, ForbiddenError, ValidationError, ConflictError } from '../../../core/errors/index.js';
import logger from '../../../core/logger/index.js';
import { generateUUID } from '../../../core/utils/index.js';

function generateSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + generateUUID().substring(0, 8);
}

export class TournamentService {
  async create(data, userId) {
    const isMember = await organizationRepository.isMember(userId, data.organization_id);
    if (!isMember) {
      throw new ForbiddenError('Access denied to this organization');
    }

    const sport = await sportRepository.findById(data.sport_id);
    if (!sport) {
      throw new NotFoundError('Sport not found');
    }

    const tournament = await tournamentRepository.create({
      organization_id: data.organization_id,
      sport_id: data.sport_id,
      name: data.name,
      slug: data.slug || generateSlug(data.name),
      description: data.description,
      format: data.format || 'league',
      status: data.status || 'draft',
      start_date: data.start_date,
      end_date: data.end_date,
      registration_deadline: data.registration_deadline,
      max_teams: data.max_teams,
      min_teams: data.min_teams,
      venue: data.venue,
      rules: data.rules || {},
      settings: data.settings || {},
      metadata: {},
      created_by: userId
    });

    logger.info('Tournament created', { tournamentId: tournament.id, name: tournament.name });
    return tournament;
  }

  async getById(id, userId) {
    const tournament = await tournamentRepository.findById(id);
    if (!tournament) {
      throw new NotFoundError('Tournament not found');
    }

    const isMember = await organizationRepository.isMember(userId, tournament.organization_id);
    if (!isMember) {
      throw new ForbiddenError('Access denied');
    }

    return tournament;
  }

  async getByOrganization(organizationId, userId, options = {}) {
    const isMember = await organizationRepository.isMember(userId, organizationId);
    if (!isMember) {
      throw new ForbiddenError('Access denied');
    }

    return tournamentRepository.findByOrganization(organizationId, options);
  }

  async update(id, userId, data) {
    const tournament = await this.getById(id, userId);

    const memberRole = await organizationRepository.getMemberRole(userId, tournament.organization_id);
    if (memberRole !== 'owner' && memberRole !== 'admin' && memberRole !== 'tournament_admin') {
      throw new ForbiddenError('Insufficient permissions');
    }

    if (data.slug) {
      const existing = await tournamentRepository.findBySlug(data.slug);
      if (existing && existing.id !== id) {
        throw new ConflictError('Tournament slug already exists');
      }
    }

    return tournamentRepository.update(id, data);
  }

  async delete(id, userId) {
    const tournament = await this.getById(id, userId);

    const memberRole = await organizationRepository.getMemberRole(userId, tournament.organization_id);
    if (memberRole !== 'owner' && memberRole !== 'admin') {
      throw new ForbiddenError('Only admin can delete tournament');
    }

    return tournamentRepository.softDelete(id);
  }

  async updateStatus(id, userId, status) {
    const tournament = await this.getById(id, userId);
    const validStatuses = ['draft', 'registration_open', 'in_progress', 'completed', 'cancelled'];

    if (!validStatuses.includes(status)) {
      throw new ValidationError('Invalid status');
    }

    const transitions = {
      draft: ['registration_open'],
      registration_open: ['in_progress', 'cancelled'],
      in_progress: ['completed', 'cancelled'],
      completed: [],
      cancelled: []
    };

    if (!transitions[tournament.status].includes(status)) {
      throw new ValidationError(`Cannot transition from ${tournament.status} to ${status}`);
    }

    return tournamentRepository.update(id, { status });
  }

  async registerTeam(tournamentId, teamId, userId, seedNumber = null) {
    const tournament = await this.getById(tournamentId, userId);

    if (tournament.status !== 'registration_open') {
      throw new ValidationError('Registration is not open');
    }

    if (tournament.max_teams) {
      const registeredTeams = await tournamentRepository.getRegisteredTeams(tournamentId);
      if (registeredTeams.length >= tournament.max_teams) {
        throw new ValidationError('Maximum number of teams reached');
      }
    }

    await tournamentRepository.addTeam(tournamentId, teamId, seedNumber);
    logger.info('Team registered', { tournamentId, teamId });

    return { success: true, message: 'Team registered successfully' };
  }

  async withdrawTeam(tournamentId, teamId, userId) {
    await this.getById(tournamentId, userId);
    return tournamentRepository.removeTeam(tournamentId, teamId);
  }

  async getRegisteredTeams(tournamentId, userId) {
    await this.getById(tournamentId, userId);
    return tournamentRepository.getRegisteredTeams(tournamentId);
  }
}

export default new TournamentService();