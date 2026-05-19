import db from '../../../infrastructure/postgres/index.js';
import { generateUUID } from '../../../core/utils/index.js';

export class NotificationRepository {
  async findById(id) {
    const sql = `SELECT * FROM notifications WHERE id = ?`;
    const rows = await db.query(sql, [id]);
    return rows[0] || null;
  }

  async findByUser(userId, options = {}) {
    const { page = 1, limit = 20, unreadOnly = false } = options;
    const offset = (page - 1) * limit;

    let sql = `SELECT * FROM notifications WHERE user_id = ? AND deleted_at IS NULL`;
    const params = [userId];

    if (unreadOnly) {
      sql += ' AND is_read = FALSE';
    }

    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rows = await db.query(sql, params);

    const countSql = `SELECT COUNT(*) as total FROM notifications WHERE user_id = ? AND deleted_at IS NULL${unreadOnly ? ' AND is_read = FALSE' : ''}`;
    const countResult = await db.query(countSql, [userId]);

    return {
      data: rows,
      pagination: { page, limit, total: countResult[0].total }
    };
  }

  async create(data) {
    const id = data.id || generateUUID();
    const sql = `
      INSERT INTO notifications (id, organization_id, user_id, type, title, message, data, is_read, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `;
    await db.query(sql, [
      id, data.organization_id, data.user_id, data.type, data.title, data.message,
      JSON.stringify(data.data || {}), data.is_read || false
    ]);
    return this.findById(id);
  }

  async markAsRead(id) {
    const sql = `UPDATE notifications SET is_read = TRUE, read_at = NOW(), updated_at = NOW() WHERE id = ?`;
    await db.query(sql, [id]);
    return this.findById(id);
  }

  async markAllAsRead(userId) {
    const sql = `UPDATE notifications SET is_read = TRUE, read_at = NOW(), updated_at = NOW() WHERE user_id = ? AND is_read = FALSE`;
    const result = await db.query(sql, [userId]);
    return result.rowCount;
  }

  async delete(id) {
    const sql = `UPDATE notifications SET deleted_at = NOW() WHERE id = ?`;
    const result = await db.query(sql, [id]);
    return result.rowCount > 0;
  }

  async getUnreadCount(userId) {
    const sql = `SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = FALSE AND deleted_at IS NULL`;
    const rows = await db.query(sql, [userId]);
    return rows[0].count;
  }
}

export default new NotificationRepository();