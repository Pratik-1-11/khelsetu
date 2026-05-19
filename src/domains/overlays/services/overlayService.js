import { OverlayTemplateRepository, LiveOverlayRepository } from '../repositories/overlayRepository.js';
import organizationRepository from '../../organizations/repositories/organizationRepository.js';
import { NotFoundError, ForbiddenError } from '../../../core/errors/index.js';
import logger from '../../../core/logger/index.js';
import ws from '../../../core/websocket/index.js';

const templateRepo = new OverlayTemplateRepository();
const liveRepo = new LiveOverlayRepository();

export class OverlayService {
  async createTemplate(data, userId) {
    const isMember = await organizationRepository.isMember(userId, data.organization_id);
    if (!isMember) throw new ForbiddenError('Access denied');

    const template = await templateRepo.create({
      organization_id: data.organization_id,
      sport_id: data.sport_id,
      name: data.name,
      template_config: data.template_config,
      is_default: data.is_default,
      metadata: {},
      created_by: userId
    });

    logger.info('Overlay template created', { templateId: template.id });
    return template;
  }

  async getTemplates(organizationId, userId) {
    const isMember = await organizationRepository.isMember(userId, organizationId);
    if (!isMember) throw new ForbiddenError('Access denied');
    return templateRepo.findByOrganization(organizationId);
  }

  async getTemplate(templateId, userId) {
    const template = await templateRepo.findById(templateId);
    if (!template) throw new NotFoundError('Template not found');
    return template;
  }

  async createLiveOverlay(data, userId) {
    const isMember = await organizationRepository.isMember(userId, data.organization_id);
    if (!isMember) throw new ForbiddenError('Access denied');

    const template = await templateRepo.findById(data.template_id);
    if (!template) throw new NotFoundError('Template not found');

    const overlay = await liveRepo.create({
      organization_id: data.organization_id,
      tournament_id: data.tournament_id,
      match_id: data.match_id,
      template_id: data.template_id,
      name: data.name,
      overlay_config: data.overlay_config || template.template_config,
      is_active: false,
      is_public: data.is_public || false,
      metadata: {},
      created_by: userId
    });

    logger.info('Live overlay created', { overlayId: overlay.id });
    return overlay;
  }

  async getLiveOverlays(tournamentId, matchId, userId) {
    if (matchId) {
      return liveRepo.findByMatch(matchId);
    }
    if (tournamentId) {
      return liveRepo.findByTournament(tournamentId);
    }
    return [];
  }

  async activateOverlay(overlayId, userId) {
    const overlay = await liveRepo.findById(overlayId);
    if (!overlay) throw new NotFoundError('Overlay not found');

    const updated = await liveRepo.update(overlayId, { is_active: true });

    if (overlay.match_id) {
      ws.emitToMatch(overlay.match_id, 'overlay:activated', { overlayId, name: overlay.name });
    }

    return updated;
  }

  async deactivateOverlay(overlayId, userId) {
    const overlay = await liveRepo.findById(overlayId);
    if (!overlay) throw new NotFoundError('Overlay not found');

    const updated = await liveRepo.update(overlayId, { is_active: false });

    if (overlay.match_id) {
      ws.emitToMatch(overlay.match_id, 'overlay:deactivated', { overlayId });
    }

    return updated;
  }

  async getPublicOverlay(token) {
    const overlay = await liveRepo.validateAccessToken(token);
    if (!overlay) throw new ForbiddenError('Invalid or inactive overlay');
    return overlay;
  }

  async updateOverlayConfig(overlayId, config, userId) {
    const overlay = await liveRepo.findById(overlayId);
    if (!overlay) throw new NotFoundError('Overlay not found');

    return liveRepo.update(overlayId, { overlay_config: config });
  }
}

export default new OverlayService();