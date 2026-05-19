import syncQueueRepository from '../repositories/syncQueueRepository.js';
import deviceRepository from '../repositories/deviceRepository.js';
import { ValidationError, ConflictError } from '../../../core/errors/index.js';
import logger from '../../../core/logger/index.js';
import scoringService from '../../scoring/services/scoringService.js';

export class SyncService {
  async queueOperation(organizationId, userId, data) {
    const { device_id, client_event_id, operation, entity_type, payload, idempotency_key } = data;

    if (idempotency_key) {
      const existing = await syncQueueRepository.findByIdempotencyKey(idempotency_key);
      if (existing) {
        logger.info('Idempotent operation already processed', { idempotencyKey: idempotency_key });
        return { success: true, existing: true, syncItem: existing };
      }
    }

    if (client_event_id) {
      const existingEvent = await syncQueueRepository.findByClientEventId(client_event_id);
      if (existingEvent) {
        if (existingEvent.status === 'completed') {
          return { success: true, duplicate: true, syncItem: existingEvent };
        }
        if (existingEvent.status === 'processing') {
          throw new ConflictError('Operation already in progress');
        }
      }
    }

    const syncItem = await syncQueueRepository.create({
      organization_id: organizationId,
      device_id,
      client_event_id: client_event_id || `evt_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      operation,
      entity_type,
      payload,
      idempotency_key,
      max_retries: 3
    });

    logger.info('Operation queued for sync', { syncId: syncItem.id, entityType: entity_type });
    return { success: true, syncItem };
  }

  async processQueue(organizationId, deviceId) {
    const pendingItems = await syncQueueRepository.findPending(organizationId, deviceId, 50);
    const results = [];

    for (const item of pendingItems) {
      const result = await this.processItem(item);
      results.push(result);
    }

    return { processed: results.filter(r => r.success).length, failed: results.filter(r => !r.success).length, results };
  }

  async processItem(item) {
    try {
      await syncQueueRepository.markProcessing(item.id);

      const processed = await this.executeOperation(item);

      await syncQueueRepository.markCompleted(item.id);

      logger.info('Sync item processed', { syncId: item.id, entityType: item.entity_type });
      return { success: true, syncId: item.id };
    } catch (error) {
      logger.error('Sync item failed', { syncId: item.id, error: error.message });

      if (error instanceof ConflictError) {
        await syncQueueRepository.markConflict(item.id, error.message);
        return { success: false, conflict: true, syncId: item.id, error: error.message };
      }

      if (item.retry_count >= item.max_retries) {
        await syncQueueRepository.markFailed(item.id, error.message);
      } else {
        await syncQueueRepository.updateStatus(item.id, 'pending', error.message);
      }

      return { success: false, syncId: item.id, error: error.message };
    }
  }

  async executeOperation(item) {
    const payload = typeof item.payload === 'string' ? JSON.parse(item.payload) : item.payload;

    switch (item.entity_type) {
      case 'scoring_event':
        return this.handleScoringEvent(item.operation, payload);

      case 'match':
        return this.handleMatchUpdate(item.operation, payload);

      case 'player':
        return this.handlePlayerUpdate(item.operation, payload);

      case 'team':
        return this.handleTeamUpdate(item.operation, payload);

      default:
        throw new Error(`Unknown entity type: ${item.entity_type}`);
    }
  }

  async handleScoringEvent(operation, payload) {
    if (operation === 'create') {
      const validation = await scoringService.validateIdempotency(payload.client_event_id);
      if (!validation.isValid) {
        throw new ConflictError('Duplicate scoring event');
      }

      await scoringService.addEvent(payload.match_id, payload.created_by, {
        event_type: payload.event_type,
        team_id: payload.team_id,
        player_id: payload.player_id,
        minute: payload.minute,
        client_event_id: payload.client_event_id,
        metadata: payload.metadata
      });
    }

    if (operation === 'undo') {
      await scoringService.undoEvent(payload.event_id, payload.created_by);
    }

    return { success: true };
  }

  async handleMatchUpdate(operation, payload) {
    return { success: true, message: 'Match update processed' };
  }

  async handlePlayerUpdate(operation, payload) {
    return { success: true, message: 'Player update processed' };
  }

  async handleTeamUpdate(operation, payload) {
    return { success: true, message: 'Team update processed' };
  }

  async resolveConflict(syncItemId, resolution) {
    const syncItem = await syncQueueRepository.findById(syncItemId);
    if (!syncItem) {
      throw new Error('Sync item not found');
    }

    if (resolution === 'accept_server') {
      await syncQueueRepository.markCompleted(syncItemId);
      return { success: true, message: 'Server version accepted' };
    }

    if (resolution === 'accept_client') {
      await syncQueueRepository.updateStatus(syncItemId, 'pending');
      const result = await this.processItem(syncItem);
      return result;
    }

    if (resolution === 'discard') {
      await syncQueueRepository.delete(syncItemId);
      return { success: true, message: 'Client version discarded' };
    }

    throw new Error('Invalid resolution option');
  }

  async getSyncStatus(organizationId, deviceId) {
    const pending = await syncQueueRepository.findPending(organizationId, deviceId, 100);

    return {
      pending: pending.length,
      items: pending.map(p => ({
        id: p.id,
        entity_type: p.entity_type,
        operation: p.operation,
        created_at: p.created_at,
        retry_count: p.retry_count
      }))
    };
  }

  async registerDevice(organizationId, userId, data) {
    return deviceRepository.createOrUpdate({
      organization_id: organizationId,
      user_id: userId,
      device_id: data.device_id,
      device_name: data.device_name,
      device_type: data.device_type,
      os_version: data.os_version,
      app_version: data.app_version
    });
  }

  async getDeviceInfo(organizationId, deviceId) {
    return deviceRepository.findByDeviceId(organizationId, deviceId);
  }
}

export default new SyncService();