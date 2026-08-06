/**
 * Auth controllers.
 *
 * Controllers translate HTTP to service calls and back: read the (already validated)
 * request, call one service function, set cookies, choose a status code. No business rules,
 * no SQL, no try/catch — Express 5 forwards rejections to the error middleware.
 */

import type { Request, Response } from 'express';

import type { LoginInput, SignupInput } from '@shared/schemas.ts';

import { UnauthenticatedError } from '../errors/AppError.ts';
import authService from '../services/authService.ts';
import { clearRefreshCookie, REFRESH_COOKIE_NAME, setRefreshCookie } from '../utils/cookies.ts';
import { sendData } from '../utils/httpResponse.ts';

/** Truncated because it is stored, and a hostile client can send a very long one. */
const userAgentOf = (req: Request): string | null =>
  req.headers['user-agent']?.slice(0, 300) ?? null;

export const signup = async (req: Request, res: Response): Promise<void> => {
  const input = req.body as SignupInput;

  const { user, accessToken, refreshToken } = await authService.signup(
    { fullName: input.fullName, email: input.email, password: input.password, phone: input.phone },
    userAgentOf(req),
  );

  setRefreshCookie(res, refreshToken);
  sendData(res, { user, accessToken }, 201);
};

export const login = async (req: Request, res: Response): Promise<void> => {
  const input = req.body as LoginInput;

  const { user, accessToken, refreshToken } = await authService.login(
    input.email,
    input.password,
    userAgentOf(req),
  );

  setRefreshCookie(res, refreshToken);
  sendData(res, { user, accessToken });
};

/**
 * Rotate the session. The client calls this on boot to restore a session after a reload,
 * and again whenever a request comes back 401 with TOKEN_EXPIRED.
 */
export const refresh = async (req: Request, res: Response): Promise<void> => {
  const presented = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
  if (!presented) {
    throw new UnauthenticatedError('No session cookie present');
  }

  try {
    const { user, accessToken, refreshToken } = await authService.refresh(
      presented,
      userAgentOf(req),
    );
    setRefreshCookie(res, refreshToken);
    sendData(res, { user, accessToken });
  } catch (error) {
    // The cookie is dead either way — clear it so the browser stops resending a token that
    // will only fail again.
    clearRefreshCookie(res);
    throw error;
  }
};

export const logout = async (req: Request, res: Response): Promise<void> => {
  await authService.logout(req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined);
  clearRefreshCookie(res);
  sendData(res, { loggedOut: true });
};

export const logoutAll = async (req: Request, res: Response): Promise<void> => {
  const revoked = await authService.logoutAll(req.auth!.userId);
  clearRefreshCookie(res);
  sendData(res, { loggedOut: true, sessionsRevoked: revoked });
};

export const me = async (req: Request, res: Response): Promise<void> => {
  const user = await authService.getById(req.auth!.userId);
  sendData(res, { user });
};

export default { signup, login, refresh, logout, logoutAll, me };
