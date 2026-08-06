/**
 * Token primitives.
 *
 * Two different kinds of token on purpose:
 *
 *   Access token   — a short-lived signed JWT. Stateless, so authenticating a request
 *                    costs no database round trip for the token itself.
 *   Refresh token  — a long-lived opaque random string, NOT a JWT. It is stored server
 *                    side as a SHA-256 hash so it can be revoked, and so a database leak
 *                    yields no usable sessions. A JWT here would be unrevocable, which is
 *                    exactly the property you do not want on a 30-day credential.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import jwt from 'jsonwebtoken';

import type { UserRole } from '@shared/constants.ts';

import { env } from '../config/env.ts';
import { UnauthenticatedError } from '../errors/AppError.ts';
import { ERROR_CODES } from '@shared/constants.ts';

export interface AccessTokenPayload {
  sub: string;
  businessId: string;
  role: UserRole;
  email: string;
  /** Compared against the user row so a password change or deactivation invalidates it. */
  tokenVersion: number;
}

export const signAccessToken = (payload: AccessTokenPayload): string =>
  jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_TTL as jwt.SignOptions['expiresIn'],
    issuer: 'nudge-ai',
    audience: 'nudge-ai-client',
  });

export const verifyAccessToken = (token: string): AccessTokenPayload => {
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, {
      issuer: 'nudge-ai',
      audience: 'nudge-ai-client',
      algorithms: ['HS256'],
    });

    if (typeof decoded === 'string') throw new Error('unexpected string payload');
    return decoded as unknown as AccessTokenPayload;
  } catch (error) {
    // Distinguish expiry from tampering: the client should silently refresh on the former
    // and hard-log-out on the latter.
    if (error instanceof jwt.TokenExpiredError) {
      throw new UnauthenticatedError('Access token expired', ERROR_CODES.TOKEN_EXPIRED);
    }
    throw new UnauthenticatedError('Invalid access token');
  }
};

/** 256 bits of entropy — not guessable, and never stored in plaintext. */
export const generateRefreshToken = (): string => randomBytes(32).toString('base64url');

/**
 * Refresh tokens are looked up by hash. SHA-256 rather than bcrypt is correct here: the
 * input is already high-entropy random, so there is nothing to brute force, and we need a
 * deterministic value to index on.
 */
export const hashRefreshToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

/** Constant-time comparison for any secret compared outside the database. */
export const safeCompare = (a: string, b: string): boolean => {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
};

export const refreshTokenExpiry = (): Date =>
  new Date(Date.now() + env.REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
