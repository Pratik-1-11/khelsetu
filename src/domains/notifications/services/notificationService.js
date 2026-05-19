import notificationRepository from '../repositories/notificationRepository.js';
import logger from '../../../core/logger/index.js';
import ws from '../../../core/websocket/index.js';

export class NotificationService {
  async create(organizationId, userId, data) {
    const notification = await notificationRepository.create({
      organization_id: organizationId,
      user_id: userId,
      type: data.type,
      title: data.title,
      message: data.message,
      data: data.data || {}
    });

    ws.emitToUser(userId, 'notification:new', notification);

    logger.info('Notification created', { notificationId: notification.id, userId, type: data.type });

    return notification;
  }

  async createBulk(organizationId, userIds, data) {
    const notifications = [];

    for (const userId of userIds) {
      const notification = await this.create(organizationId, userId, data);
      notifications.push(notification);
    }

    return notifications;
  }

  async getUserNotifications(userId, options = {}) {
    return notificationRepository.findByUser(userId, options);
  }

  async markAsRead(notificationId, userId) {
    const notification = await notificationRepository.findById(notificationId);

    if (!notification) {
      throw new Error('Notification not found');
    }

    if (notification.user_id !== userId) {
      throw new Error('Access denied');
    }

    return notificationRepository.markAsRead(notificationId);
  }

  async markAllAsRead(userId) {
    return notificationRepository.markAllAsRead(userId);
  }

  async getUnreadCount(userId) {
    return notificationRepository.getUnreadCount(userId);
  }

  async delete(notificationId, userId) {
    const notification = await notificationRepository.findById(notificationId);

    if (!notification) {
      throw new Error('Notification not found');
    }

    if (notification.user_id !== userId) {
      throw new Error('Access denied');
    }

    return notificationRepository.delete(notificationId);
  }

  async notifyMatchUpdate(organizationId, matchId, tournamentId, homeTeam, awayTeam, score) {
    const title = `Match Update: ${homeTeam} vs ${awayTeam}`;
    const message = `Score: ${score.home} - ${score.away}`;
    const data = { match_id: matchId, tournament_id: tournamentId, score };

    const userIds = await this.getTournamentUserIds(tournamentId);

    return this.createBulk(organizationId, userIds, {
      type: 'match_update',
      title,
      message,
      data
    });
  }

  async notifyTournamentStart(organizationId, tournamentId, tournamentName) {
    return this.create(organizationId, null, {
      type: 'tournament_start',
      title: `Tournament Started: ${tournamentName}`,
      message: 'The tournament has begun! Check the matches for updates.',
      data: { tournament_id: tournamentId }
    });
  }

  async notifyMatchStarted(organizationId, matchId, homeTeam, awayTeam) {
    return this.create(organizationId, null, {
      type: 'match_live',
      title: `Match Live: ${homeTeam} vs ${awayTeam}`,
      message: 'The match has started! Follow the live score.',
      data: { match_id: matchId }
    });
  }

  async getTournamentUserIds(tournamentId) {
    return [];
  }
}

export default new NotificationService();