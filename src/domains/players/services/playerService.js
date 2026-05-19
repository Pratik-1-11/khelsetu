import playerRepository from '../repositories/playerRepository.js';
import teamRepository from '../../teams/repositories/teamRepository.js';
import organizationRepository from '../../organizations/repositories/organizationRepository.js';
import { NotFoundError, ForbiddenError, ConflictError } from '../../../core/errors/index.js';
import logger from '../../../core/logger/index.js';

export class PlayerService {
  async create(data, userId) {
    const isMember = await organizationRepository.isMember(userId, data.organization_id);
    if (!isMember) {
      throw new ForbiddenError('Access denied to this organization');
    }

    const player = await playerRepository.create({
      organization_id: data.organization_id,
      first_name: data.first_name,
      last_name: data.last_name,
      email: data.email,
      phone: data.phone,
      date_of_birth: data.date_of_birth,
      gender: data.gender,
      photo: data.photo,
      jersey_number: data.jersey_number,
      position: data.position,
      metadata: data.metadata || {},
      created_by: userId
    });

    logger.info('Player created', { playerId: player.id, name: `${player.first_name} ${player.last_name}` });
    return player;
  }

  async getById(id, userId) {
    const player = await playerRepository.findById(id);
    if (!player) {
      throw new NotFoundError('Player not found');
    }

    const isMember = await organizationRepository.isMember(userId, player.organization_id);
    if (!isMember) {
      throw new ForbiddenError('Access denied');
    }

    return player;
  }

  async getByOrganization(organizationId, userId, options = {}) {
    const isMember = await organizationRepository.isMember(userId, organizationId);
    if (!isMember) {
      throw new ForbiddenError('Access denied');
    }

    return playerRepository.findByOrganization(organizationId, options);
  }

  async update(id, userId, data) {
    const player = await this.getById(id, userId);

    const memberRole = await organizationRepository.getMemberRole(userId, player.organization_id);
    if (memberRole !== 'owner' && memberRole !== 'admin' && memberRole !== 'tournament_admin') {
      throw new ForbiddenError('Insufficient permissions');
    }

    return playerRepository.update(id, data);
  }

  async delete(id, userId) {
    const player = await this.getById(id, userId);

    const memberRole = await organizationRepository.getMemberRole(userId, player.organization_id);
    if (memberRole !== 'owner' && memberRole !== 'admin') {
      throw new ForbiddenError('Only admin can delete player');
    }

    return playerRepository.softDelete(id);
  }

  async addToTeam(playerId, teamId, userId, role = 'player') {
    const player = await this.getById(playerId, userId);
    const team = await teamRepository.findById(teamId);

    if (!team) {
      throw new NotFoundError('Team not found');
    }

    if (team.organization_id !== player.organization_id) {
      throw new ConflictError('Player and team must be in the same organization');
    }

    return playerRepository.addToTeam(playerId, teamId, role);
  }

  async removeFromTeam(playerId, teamId, userId) {
    await this.getById(playerId, userId);
    return playerRepository.removeFromTeam(playerId, teamId);
  }

  async getPlayerTeams(playerId, userId) {
    await this.getById(playerId, userId);
    return playerRepository.getTeams(playerId);
  }
}

export default new PlayerService();