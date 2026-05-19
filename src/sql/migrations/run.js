import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import env from '../../core/env.js';
import logger from '../../core/logger/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const migrationsDir = path.join(__dirname);

async function getConnection() {
  return mysql.createConnection({
    host: env.mysql.host,
    port: env.mysql.port,
    user: env.mysql.user,
    password: env.mysql.password,
    charset: 'utf8mb4',
    multipleStatements: false
  });
}

async function createDatabase(connection) {
  try {
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${env.mysql.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    logger.info(`Database '${env.mysql.database}' created or already exists`);
  } catch (error) {
    logger.error('Failed to create database', { error: error.message });
    throw error;
  }
}

async function runMigrations() {
  let connection;
  try {
    connection = await getConnection();
    await createDatabase(connection);

    await connection.end();

    connection = await mysql.createConnection({
      host: env.mysql.host,
      port: env.mysql.port,
      user: env.mysql.user,
      password: env.mysql.password,
      database: env.mysql.database,
      charset: 'utf8mb4',
      multipleStatements: true
    });

    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    logger.info(`Found ${files.length} migration files`);

    for (const file of files) {
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf8');

      logger.info(`Running migration: ${file}`);

      await connection.query(sql);
      logger.info(`Completed: ${file}`);
    }

    logger.info('All migrations completed successfully');
  } catch (error) {
    logger.error('Migration failed', { error: error.message, stack: error.stack });
    throw error;
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMigrations()
    .then(() => {
      console.log('Migration process finished');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration process failed:', error);
      process.exit(1);
    });
}

export default runMigrations;