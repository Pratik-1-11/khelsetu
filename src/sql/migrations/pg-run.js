import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { Pool } from 'pg';
import env from '../../core/env.js';
import logger from '../../core/logger/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, 'pg');

const pool = new Pool({
  connectionString: env.database.url,
  ssl: env.nodeEnv === 'production' ? { rejectUnauthorized: false } : false,
});

function hashFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return createHash('sha256').update(content).digest('hex');
}

async function ensureMigrationsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(10) PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW(),
      hash VARCHAR(64) NOT NULL
    )
  `);
  logger.info('schema_migrations table ready');
}

async function getAppliedMigrations() {
  const result = await pool.query('SELECT version, hash FROM schema_migrations ORDER BY version');
  return result.rows;
}

async function runMigrations() {
  let client;
  try {
    client = await pool.connect();
    await ensureMigrationsTable();

    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    logger.info(`Found ${files.length} migration files in pg/`);

    const applied = await getAppliedMigrations();
    const appliedVersions = new Set(applied.map(m => m.version));

    // Check for hash mismatches on already-applied migrations
    for (const migration of applied) {
      const file = files.find(f => {
        const match = f.match(/^(\d+)/);
        return match && match[1].padStart(3, '0') === migration.version.padStart(3, '0');
      });
      if (file) {
        const currentHash = hashFile(path.join(migrationsDir, file));
        if (currentHash !== migration.hash) {
          logger.warn(`Hash mismatch for migration ${file}. File has been modified after application.`);
        }
      }
    }

    for (const file of files) {
      const versionMatch = file.match(/^(\d+)/);
      if (!versionMatch) continue;
      const version = versionMatch[1].replace(/^0+/, '') || '0';

      if (appliedVersions.has(version)) {
        logger.info(`Skipping migration ${file} (already applied)`);
        continue;
      }

      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf8');
      const hash = hashFile(filePath);

      logger.info(`Running migration: ${file}`);

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (version, hash) VALUES ($1, $2)',
          [version, hash]
        );
        await client.query('COMMIT');
        logger.info(`Completed: ${file}`);
      } catch (error) {
        await client.query('ROLLBACK');
        logger.error(`Migration failed: ${file}`, { error: error.message, stack: error.stack });
        throw error;
      }
    }

    logger.info('All migrations completed successfully');
  } catch (error) {
    logger.error('Migration process failed', { error: error.message, stack: error.stack });
    throw error;
  } finally {
    if (client) client.release();
    await pool.end();
  }
}

// Run if executed directly
const isDirectExecution = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectExecution) {
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
