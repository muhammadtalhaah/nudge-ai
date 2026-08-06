/**
 * Refresh token persistence. Only hashes are stored — see utils/tokens.ts.
 */

import type { Executor } from '../db/pool.ts';

export interface RefreshTokenRecord {
  id: string;
  userId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

interface RefreshTokenRow {
  id: string;
  user_id: string;
  expires_at: Date;
  revoked_at: Date | null;
  created_at: Date;
}

const toRecord = (row: RefreshTokenRow): RefreshTokenRecord => ({
  id: row.id,
  userId: row.user_id,
  expiresAt: row.expires_at,
  revokedAt: row.revoked_at,
  createdAt: row.created_at,
});

export const create = async (
  executor: Executor,
  input: { userId: string; tokenHash: string; expiresAt: Date; userAgent?: string | null },
): Promise<void> => {
  await executor.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, user_agent)
     VALUES ($1, $2, $3, $4)`,
    [input.userId, input.tokenHash, input.expiresAt, input.userAgent?.slice(0, 300) ?? null],
  );
};

/**
 * Look up by hash regardless of revocation state.
 *
 * Deliberately does not filter on `revoked_at IS NULL`: the service needs to tell "unknown
 * token" apart from "known token that was already used", because the second case is a
 * replay and triggers revoking the user's whole set.
 */
export const findByHash = async (
  executor: Executor,
  tokenHash: string,
): Promise<RefreshTokenRecord | null> => {
  const { rows } = await executor.query<RefreshTokenRow>(
    `SELECT id, user_id, expires_at, revoked_at, created_at
       FROM refresh_tokens WHERE token_hash = $1`,
    [tokenHash],
  );
  return rows[0] ? toRecord(rows[0]) : null;
};

/**
 * Revoke one token, returning how many rows changed.
 *
 * The `revoked_at IS NULL` guard plus the returned count make this a compare-and-swap: a
 * caller that gets 0 back knows someone else revoked it first. Rotation relies on that to
 * stay safe when two requests present the same token simultaneously.
 */
export const revokeById = async (executor: Executor, id: string): Promise<number> => {
  const { rowCount } = await executor.query(
    'UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL',
    [id],
  );
  return rowCount ?? 0;
};

/** Used on logout-all, on password change, and on replay detection. */
export const revokeAllForUser = async (executor: Executor, userId: string): Promise<number> => {
  const { rowCount } = await executor.query(
    'UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
    [userId],
  );
  return rowCount ?? 0;
};

/**
 * Housekeeping for expired rows. Not scheduled in this prototype — called out in the
 * README as something a real deployment would run periodically.
 */
export const deleteExpired = async (executor: Executor): Promise<number> => {
  const { rowCount } = await executor.query(
    "DELETE FROM refresh_tokens WHERE expires_at < now() - interval '7 days'",
  );
  return rowCount ?? 0;
};

export default { create, findByHash, revokeById, revokeAllForUser, deleteExpired };
