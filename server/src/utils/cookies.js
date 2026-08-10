/**
 * Refresh-token cookie handling.
 *
 * Why a cookie and not a JSON field the client stores: an httpOnly cookie is unreadable
 * from JavaScript, so an XSS bug cannot exfiltrate the long-lived credential. The
 * short-lived access token is held in memory only and is never persisted anywhere.
 *
 * This works cleanly because the client and API share an origin — Vite proxies /api in
 * development, and in production the API serves the built bundle. That means SameSite=Lax
 * is sufficient and we never need SameSite=None, which would require third-party cookies.
 */

import { env } from '../config/env.js';

export const REFRESH_COOKIE_NAME = 'nudge_refresh';

/** Scoped so the browser only attaches it to the endpoints that consume it. */
const COOKIE_PATH = '/api/auth';

const baseOptions = {
  httpOnly: true,
  // Lax rather than Strict: Strict would drop the cookie on a cross-site top-level
  // navigation into the app, silently logging the user out when they follow a link in.
  sameSite: 'lax',
  secure: env.isProduction,
  path: COOKIE_PATH,
};

export const setRefreshCookie = (res, token) => {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    ...baseOptions,
    maxAge: env.REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000,
  });
};

/** Options must match those used to set it, or the browser will not remove it. */
export const clearRefreshCookie = (res) => {
  res.clearCookie(REFRESH_COOKIE_NAME, baseOptions);
};
