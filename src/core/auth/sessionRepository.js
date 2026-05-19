import db from '../../infrastructure/postgres/index.js';
import { generateUUID } from '../utils/index.js';

export class SessionRepository {
  async create(data) {
    const id = data.id || generateUUID();
    const sql = `
      INSERT INTO sessions (id, user_id, token_hash, refresh_token_hash, device_info, ip_address, user_agent, expires_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `;
    await db.query(sql, [
      id,
      data.user_id,
      data.token_hash,
      data.refresh_token_hash,
      data.device_info || null,
      data.ip_address || null,
      data.user_agent || null,
      data.expires_at
    ]);
    return this.findById(id);
  }

  async findById(id) {
    const sql = `SELECT * FROM sessions WHERE id = ? AND deleted_at IS NULL`;
    const rows = await db.query(sql, [id]);
    return rows[0] || null;
  }

  async findByToken(tokenHash) {
    const sql = `SELECT * FROM sessions WHERE token_hash = ? AND is_active = TRUE AND expires_at > NOW() AND deleted_at IS NULL`;
    const rows = await db.query(sql, [tokenHash]);
    return rows[0] || null;
  }

  async findByRefreshToken(refreshTokenHash) {
    const sql = `SELECT * FROM sessions WHERE refresh_token_hash = ? AND is_active = TRUE AND expires_at > NOW() AND deleted_at IS NULL`;
    const rows = await db.query(sql, [refreshTokenHash]);
    return rows[0] || null;
  }

  async findByUserId(userId) {
    const sql = `SELECT * FROM sessions WHERE user_id = ? AND is_active = TRUE AND expires_at > NOW() AND deleted_at IS NULL ORDER BY created_at DESC`;
    return db.query(sql, [userId]);
  }

  async update(id, data) {
    const updateFields = [];
    const params = [];

    if (data.token_hash !== undefined) {
      updateFields.push('token_hash = ?');
      params.push(data.token_hash);
    }
    if (data.refresh_token_hash !== undefined) {
      updateFields.push('refresh_token_hash = ?');
      params.push(data.refresh_token_hash);
    }
    if (data.expires_at !== undefined) {
      updateFields.push('expires_at = ?');
      params.push(data.expires_at);
    }
    if (data.is_active !== undefined) {
      updateFields.push('is_active = ?');
      params.push(data.is_active);
    }

    if (updateFields.length === 0) return this.findById(id);

    params.push(id);
    const sql = `UPDATE sessions SET ${updateFields.join(', ')}, updated_at = NOW() WHERE id = ?`;
    await db.query(sql, params);
    return this.findById(id);
  }

  async deactivateByToken(tokenHash) {
    const sql = `UPDATE sessions SET is_active = FALSE, updated_at = NOW() WHERE token_hash = ? AND is_active = TRUE`;
    const result = await db.query(sql, [tokenHash]);
    return result.rowCount > 0;
  }

  async deactivateAllUserSessions(userId) {
    const sql = `UPDATE sessions SET is_active = FALSE, updated_at = NOW() WHERE user_id = ? AND is_active = TRUE`;
    const result = await db.query(sql, [userId]);
    return result.rowCount > 0;
  }

  async cleanupExpired() {
    const sql = `UPDATE sessions SET is_active = FALSE, updated_at = NOW() WHERE expires_at < NOW() AND is_active = TRUE`;
    const result = await db.query(sql);
    return result.rowCount;
  }
}

export default new SessionRepository();