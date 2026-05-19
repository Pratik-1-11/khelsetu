import db from '../../infrastructure/postgres/index.js';
import { generateUUID } from '../utils/index.js';
import logger from '../logger/index.js';

export const auditMiddleware = async (req, res, next) => {
  const startTime = Date.now();
  const originalSend = res.send;

  res.send = function (data) {
    res.send = originalSend;

    const duration = Date.now() - startTime;

    if (res.statusCode >= 200 && res.statusCode < 400 && req.method !== 'GET') {
      logAudit(req, res, duration).catch(err => {
        logger.error('Audit log failed', { error: err.message });
      });
    }

    return res.send(data);
  };

  next();
};

const logAudit = async (req, res, duration) => {
  try {
    const userId = req.user?.userId || null;
    const organizationId = req.headers['x-organization-id'] || null;

    let entityType = null;
    let entityId = null;

    const pathParts = req.path.split('/').filter(p => p);
    if (pathParts.length >= 2) {
      entityType = pathParts[0];
      if (pathParts[1] && !pathParts[1].match(/^[0-9a-f-]{36}$/i)) {
        entityType = pathParts[0] + '_' + pathParts[1];
      } else if (pathParts.length >= 3) {
        entityId = pathParts[1];
      }
    }

    const id = generateUUID();
    const sql = `
      INSERT INTO audit_logs (id, organization_id, user_id, action, entity_type, entity_id, old_values, new_values, ip_address, user_agent, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
    `;

    await db.query(sql, [
      id,
      organizationId,
      userId,
      `${req.method} ${req.path}`,
      entityType,
      entityId,
      null,
      JSON.stringify(req.body || {}),
      req.ip || req.connection?.remoteAddress,
      req.get('user-agent'),
      JSON.stringify({ duration, status: res.statusCode })
    ]);

    logger.debug('Audit log created', { action: `${req.method} ${req.path}`, userId, entityType });
  } catch (error) {
    logger.error('Failed to create audit log', { error: error.message });
  }
};

export const createAuditLog = async (data) => {
  const id = data.id || generateUUID();
  const sql = `
    INSERT INTO audit_logs (id, organization_id, user_id, action, entity_type, entity_id, old_values, new_values, ip_address, user_agent, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
  `;

  await db.query(sql, [
    id,
    data.organization_id,
    data.user_id,
    data.action,
    data.entity_type,
    data.entity_id,
    data.old_values ? JSON.stringify(data.old_values) : null,
    data.new_values ? JSON.stringify(data.new_values) : null,
    data.ip_address,
    data.user_agent,
    JSON.stringify(data.metadata || {})
  ]);

  return { id, ...data };
};

export const getAuditLogs = async (options = {}) => {
  const { organizationId, userId, entityType, entityId, startDate, endDate, page = 1, limit = 50 } = options;
  const offset = (page - 1) * limit;

  let sql = `SELECT * FROM audit_logs WHERE 1=1`;
  const params = [];

  if (organizationId) {
    sql += ' AND organization_id = ?';
    params.push(organizationId);
  }

  if (userId) {
    sql += ' AND user_id = ?';
    params.push(userId);
  }

  if (entityType) {
    sql += ' AND entity_type = ?';
    params.push(entityType);
  }

  if (entityId) {
    sql += ' AND entity_id = ?';
    params.push(entityId);
  }

  if (startDate) {
    sql += ' AND created_at >= ?';
    params.push(startDate);
  }

  if (endDate) {
    sql += ' AND created_at <= ?';
    params.push(endDate);
  }

  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const rows = await db.query(sql, params);

  const countSql = `SELECT COUNT(*) as total FROM audit_logs WHERE 1=1`;
  const countParams = [];
  if (organizationId) {
    countSql += ' AND organization_id = ?';
    countParams.push(organizationId);
  }
  const countResult = await db.query(countSql, countParams);

  return {
    data: rows,
    pagination: { page, limit, total: countResult[0].total }
  };
};

export default auditMiddleware;