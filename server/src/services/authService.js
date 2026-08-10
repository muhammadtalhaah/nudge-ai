/**
 * Authentication business rules.
 *
 * Services own policy and transactions. Controllers below them deal with HTTP; repositories
 * above the database deal with SQL. Nothing in this file imports express.
 */

import { env } from '../config/env.js';
import { withTransaction, pool } from '../db/pool.js';
import {
  InvalidCredentialsError,
  NotFoundError,
  UnauthenticatedError,
} from '../errors/AppError.js';
import { authLogger } from '../logger/index.js';
import businessRepository from '../repositories/businessRepository.js';
import refreshTokenRepository from '../repositories/refreshTokenRepository.js';
import userRepository from '../repositories/userRepository.js';
import { hashPassword, verifyPassword, wasteTimeLikeAVerification } from '../utils/password.js';
import {
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiry,
  signAccessToken,
} from '../utils/tokens.js';

/**
 * What a controller gets back from signup/login/refresh. The refresh token is set as a
 * cookie by the controller and is never serialised into a response body.
 *
 * @typedef {object} AuthResult
 * @property {PublicUser} user
 * @property {string} accessToken
 * @property {string} refreshToken
 */

/**
 * The only shape of a user that ever leaves the service layer.
 *
 * @typedef {object} PublicUser
 * @property {string} id
 * @property {string} email
 * @property {string} fullName
 * @property {string | null} phone
 * @property {string} role
 * @property {string} businessId
 * @property {Date} createdAt
 */

/**
 * Building it explicitly (rather than deleting `passwordHash` from the full row) means a
 * column added to the table cannot silently start appearing in API responses.
 *
 * @returns {PublicUser}
 */
export const toPublicUser = (user) => ({
  id: user.id,
  email: user.email,
  fullName: user.fullName,
  phone: user.phone,
  role: user.role,
  businessId: user.businessId,
  createdAt: user.createdAt,
});

/**
 * Resolve the tenant a signup or login belongs to.
 *
 * Single designated business, from config. A production multi-tenant app would derive this
 * from a subdomain, a custom domain, or an invite token — documented as a limitation.
 */
const resolveDefaultBusiness = async (executor) => {
  const business = await businessRepository.findBySlug(executor, env.DEFAULT_BUSINESS_SLUG);
  if (!business) {
    // Configuration error, not user error: the seed has not been run or the slug is wrong.
    throw new Error(
      `DEFAULT_BUSINESS_SLUG "${env.DEFAULT_BUSINESS_SLUG}" matches no business. Run npm run db:seed.`,
    );
  }
  return business;
};

const issueTokens = async (tx, user, userAgent) => {
  const accessToken = signAccessToken({
    sub: user.id,
    businessId: user.businessId,
    role: user.role,
    email: user.email,
    tokenVersion: user.tokenVersion,
  });

  const refreshToken = generateRefreshToken();
  await refreshTokenRepository.create(tx, {
    userId: user.id,
    tokenHash: hashRefreshToken(refreshToken),
    expiresAt: refreshTokenExpiry(),
    userAgent: userAgent ?? null,
  });

  return { accessToken, refreshToken };
};

/**
 * Create an account and sign in straight away.
 *
 * Role is not accepted from the request: a self-signup is always a customer. Allowing the
 * client to name its own role would be a trivial privilege escalation.
 *
 * @param {{ fullName: string, email: string, password: string, phone?: string }} input
 * @param {string | null} [userAgent]
 * @returns {Promise<AuthResult>}
 */
export const signup = async (input, userAgent) => {
  const passwordHash = await hashPassword(input.password);

  return withTransaction(async (tx) => {
    const business = await resolveDefaultBusiness(tx);

    // A duplicate email surfaces as 23505 from the unique index and is translated to 409
    // EMAIL_TAKEN. No pre-flight existence check — that would be a race, and two
    // simultaneous signups would both pass it.
    const user = await userRepository.create(tx, {
      businessId: business.id,
      email: input.email,
      passwordHash,
      fullName: input.fullName,
      phone: input.phone ?? null,
      role: 'customer',
    });

    const tokens = await issueTokens(tx, user, userAgent);
    authLogger.info({ userId: user.id, businessId: business.id }, 'user signed up');

    return { user: toPublicUser(user), ...tokens };
  });
};

