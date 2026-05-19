import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import env from '../../core/env.js';
import logger from '../../core/logger/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function getConnection() {
  return mysql.createConnection({
    host: env.mysql.host,
    port: env.mysql.port,
    user: env.mysql.user,
    password: env.mysql.password,
    database: env.mysql.database,
    charset: 'utf8mb4',
    multipleStatements: true
  });
}

async function runSeeds() {
  let connection;
  try {
    connection = await getConnection();

    const seedsDir = path.join(__dirname);
    const files = fs.readdirSync(seedsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    logger.info(`Found ${files.length} seed files`);

    for (const file of files) {
      const filePath = path.join(seedsDir, file);
      const sql = fs.readFileSync(filePath, 'utf8');

      logger.info(`Running seed: ${file}`);

      await connection.query(sql);
      logger.info(`Completed: ${file}`);
    }

    logger.info('All seeds completed successfully');
  } catch (error) {
    logger.error('Seed failed', { error: error.message, stack: error.stack });
    throw error;
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runSeeds()
    .then(() => {
      console.log('Seed process finished');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Seed process failed:', error);
      process.exit(1);
    });
}

export default runSeeds;