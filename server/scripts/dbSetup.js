/**
 * Applies db/schema.sql.
 *
 * Reads DATABASE_URL directly rather than going through the app's env config: setting up
 * a database should not require JWT secrets or an AI key to be present.
 *
 *   npm run db:setup            apply the schema
 *   npm run db:reset            drop every app object first, then apply
 */

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import 'dotenv/config';
import { Client } from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');

const shouldReset = process.argv.includes('--reset');

/** Dropped in dependency order; CASCADE covers the indexes and triggers. */
const APP_TABLES = [
  'ai_interaction_logs',
  'refresh_tokens',
  'appointments',
  'chat_messages',
  'chat_sessions',
  'providers',
  'users',
  'businesses',
];

const main = async () => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error(
      'DATABASE_URL is not set.\nCopy server/.env.example to server/.env and set it, then re-run.',
    );
    process.exit(1);
  }

  const client = new Client({
    connectionString,
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  });

  try {
    await client.connect();
  } catch (error) {
    console.error(`Could not connect to the database: ${error.message}`);
    console.error('Check that PostgreSQL is running and DATABASE_URL points at it.');
    process.exit(1);
  }

  try {
    const { rows } = await client.query('SELECT version()');
    console.log(`connected — ${rows[0]?.version.split(',')[0] ?? 'unknown version'}`);

    if (shouldReset) {
      console.log('resetting: dropping existing application tables');
      await client.query(`DROP TABLE IF EXISTS ${APP_TABLES.join(', ')} CASCADE`);
      await client.query('DROP FUNCTION IF EXISTS set_updated_at() CASCADE');
    }

    const schemaPath = resolve(repoRoot, 'db/schema.sql');
    const schema = await readFile(schemaPath, 'utf8');

    console.log('applying db/schema.sql');
    // schema.sql wraps itself in BEGIN/COMMIT, so it is sent as one statement batch.
    await client.query(schema);

    const { rows: tables } = await client.query(
      `SELECT count(*)::text AS count
         FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    );
    const { rows: excl } = await client.query(
      `SELECT conname FROM pg_constraint WHERE contype = 'x' ORDER BY conname`,
    );

    console.log(`done — ${tables[0]?.count ?? '0'} tables`);
    console.log(`exclusion constraints: ${excl.map((r) => r.conname).join(', ') || 'none'}`);

    if (excl.length < 2) {
      console.error('Expected 2 exclusion constraints — the double-booking guard is missing.');
      process.exit(1);
    }
  } catch (error) {
    console.error(`Schema failed to apply: ${error.message}`);
    process.exit(1);
  } finally {
    await client.end();
  }
};

await main();