/** @returns {Promise<AuthResult>} */
export const login = async (email, password, userAgent) => {
  const business = await resolveDefaultBusiness(pool);
  const user = await userRepository.findByEmail(pool, business.id, email);

  if (!user) {
    // Spend the same time a real verification would, so response latency does not reveal
    // whether the address is registered.
    await wasteTimeLikeAVerification();
    authLogger.warn({ email, reason: 'unknown_email' }, 'login failed');
    throw new InvalidCredentialsError();
  }

  const passwordMatches = await verifyPassword(password, user.passwordHash);
  if (!passwordMatches) {
    authLogger.warn({ userId: user.id, reason: 'bad_password' }, 'login failed');
    throw new InvalidCredentialsError();
  }

  // Checked after the password so a deactivated account cannot be distinguished from a
  // wrong password by an attacker who does not know the password.
  if (!user.isActive) {
    authLogger.warn({ userId: user.id, reason: 'inactive' }, 'login failed');
    throw new InvalidCredentialsError();
  }

  return withTransaction(async (tx) => {
    const tokens = await issueTokens(tx, user, userAgent);
    await userRepository.touchLastLogin(tx, user.id);
    authLogger.info({ userId: user.id }, 'user logged in');
    return { user: toPublicUser(user), ...tokens };
  });
};

/**
 * Exchange a refresh token for a new pair, rotating the old one.
 *
 * Rotation with replay detection: each refresh token is single-use. Presenting one that has
 * already been revoked means either a stolen token or a cloned session, and we cannot tell
 * which — so every session for that user is revoked and they must sign in again. Failing
 * closed is the right call for a credential that lives 30 days.
 *
 * @returns {Promise<AuthResult>}
 */
export const refresh = async (rawToken, userAgent) => {
  const tokenHash = hashRefreshToken(rawToken);

  const record = await refreshTokenRepository.findByHash(pool, tokenHash);
  if (!record) {
    throw new UnauthenticatedError('Invalid refresh token');
  }

  // Already-rotated token presented again.
  if (record.revokedAt) {
    await revokeFamilyAndFail(record.userId, 'replay');
  }

  if (record.expiresAt.getTime() <= Date.now()) {
    throw new UnauthenticatedError('Session expired. Please sign in again.');
  }

  const user = await userRepository.findById(pool, record.userId);
  if (!user || !user.isActive) {
    // Runs on the pool, not in a rolled-back transaction — see revokeFamilyAndFail.
    await refreshTokenRepository.revokeAllForUser(pool, record.userId);
    throw new UnauthenticatedError('Account is unavailable');
  }

  try {
    return await withTransaction(async (tx) => {
      // Compare-and-swap. Revoking returns 0 rows when a concurrent request already
      // rotated this token, which is indistinguishable from a replay — so only the request
      // that actually flipped the row is allowed to mint a new pair.
      const revoked = await refreshTokenRepository.revokeById(tx, record.id);
      if (revoked === 0) {
        throw new ConcurrentRotationError();
      }

      const tokens = await issueTokens(tx, user, userAgent);
      return { user: toPublicUser(user), ...tokens };
    });
  } catch (error) {
    if (error instanceof ConcurrentRotationError) {
      await revokeFamilyAndFail(record.userId, 'concurrent_rotation');
    }
    throw error;
  }
};

/** Internal signal, never leaves this module. */
class ConcurrentRotationError extends Error {}

/**
 * Revoke every session for a user, then fail the request. Never returns.
 *
 * Deliberately runs on the pool rather than inside the caller's transaction. Revoking and
 * then throwing within one transaction would roll the revocation back — the compromised
 * tokens would survive the very check meant to kill them.
 */
const revokeFamilyAndFail = async (userId, reason) => {
  const revokedCount = await refreshTokenRepository.revokeAllForUser(pool, userId);
  authLogger.error(
    { userId, revokedCount, reason },
    'refresh token reuse detected — all sessions revoked',
  );
  throw new UnauthenticatedError('Session is no longer valid. Please sign in again.');
};

export const logout = async (rawToken) => {
  if (!rawToken) return;

  const record = await refreshTokenRepository.findByHash(pool, hashRefreshToken(rawToken));
  // Silent when the token is unknown: logout is idempotent and must never report whether a
  // token was real.
  if (record && !record.revokedAt) {
    await refreshTokenRepository.revokeById(pool, record.id);
    authLogger.info({ userId: record.userId }, 'user logged out');
  }
};

/** Sign out everywhere: revoke every refresh token and invalidate live access tokens. */
export const logoutAll = async (userId) =>
  withTransaction(async (tx) => {
    const revoked = await refreshTokenRepository.revokeAllForUser(tx, userId);
    await userRepository.incrementTokenVersion(tx, userId);
    authLogger.info({ userId, revoked }, 'all sessions revoked');
    return revoked;
  });

/** @returns {Promise<PublicUser>} */
export const getById = async (userId) => {
  const user = await userRepository.findById(pool, userId);
  if (!user) throw new NotFoundError('User');
  return toPublicUser(user);
};

export default { signup, login, refresh, logout, logoutAll, getById, toPublicUser };
