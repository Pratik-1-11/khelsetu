import db from '../../../infrastructure/postgres/index.js';
import { generateUUID } from '../../../core/utils/index.js';

export class OverlayTemplateRepository {
  async findById(id) {
    const sql = `SELECT * FROM overlay_templates WHERE id = ? AND deleted_at IS NULL`;
    const rows = await db.query(sql, [id]);
    return rows[0] || null;
  }

  async findByOrganization(organizationId) {
    const sql = `SELECT * FROM overlay_templates WHERE organization_id = ? AND deleted_at IS NULL ORDER BY name ASC`;
    return db.query(sql, [organizationId]);
  }

  async create(data) {
    const id = data.id || generateUUID();
    const sql = `
      INSERT INTO overlay_templates (id, organization_id, sport_id, name, template_config, is_default, metadata, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `;
    await db.query(sql, [
      id, data.organization_id, data.sport_id, data.name,
      JSON.stringify(data.template_config), data.is_default || false,
      JSON.stringify(data.metadata || {}), data.created_by
    ]);
    return this.findById(id);
  }

  async update(id, data) {
    const fields = [];
    const params = [];

    if (data.name) { fields.push('name = ?'); params.push(data.name); }
    if (data.template_config) { fields.push('template_config = ?'); params.push(JSON.stringify(data.template_config)); }
    if (data.is_default !== undefined) { fields.push('is_default = ?'); params.push(data.is_default); }

    if (fields.length === 0) return this.findById(id);

    params.push(id);
    const sql = `UPDATE overlay_templates SET ${fields.join(', ')}, updated_at = NOW() WHERE id = ?`;
    await db.query(sql, params);
    return this.findById(id);
  }

  async delete(id) {
    const sql = `UPDATE overlay_templates SET deleted_at = NOW() WHERE id = ?`;
    const result = await db.query(sql, [id]);
    return result.rowCount > 0;
  }
}

export class LiveOverlayRepository {
  async findById(id) {
    const sql = `SELECT * FROM live_overlays WHERE id = ? AND deleted_at IS NULL`;
    const rows = await db.query(sql, [id]);
    return rows[0] || null;
  }

  async findByMatch(matchId) {
    const sql = `SELECT * FROM live_overlays WHERE match_id = ? AND is_active = TRUE AND deleted_at IS NULL`;
    return db.query(sql, [matchId]);
  }

  async findByTournament(tournamentId) {
    const sql = `SELECT * FROM live_overlays WHERE tournament_id = ? AND is_active = TRUE AND deleted_at IS NULL`;
    return db.query(sql, [tournamentId]);
  }

  async create(data) {
    const id = data.id || generateUUID();
    const accessToken = generateUUID().replace(/-/g, '').substring(0, 32);

    const sql = `
      INSERT INTO live_overlays (id, organization_id, tournament_id, match_id, template_id, name, overlay_config, is_active, is_public, access_token, metadata, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `;
    await db.query(sql, [
      id, data.organization_id, data.tournament_id, data.match_id,
      data.template_id, data.name, JSON.stringify(data.overlay_config),
      data.is_active || false, data.is_public || false, accessToken,
      JSON.stringify(data.metadata || {}), data.created_by
    ]);
    return this.findById(id);
  }

  async update(id, data) {
    const fields = [];
    const params = [];

    if (data.name) { fields.push('name = ?'); params.push(data.name); }
    if (data.overlay_config) { fields.push('overlay_config = ?'); params.push(JSON.stringify(data.overlay_config)); }
    if (data.is_active !== undefined) { fields.push('is_active = ?'); params.push(data.is_active); }
    if (data.is_public !== undefined) { fields.push('is_public = ?'); params.push(data.is_public); }

    if (fields.length === 0) return this.findById(id);

    params.push(id);
    const sql = `UPDATE live_overlays SET ${fields.join(', ')}, updated_at = NOW() WHERE id = ?`;
    await db.query(sql, params);
    return this.findById(id);
  }

  async delete(id) {
    const sql = `UPDATE live_overlays SET deleted_at = NOW() WHERE id = ?`;
    const result = await db.query(sql, [id]);
    return result.rowCount > 0;
  }

  async validateAccessToken(token) {
    const sql = `SELECT * FROM live_overlays WHERE access_token = ? AND is_active = TRUE AND deleted_at IS NULL`;
    const rows = await db.query(sql, [token]);
    return rows[0] || null;
  }
}

export default { OverlayTemplateRepository, LiveOverlayRepository };