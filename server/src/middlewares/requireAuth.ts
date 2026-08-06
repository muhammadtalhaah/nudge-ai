/**
 * Authentication and role authorisation.
 *
 * Populates `req.auth` from a verified bearer token. This is the ONLY place caller identity
 * enters the application — no service or repository ever reads an id from the request body
 * or query string, which is what makes horizontal privilege escalation structurally
 * difficult rather than a thing we remember to check.
 */

import type { NextFunction, Request, Response } from 'express';

import { ERROR_CODES, type UserRole } from '@shared/constants.ts';

import { pool } from '../db/pool.ts';
import { ForbiddenError, UnauthenticatedError } from '../errors/AppError.ts';
import { authLogger } from '../logger/index.ts';
import userRepository from '../repositories/userRepository.ts';
import { verifyAccessToken } from '../utils/tokens.ts';

const extractBearerToken = (header: string | undefined): string | null => {
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  return token.trim() || null;
};

/**
 * Verify the access token, then confirm the account against the database.
 *
 * The database check is deliberate. A stateless JWT alone would keep working for up to its
 * full 15-minute lifetime after an account is deactivated or its password changed. One
 * primary-key lookup per request buys immediate revocation, and at this scale it is noise.
 * At high throughput this is the thing to cache (Redis, short TTL) — not to remove.
 */
export const requireAuth = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    next(new UnauthenticatedError('Authentication required'));
    return;
  }

  // Throws UnauthenticatedError (TOKEN_EXPIRED or generic) which the error handler renders.
  const payload = verifyAccessToken(token);

  const user = await userRepository.findById(pool, payload.sub);

  if (!user || !user.isActive) {
    authLogger.warn({ userId: payload.sub }, 'token presented for missing or inactive user');
    next(new UnauthenticatedError('Account is unavailable'));
    return;
  }

  if (user.tokenVersion !== payload.tokenVersion) {
    authLogger.warn(
      { userId: user.id, tokenVersion: payload.tokenVersion, current: user.tokenVersion },
      'stale token version',
    );
    next(new UnauthenticatedError('Session is no longer valid', ERROR_CODES.TOKEN_EXPIRED));
    return;
  }

  // Identity comes from the database row, not the token body, so a stale role in an
  // already-issued token cannot outlive a role change.
  req.auth = {
    userId: user.id,
    businessId: user.businessId,
    role: user.role,
    email: user.email,
  };

  next();
};

/**
 * Restrict a route to specific roles. Coarse-grained by design: it answers "may this kind
 * of user call this endpoint at all". Whether they may touch a *particular record* is
 * ownership, which lives in the service layer where the record is actually loaded.
 */
export const requireRole = (...allowed: UserRole[]) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      next(new UnauthenticatedError('Authentication required'));
      return;
    }

    if (!allowed.includes(req.auth.role)) {
      authLogger.warn(
        { userId: req.auth.userId, role: req.auth.role, allowed },
        'role check failed',
      );
      next(new ForbiddenError());
      return;
    }

    next();
  };
};
