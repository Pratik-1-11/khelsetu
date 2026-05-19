import db from '../../../infrastructure/postgres/index.js';
import { generateUUID } from '../../../core/utils/index.js';

export class SyncQueueRepository {
  async findById(id) {
    const sql = `SELECT * FROM sync_queue WHERE id = ?`;
    const rows = await db.query(sql, [id]);
    return rows[0] || null;
  }

  async findByClientEventId(clientEventId) {
    const sql = `SELECT * FROM sync_queue WHERE client_event_id = ?`;
    const rows = await db.query(sql, [clientEventId]);
    return rows[0] || null;
  }

  async findByIdempotencyKey(idempotencyKey) {
    const sql = `SELECT * FROM sync_queue WHERE idempotency_key = ? AND status = 'completed'`;
    const rows = await db.query(sql, [idempotencyKey]);
    return rows[0] || null;
  }

  async findPending(organizationId, deviceId, limit = 50) {
    const sql = `
      SELECT * FROM sync_queue
      WHERE organization_id = ? AND status IN ('pending', 'failed')
      AND (device_id = ? OR device_id IS NULL)
      ORDER BY created_at ASC
      LIMIT ?
    `;
    return db.query(sql, [organizationId, deviceId, limit]);
  }

  async create(data) {
    const id = data.id || generateUUID();
    const sql = `
      INSERT INTO sync_queue (id, organization_id, device_id, client_event_id, operation, entity_type, payload, idempotency_key, status, retry_count, max_retries, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `;
    await db.query(sql, [
      id, data.organization_id, data.device_id, data.client_event_id, data.operation,
      data.entity_type, JSON.stringify(data.payload), data.idempotency_key, 'pending',
      0, data.max_retries || 3
    ]);
    return this.findById(id);
  }

  async updateStatus(id, status, errorMessage = null) {
    const sql = `UPDATE sync_queue SET status = ?, error_message = ?, updated_at = NOW() WHERE id = ?`;
    await db.query(sql, [status, errorMessage, id]);
    return this.findById(id);
  }

  async markProcessing(id) {
    const sql = `UPDATE sync_queue SET status = 'processing', updated_at = NOW() WHERE id = ?`;
    await db.query(sql, [id]);
    return this.findById(id);
  }

  async markCompleted(id) {
    const sql = `UPDATE sync_queue SET status = 'completed', processed_at = NOW(), updated_at = NOW() WHERE id = ?`;
    await db.query(sql, [id]);
    return this.findById(id);
  }

  async markFailed(id, errorMessage) {
    const sql = `UPDATE sync_queue SET status = 'failed', error_message = ?, retry_count = retry_count + 1, updated_at = NOW() WHERE id = ?`;
    await db.query(sql, [errorMessage, id]);
    return this.findById(id);
  }

  async markConflict(id, errorMessage) {
    const sql = `UPDATE sync_queue SET status = 'conflict', error_message = ?, updated_at = NOW() WHERE id = ?`;
    await db.query(sql, [errorMessage, id]);
    return this.findById(id);
  }

  async delete(id) {
    const sql = `DELETE FROM sync_queue WHERE id = ?`;
    const result = await db.query(sql, [id]);
    return result.rowCount > 0;
  }

  async cleanup(olderThanDays = 7) {
    const sql = `DELETE FROM sync_queue WHERE status = 'completed' AND created_at < DATE_SUB(NOW(), INTERVAL ? DAY)`;
    const result = await db.query(sql, [olderThanDays]);
    return result.rowCount;
  }
}

export default new SyncQueueRepository();