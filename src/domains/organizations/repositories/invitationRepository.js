import db from '../../../infrastructure/postgres/index.js';
import { generateUUID } from '../../../core/utils/index.js';

export class InvitationRepository {
  async findById(id) {
    const sql = `SELECT * FROM organization_invitations WHERE id = ? AND deleted_at IS NULL`;
    const rows = await db.query(sql, [id]);
    return rows[0] || null;
  }

  async findByToken(token) {
    const sql = `SELECT * FROM organization_invitations WHERE token = ? AND deleted_at IS NULL`;
    const rows = await db.query(sql, [token]);
    return rows[0] || null;
  }

  async findByEmailAndOrg(email, organizationId) {
    const sql = `SELECT * FROM organization_invitations WHERE email = ? AND organization_id = ? AND deleted_at IS NULL AND accepted_at IS NULL AND expires_at > NOW()`;
    const rows = await db.query(sql, [email.toLowerCase(), organizationId]);
    return rows[0] || null;
  }

  async create(data) {
    const id = data.id || generateUUID();
    const sql = `
      INSERT INTO organization_invitations (id, organization_id, email, role, token, expires_at, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `;
    await db.query(sql, [
      id,
      data.organization_id,
      data.email.toLowerCase(),
      data.role || 'member',
      data.token,
      data.expires_at,
      data.created_by
    ]);
    return this.findById(id);
  }

  async accept(id) {
    const sql = `UPDATE organization_invitations SET accepted_at = NOW(), updated_at = NOW() WHERE id = ? AND deleted_at IS NULL`;
    const result = await db.query(sql, [id]);
    return result.rowCount > 0;
  }

  async softDelete(id) {
    const sql = `UPDATE organization_invitations SET deleted_at = NOW() WHERE id = ?`;
    const result = await db.query(sql, [id]);
    return result.rowCount > 0;
  }

  async findByOrganization(organizationId) {
    const sql = `
      SELECT * FROM organization_invitations
      WHERE organization_id = ? AND deleted_at IS NULL AND accepted_at IS NULL
      ORDER BY created_at DESC
    `;
    return db.query(sql, [organizationId]);
  }

  async cleanupExpired() {
    const sql = `UPDATE organization_invitations SET deleted_at = NOW() WHERE expires_at < NOW() AND accepted_at IS NULL AND deleted_at IS NULL`;
    const result = await db.query(sql);
    return result.rowCount;
  }
}

export default new InvitationRepository();