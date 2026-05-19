import { Pool } from 'pg';
import env from '../../core/env.js';
import logger from '../../core/logger/index.js';

let pool = null;

export const createPool = () => {
  if (pool) return pool;

  pool = new Pool({
    connectionString: env.database.url,
    ssl: env.nodeEnv === 'production' ? { rejectUnauthorized: false } : false,
    min: env.database.pool.min,
    max: env.database.pool.max,
    idleTimeoutMillis: env.database.pool.idleTimeout,
  });

  pool.on('error', (err) => {
    logger.error('Unexpected PostgreSQL pool error', { error: err.message });
  });

  logger.info(`PostgreSQL pool created: ${env.database.host}`);
  return pool;
};

export const getPool = () => {
  if (!pool) {
    throw new Error('Database pool not initialized. Call createPool() first.');
  }
  return pool;
};

const convertPlaceholders = (sql, params) => {
  let index = 0;
  const converted = sql.replace(/\?/g, () => `$${++index}`);
  return { sql: converted, params };
};

export const query = async (sql, params = []) => {
  const client = await getPool().connect();
  const start = Date.now();
  try {
    const { sql: convertedSql, params: convertedParams } = convertPlaceholders(sql, params);
    const result = await client.query(convertedSql, convertedParams);
    const duration = Date.now() - start;
    logger.debug(`Query executed in ${duration}ms`, { sql: convertedSql.substring(0, 100) });
    return result;
  } catch (error) {
    logger.error('Query error', { sql: sql.substring(0, 100), error: error.message });
    throw error;
  } finally {
    client.release();
  }
};

export const transaction = async (callback) => {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

export const getConnection = async () => {
  const client = await getPool().connect();
  return {
    query: async (sql, params = []) => {
      const { sql: convertedSql, params: convertedParams } = convertPlaceholders(sql, params);
      return client.query(convertedSql, convertedParams);
    },
    beginTransaction: async () => {
      await client.query('BEGIN');
    },
    commit: async () => {
      await client.query('COMMIT');
    },
    rollback: async () => {
      await client.query('ROLLBACK');
    },
    release: () => {
      client.release();
    },
  };
};

export const closePool = async () => {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info('PostgreSQL connection pool closed');
  }
};

export const healthCheck = async () => {
  try {
    await query('SELECT 1 as health');
    return { status: 'healthy', timestamp: new Date().toISOString() };
  } catch (error) {
    return { status: 'unhealthy', error: error.message };
  }
};

export default {
  createPool,
  getPool,
  getConnection,
  query,
  transaction,
  closePool,
  healthCheck,
};
