import db from '../../../infrastructure/postgres/index.js';
import { NotFoundError, ForbiddenError } from '../../../core/errors/index.js';

class AuditService {
  async getAuditLogs(organizationId, userId, options = {}) {
    const { page = 1, limit = 20, start_date, end_date, user_id, action_type, entity_type } = options;
    const offset = (page - 1) * limit;

    const connection = await db.getConnection();
    try {
      const [orgCheck] = await connection.query(
        `SELECT id FROM organization_members 
         WHERE organization_id = ? AND user_id = ? AND is_active = TRUE`,
        [organizationId, userId]
      );
      if (!orgCheck.length) throw new ForbiddenError('Access denied to this organization');

      let whereClause = 'al.organization_id = ?';
      const params = [organizationId];

      if (start_date && end_date) {
        whereClause += ' AND al.created_at BETWEEN ? AND ?';
        params.push(start_date, end_date);
      }

      if (user_id) {
        whereClause += ' AND al.user_id = ?';
        params.push(user_id);
      }

      if (action_type) {
        whereClause += ' AND al.action_type = ?';
        params.push(action_type);
      }

      if (entity_type) {
        whereClause += ' AND al.entity_type = ?';
        params.push(entity_type);
      }

      const [logs] = await connection.query(
        `SELECT al.*, u.first_name, u.last_name, u.email
         FROM audit_logs al
         LEFT JOIN users u ON al.user_id = u.id
         WHERE ${whereClause}
         ORDER BY al.created_at DESC
         LIMIT ? OFFSET ?`,
        [...params, limit, offset]
      );

      const [[total]] = await connection.query(
        `SELECT COUNT(*) as count FROM audit_logs al WHERE ${whereClause}`,
        params
      );

      return {
        data: logs,
        pagination: { page, limit, total: total.count, pages: Math.ceil(total.count / limit) }
      };
    } finally {
      connection.release();
    }
  }

  async getEntityHistory(entityType, entityId, userId) {
    const connection = await db.getConnection();
    try {
      let orgId = null;

      switch (entityType) {
        case 'tournament':
          const [tournament] = await connection.query(
            `SELECT organization_id FROM tournaments WHERE id = ? AND deleted_at IS NULL`,
            [entityId]
          );
          if (tournament.length) orgId = tournament[0].organization_id;
          break;
        case 'team':
          const [team] = await connection.query(
            `SELECT organization_id FROM teams WHERE id = ? AND deleted_at IS NULL`,
            [entityId]
          );
          if (team.length) orgId = team[0].organization_id;
          break;
        case 'player':
          const [player] = await connection.query(
            `SELECT organization_id FROM players WHERE id = ? AND deleted_at IS NULL`,
            [entityId]
          );
          if (player.length) orgId = player[0].organization_id;
          break;
        case 'match':
          const [match] = await connection.query(
            `SELECT t.organization_id FROM matches m 
             JOIN tournaments t ON m.tournament_id = t.id 
             WHERE m.id = ? AND m.deleted_at IS NULL`,
            [entityId]
          );
          if (match.length) orgId = match[0].organization_id;
          break;
        case 'organization':
          orgId = entityId;
          break;
      }

      if (!orgId) throw new NotFoundError(`${entityType} not found`);

      const [orgCheck] = await connection.query(
        `SELECT id FROM organization_members 
         WHERE organization_id = ? AND user_id = ? AND is_active = TRUE`,
        [orgId, userId]
      );
      if (!orgCheck.length) throw new ForbiddenError('Access denied');

      const [history] = await connection.query(
        `SELECT al.*, u.first_name, u.last_name
         FROM audit_logs al
         LEFT JOIN users u ON al.user_id = u.id
         WHERE al.entity_type = ? AND al.entity_id = ?
         ORDER BY al.created_at DESC`,
        [entityType, entityId]
      );

      return history.map(h => ({
        id: h.id,
        action: h.action_type,
        entity_type: h.entity_type,
        entity_id: h.entity_id,
        user: h.first_name && h.last_name ? `${h.first_name} ${h.last_name}` : 'System',
        details: h.metadata,
        timestamp: h.created_at
      }));
    } finally {
      connection.release();
    }
  }

  async getUserActivity(targetUserId, requestingUserId, options = {}) {
    const { page = 1, limit = 20 } = options;
    const offset = (page - 1) * limit;

    const connection = await db.getConnection();
    try {
      const [activity] = await connection.query(
        `SELECT al.*, u.first_name, u.last_name
         FROM audit_logs al
         LEFT JOIN users u ON al.user_id = u.id
         WHERE al.user_id = ?
         ORDER BY al.created_at DESC
         LIMIT ? OFFSET ?`,
        [targetUserId, limit, offset]
      );

      const [[total]] = await connection.query(
        `SELECT COUNT(*) as count FROM audit_logs WHERE user_id = ?`,
        [targetUserId]
      );

      return {
        data: activity,
        pagination: { page, limit, total: total.count, pages: Math.ceil(total.count / limit) }
      };
    } finally {
      connection.release();
    }
  }
}

export default new AuditService();