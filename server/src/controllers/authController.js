/**
 * Auth controllers.
 *
 * Controllers translate HTTP to service calls and back: read the (already validated)
 * request, call one service function, set cookies, choose a status code. No business rules,
 * no SQL, no try/catch — Express 5 forwards rejections to the error middleware.
 */

import { UnauthenticatedError } from '../errors/AppError.js';
import authService from '../services/authService.js';
import { clearRefreshCookie, REFRESH_COOKIE_NAME, setRefreshCookie } from '../utils/cookies.js';
import { sendData } from '../utils/httpResponse.js';

/** Truncated because it is stored, and a hostile client can send a very long one. */
const userAgentOf = (req) => req.headers['user-agent']?.slice(0, 300) ?? null;

export const signup = async (req, res) => {
  // Shaped by signupSchema in the validate middleware, so the fields below are known good.
  const input = req.body;

  const { user, business, accessToken, refreshToken } = await authService.signup(
    { fullName: input.fullName, email: input.email, password: input.password, phone: input.phone },
    userAgentOf(req),
  );

  setRefreshCookie(res, refreshToken);
  sendData(res, { user, business, accessToken }, 201);
};

export const login = async (req, res) => {
  const input = req.body;

  const { user, business, accessToken, refreshToken } = await authService.login(
    input.email,
    input.password,
    userAgentOf(req),
  );

  setRefreshCookie(res, refreshToken);
  sendData(res, { user, business, accessToken });
};

/**
 * Rotate the session. The client calls this on boot to restore a session after a reload,
 * and again whenever a request comes back 401 with TOKEN_EXPIRED.
 */
export const refresh = async (req, res) => {
  const presented = req.cookies?.[REFRESH_COOKIE_NAME];
  if (!presented) {
    throw new UnauthenticatedError('No session cookie present');
  }

  try {
    const { user, business, accessToken, refreshToken } = await authService.refresh(
      presented,
      userAgentOf(req),
    );
    setRefreshCookie(res, refreshToken);
    sendData(res, { user, business, accessToken });
  } catch (error) {
    // The cookie is dead either way — clear it so the browser stops resending a token that
    // will only fail again.
    clearRefreshCookie(res);
    throw error;
  }
};

export const logout = async (req, res) => {
  await authService.logout(req.cookies?.[REFRESH_COOKIE_NAME]);
  clearRefreshCookie(res);
  sendData(res, { loggedOut: true });
};

export const logoutAll = async (req, res) => {
  const revoked = await authService.logoutAll(req.auth.userId);
  clearRefreshCookie(res);
  sendData(res, { loggedOut: true, sessionsRevoked: revoked });
};

export const me = async (req, res) => {
  const { user, business } = await authService.getById(req.auth.userId);
  sendData(res, { user, business });
};

export default { signup, login, refresh, logout, logoutAll, me };
