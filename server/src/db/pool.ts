/**
 * The connection pool and the query surface every repository uses.
 *
 * Repositories accept an `Executor` — either the pool or an active transaction client —
 * as their first argument. That single convention is what lets a service compose several
 * repository calls into one atomic unit without repositories knowing transactions exist.
 */

import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

import { env } from '../config/env.ts';
import { dbLogger } from '../logger/index.ts';

/**
 * Anything that can run a query: the pool (autocommit, one connection per call) or a
 * checked-out client inside a transaction.
 */
export interface Executor {
  query<R extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<R>>;
}

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
  max: env.DATABASE_POOL_MAX,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  // Stops one pathological query from pinning a connection indefinitely.
  statement_timeout: 15_000,
  query_timeout: 15_000,
  application_name: 'nudge-ai-api',
});

// An idle client erroring (network drop, server restart) is emitted on the pool. Without a
// listener, Node treats it as an unhandled 'error' event and kills the process.
pool.on('error', (error) => {
  dbLogger.error({ err: error }, 'idle client error');
});

/** Queries slower than this are logged so they are visible without a profiler. */
const SLOW_QUERY_MS = 300;

/**
 * Run a query on the pool with timing. Use this from repositories only when they are not
 * participating in a caller's transaction.
 */
export const query = async <R extends QueryResultRow = QueryResultRow>(
  sql: string,
  params?: readonly unknown[],
): Promise<QueryResult<R>> => {
  const startedAt = performance.now();
  try {
    const result = await pool.query<R>(sql, params as unknown[]);
    const elapsed = performance.now() - startedAt;
    if (elapsed > SLOW_QUERY_MS) {
      dbLogger.warn({ elapsedMs: Math.round(elapsed), sql: collapse(sql) }, 'slow query');
    }
    return result;
  } catch (error) {
    // The SQL is logged, the parameters are not — they routinely contain personal data.
    dbLogger.error({ err: error, sql: collapse(sql) }, 'query failed');
    throw error;
  }
};

/**
 * Run `fn` inside a transaction, committing on success and rolling back on any throw.
 *
 * The callback receives the transaction client as an `Executor`, which it passes down to
 * repositories. Every write in the callback either lands together or not at all.
 */
export const withTransaction = async <T>(fn: (tx: Executor) => Promise<T>): Promise<T> => {
  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      // A failed rollback means the connection is unusable; log it and let the original
      // error propagate, since that is the one that explains what went wrong.
      dbLogger.error({ err: rollbackError }, 'rollback failed');
    }
    throw error;
  } finally {
    client.release();
  }
};

/** Verify connectivity at boot so a bad DATABASE_URL fails loudly and early. */
export const assertDatabaseReachable = async (): Promise<void> => {
  const result = await pool.query<{ version: string }>('SELECT version()');
  dbLogger.info({ version: result.rows[0]?.version.split(',')[0] }, 'database connected');
};

export const closePool = async (): Promise<void> => {
  await pool.end();
  dbLogger.info('pool closed');
};

const collapse = (sql: string) => sql.replace(/\s+/g, ' ').trim().slice(0, 200);
