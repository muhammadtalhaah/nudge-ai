/**
 * User persistence.
 *
 * Repositories own SQL and the row→domain mapping, and nothing else. They know nothing
 * about HTTP, and they never decide policy — a repository will happily fetch any user, so
 * it is the service's job to only ask for ones the caller may see.
 *
 * Every function takes an executor first (the pool or a transaction client) so the caller
 * chooses whether the call joins an open transaction or runs standalone.
 */

/**
 * Map a database row to the domain shape. camelCase — the snake_case boundary ends here,
 * and this function is the boundary. Every field the rest of the application may rely on
 * is listed below; anything not mapped here does not exist upstream.
 */
const toUser = (row) => ({
  id: row.id,
  businessId: row.business_id,
  email: row.email,
  fullName: row.full_name,
  phone: row.phone,
  role: row.role,
  isActive: row.is_active,
  tokenVersion: row.token_version,
  lastLoginAt: row.last_login_at,
  createdAt: row.created_at,
});

/** Only ever returned by the login lookup, never by anything that reaches a controller. */
const toUserWithPassword = (row) => ({
  ...toUser(row),
  passwordHash: row.password_hash,
});

const COLUMNS = `id, business_id, email, password_hash, full_name, phone, role,
                 is_active, token_version, last_login_at, created_at`;

/**
 * Login lookup. Scoped by business because email is only unique within a tenant, and
 * matched on lower(email) so the users_business_email_key index is used.
 */
export const findByEmail = async (executor, businessId, email) => {
  const { rows } = await executor.query(
    `SELECT ${COLUMNS} FROM users WHERE business_id = $1 AND lower(email) = lower($2)`,
    [businessId, email],
  );
  return rows[0] ? toUserWithPassword(rows[0]) : null;
};

/**
 * Used by requireAuth on every authenticated request to confirm the account is still
 * active and the token generation is current.
 */
export const findById = async (executor, id) => {
  const { rows } = await executor.query(`SELECT ${COLUMNS} FROM users WHERE id = $1`, [id]);
  return rows[0] ? toUser(rows[0]) : null;
};

/**
 * Insert a user. A duplicate email raises 23505 from the unique index, which the error
 * middleware turns into 409 EMAIL_TAKEN — no pre-flight SELECT, which would be racy anyway.
 *
 * @param {{ businessId: string, email: string, passwordHash: string, fullName: string,
 *           phone?: string | null, role?: string }} input
 */
export const create = async (executor, input) => {
  const { rows } = await executor.query(
    `INSERT INTO users (business_id, email, password_hash, full_name, phone, role)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'customer'))
     RETURNING ${COLUMNS}`,
    [
      input.businessId,
      input.email,
      input.passwordHash,
      input.fullName,
      input.phone ?? null,
      input.role ?? null,
    ],
  );

  // RETURNING on a successful INSERT always yields a row; the throw documents that
  // invariant rather than leaving an unchecked access for a reader to puzzle over.
  const row = rows[0];
  if (!row) throw new Error('INSERT ... RETURNING produced no row');
  return toUser(row);
};

export const touchLastLogin = async (executor, id) => {
  await executor.query('UPDATE users SET last_login_at = now() WHERE id = $1', [id]);
};

/** Bumping token_version invalidates every outstanding access token for this user. */
export const incrementTokenVersion = async (executor, id) => {
  await executor.query('UPDATE users SET token_version = token_version + 1 WHERE id = $1', [id]);
};

export default {
  findByEmail,
  findById,
  create,
  touchLastLogin,
  incrementTokenVersion,
};
