import db from '../../../infrastructure/postgres/index.js';
import { generateUUID } from '../../../core/utils/index.js';

export class FormationRepository {
  async findById(id) {
    const sql = `SELECT * FROM formations WHERE id = ? AND deleted_at IS NULL`;
    const rows = await db.query(sql, [id]);
    return rows[0] || null;
  }

  async findByMatch(matchId, teamId) {
    const sql = `SELECT * FROM formations WHERE match_id = ? AND team_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`;
    const rows = await db.query(sql, [matchId, teamId]);
    return rows[0] || null;
  }

  async findByTeam(teamId) {
    const sql = `SELECT * FROM formations WHERE team_id = ? AND deleted_at IS NULL ORDER BY created_at DESC`;
    return db.query(sql, [teamId]);
  }

  async create(data) {
    const id = data.id || generateUUID();
    const sql = `
      INSERT INTO formations (id, organization_id, match_id, team_id, formation_name, positions, metadata, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `;
    await db.query(sql, [
      id, data.organization_id, data.match_id, data.team_id, data.formation_name,
      JSON.stringify(data.positions), JSON.stringify(data.metadata || {}), data.created_by
    ]);
    return this.findById(id);
  }

  async update(id, data) {
    const fields = [];
    const params = [];

    if (data.formation_name) { fields.push('formation_name = ?'); params.push(data.formation_name); }
    if (data.positions) { fields.push('positions = ?'); params.push(JSON.stringify(data.positions)); }

    if (fields.length === 0) return this.findById(id);
    params.push(id);

    const sql = `UPDATE formations SET ${fields.join(', ')}, updated_at = NOW() WHERE id = ?`;
    await db.query(sql, params);
    return this.findById(id);
  }

  async delete(id) {
    const sql = `UPDATE formations SET deleted_at = NOW() WHERE id = ?`;
    const result = await db.query(sql, [id]);
    return result.rowCount > 0;
  }
}

export class TacticalAnnotationRepository {
  async findById(id) {
    const sql = `SELECT * FROM tactical_annotations WHERE id = ? AND deleted_at IS NULL`;
    const rows = await db.query(sql, [id]);
    return rows[0] || null;
  }

  async findByMatch(matchId) {
    const sql = `SELECT * FROM tactical_annotations WHERE match_id = ? AND deleted_at IS NULL ORDER BY created_at ASC`;
    return db.query(sql, [matchId]);
  }

  async create(data) {
    const id = data.id || generateUUID();
    const sql = `
      INSERT INTO tactical_annotations (id, organization_id, match_id, team_id, player_id, annotation_type, coordinates, description, metadata, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `;
    await db.query(sql, [
      id, data.organization_id, data.match_id, data.team_id, data.player_id,
      data.annotation_type, JSON.stringify(data.coordinates), data.description,
      JSON.stringify(data.metadata || {}), data.created_by
    ]);
    return this.findById(id);
  }

  async delete(id) {
    const sql = `UPDATE tactical_annotations SET deleted_at = NOW() WHERE id = ?`;
    const result = await db.query(sql, [id]);
    return result.rowCount > 0;
  }
}

export default { FormationRepository, TacticalAnnotationRepository };