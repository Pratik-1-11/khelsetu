import db from '../../../infrastructure/postgres/index.js';
import { generateUUID } from '../../../core/utils/index.js';

export class DeviceRepository {
  async findById(id) {
    const sql = `SELECT * FROM devices WHERE id = ? AND deleted_at IS NULL`;
    const rows = await db.query(sql, [id]);
    return rows[0] || null;
  }

  async findByDeviceId(organizationId, deviceId) {
    const sql = `SELECT * FROM devices WHERE organization_id = ? AND device_id = ? AND deleted_at IS NULL`;
    const rows = await db.query(sql, [organizationId, deviceId]);
    return rows[0] || null;
  }

  async createOrUpdate(data) {
    const existing = await this.findByDeviceId(data.organization_id, data.device_id);

    if (existing) {
      const sql = `
        UPDATE devices SET
          device_name = ?, device_type = ?, os_version = ?, app_version = ?,
          last_seen_at = NOW(), updated_at = NOW()
        WHERE id = ?
      `;
      await db.query(sql, [
        data.device_name, data.device_type, data.os_version, data.app_version, existing.id
      ]);
      return this.findById(existing.id);
    }

    const id = data.id || generateUUID();
    const sql = `
      INSERT INTO devices (id, organization_id, user_id, device_id, device_name, device_type, os_version, app_version, last_seen_at, last_sync_at, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), TRUE, NOW(), NOW())
    `;
    await db.query(sql, [
      id, data.organization_id, data.user_id, data.device_id,
      data.device_name, data.device_type, data.os_version, data.app_version
    ]);
    return this.findById(id);
  }

  async updateLastSync(organizationId, deviceId) {
    const sql = `UPDATE devices SET last_sync_at = NOW() WHERE organization_id = ? AND device_id = ?`;
    await db.query(sql, [organizationId, deviceId]);
  }

  async deactivate(organizationId, deviceId) {
    const sql = `UPDATE devices SET is_active = FALSE, updated_at = NOW() WHERE organization_id = ? AND device_id = ?`;
    const result = await db.query(sql, [organizationId, deviceId]);
    return result.rowCount > 0;
  }

  async findByOrganization(organizationId, options = {}) {
    const { page = 1, limit = 20, includeInactive = false } = options;
    const offset = (page - 1) * limit;

    let sql = `SELECT * FROM devices WHERE organization_id = ? AND deleted_at IS NULL`;
    const params = [organizationId];

    if (!includeInactive) {
      sql += ` AND is_active = TRUE`;
    }

    sql += ` ORDER BY last_seen_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const rows = await db.query(sql, params);

    const countSql = `SELECT COUNT(*) as total FROM devices WHERE organization_id = ? AND deleted_at IS NULL`;
    const countResult = await db.query(countSql, [organizationId]);

    return {
      data: rows,
      pagination: { page, limit, total: countResult[0].total }
    };
  }
}

export default new DeviceRepository();