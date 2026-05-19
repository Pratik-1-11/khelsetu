import teamRepository from '../repositories/teamRepository.js';
import organizationRepository from '../../organizations/repositories/organizationRepository.js';
import { NotFoundError, ForbiddenError, ConflictError } from '../../../core/errors/index.js';
import logger from '../../../core/logger/index.js';
import { generateUUID } from '../../../core/utils/index.js';

function generateSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + generateUUID().substring(0, 8);
}

export class TeamService {
  async create(data, userId) {
    const isMember = await organizationRepository.isMember(userId, data.organization_id);
    if (!isMember) {
      throw new ForbiddenError('Access denied to this organization');
    }

    const team = await teamRepository.create({
      organization_id: data.organization_id,
      name: data.name,
      slug: data.slug || generateSlug(data.name),
      logo: data.logo,
      description: data.description,
      home_venue: data.home_venue,
      primary_color: data.primary_color,
      secondary_color: data.secondary_color,
      metadata: data.metadata || {},
      created_by: userId
    });

    logger.info('Team created', { teamId: team.id, name: team.name });
    return team;
  }

  async getById(id, userId) {
    const team = await teamRepository.findById(id);
    if (!team) {
      throw new NotFoundError('Team not found');
    }

    const isMember = await organizationRepository.isMember(userId, team.organization_id);
    if (!isMember) {
      throw new ForbiddenError('Access denied');
    }

    return team;
  }

  async getByOrganization(organizationId, userId, options = {}) {
    const isMember = await organizationRepository.isMember(userId, organizationId);
    if (!isMember) {
      throw new ForbiddenError('Access denied');
    }

    return teamRepository.findByOrganization(organizationId, options);
  }

  async update(id, userId, data) {
    const team = await this.getById(id, userId);

    const memberRole = await organizationRepository.getMemberRole(userId, team.organization_id);
    if (memberRole !== 'owner' && memberRole !== 'admin' && memberRole !== 'tournament_admin') {
      throw new ForbiddenError('Insufficient permissions');
    }

    return teamRepository.update(id, data);
  }

  async delete(id, userId) {
    const team = await this.getById(id, userId);

    const memberRole = await organizationRepository.getMemberRole(userId, team.organization_id);
    if (memberRole !== 'owner' && memberRole !== 'admin') {
      throw new ForbiddenError('Only admin can delete team');
    }

    return teamRepository.softDelete(id);
  }

  async getPlayers(teamId, userId) {
    const team = await this.getById(teamId, userId);
    return teamRepository.getPlayers(teamId);
  }
}

export default new TeamService();