import db from '../../../infrastructure/postgres/index.js';
import { generateUUID } from '../../../core/utils/index.js';

export class OrganizationRepository {
  async findById(id) {
    const sql = `SELECT * FROM organizations WHERE id = ? AND deleted_at IS NULL`;
    const rows = await db.query(sql, [id]);
    return rows[0] || null;
  }

  async findBySlug(slug) {
    const sql = `SELECT * FROM organizations WHERE slug = ? AND deleted_at IS NULL`;
    const rows = await db.query(sql, [slug]);
    return rows[0] || null;
  }

  async create(data) {
    const id = data.id || generateUUID();
    const sql = `
      INSERT INTO organizations (id, name, slug, logo, description, website, contact_email, contact_phone, address, settings, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `;
    await db.query(sql, [
      id,
      data.name,
      data.slug,
      data.logo || null,
      data.description || null,
      data.website || null,
      data.contact_email || null,
      data.contact_phone || null,
      data.address || null,
      JSON.stringify(data.settings || {}),
      JSON.stringify(data.metadata || {})
    ]);
    return this.findById(id);
  }

  async update(id, data) {
    const updateFields = [];
    const params = [];

    const allowedFields = ['name', 'slug', 'logo', 'description', 'website', 'contact_email', 'contact_phone', 'address', 'settings', 'metadata'];
    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        updateFields.push(`${field} = ?`);
        if (field === 'settings' || field === 'metadata') {
          params.push(JSON.stringify(data[field] || {}));
        } else {
          params.push(data[field]);
        }
      }
    }

    if (updateFields.length === 0) return this.findById(id);

    params.push(id);
    const sql = `UPDATE organizations SET ${updateFields.join(', ')}, updated_at = NOW() WHERE id = ? AND deleted_at IS NULL`;
    await db.query(sql, params);
    return this.findById(id);
  }

  async softDelete(id) {
    const sql = `UPDATE organizations SET deleted_at = NOW() WHERE id = ?`;
    const result = await db.query(sql, [id]);
    return result.rowCount > 0;
  }

  async findAll(options = {}) {
    const { page = 1, limit = 20, search } = options;
    const offset = (page - 1) * limit;

    let sql = `SELECT * FROM organizations WHERE deleted_at IS NULL`;
    const params = [];

    if (search) {
      sql += ` AND (name LIKE ? OR slug LIKE ?)`;
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm);
    }

    sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const rows = await db.query(sql, params);

    const countSql = `SELECT COUNT(*) as total FROM organizations WHERE deleted_at IS NULL`;
    const countResult = await db.query(countSql);
    const total = countResult[0].total;

    return {
      data: rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) }
    };
  }

  async isMember(userId, organizationId) {
    const sql = `
      SELECT 1 FROM organization_members
      WHERE user_id = ? AND organization_id = ? AND is_active = TRUE AND deleted_at IS NULL
    `;
    const rows = await db.query(sql, [userId, organizationId]);
    return rows.length > 0;
  }

  async getMemberRole(userId, organizationId) {
    const sql = `
      SELECT role FROM organization_members
      WHERE user_id = ? AND organization_id = ? AND is_active = TRUE AND deleted_at IS NULL
    `;
    const rows = await db.query(sql, [userId, organizationId]);
    return rows[0]?.role || null;
  }
}

export default new OrganizationRepository();