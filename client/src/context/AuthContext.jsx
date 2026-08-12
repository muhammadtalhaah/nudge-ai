/**
 * Authentication state.
 *
 * The access token lives in the API client's memory, not here — this context holds the user
 * and the one piece of state the router genuinely needs: whether we have finished working out
 * if there is a session at all.
 *
 * That `isBootstrapping` flag is the important part. On a page reload there is no token in
 * memory, only an httpOnly cookie the page cannot read. So the app must try a silent refresh
 * before deciding anyone is logged out. Without the gate, every guarded route would flash a
 * redirect to /login on every refresh.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import authApi from '@/api/auth';
import { refreshSession, setAccessToken, setSessionExpiredHandler } from '@/api/client';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  /**
   * The tenant, which rides along with the session for one reason: its timezone.
   *
   * Every appointment and every free slot on screen is a UTC instant that has to be rendered in
   * some zone, and the only one that means anything for a clinic is the clinic's. Holding it here
   * rather than fetching it separately is what lets the first paint be correct — the router
   * already waits on `isBootstrapping`, so there is no second gate to add.
   */
  const [business, setBusiness] = useState(null);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const queryClient = useQueryClient();

  /**
   * Clear every trace of the session.
   *
   * The query cache must go too: it holds the previous user's appointments and conversations,
   * and leaving it would show one account's data to the next person to log in on this device.
   */
  const clearSession = useCallback(() => {
    setAccessToken(null);
    setUser(null);
    setBusiness(null);
    queryClient.clear();
  }, [queryClient]);

  // Let the API client tell us when a refresh has definitively failed.
  useEffect(() => {
    setSessionExpiredHandler(() => clearSession());
    return () => setSessionExpiredHandler(null);
  }, [clearSession]);

  // Restore a session on first load, then open the gate either way.
  useEffect(() => {
    let cancelled = false;

    const restore = async () => {
      try {
        const restored = await refreshSession();
        if (!cancelled && restored?.user) {
          setUser(restored.user);
          setBusiness(restored.business ?? null);
        }
      } finally {
        // Always runs: a failed restore is the normal case for a first-time visitor, and the
        // app must not hang on the loading gate because of it.
        if (!cancelled) setIsBootstrapping(false);
      }
    };

    void restore();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (credentials) => {
    const result = await authApi.login(credentials);
    if (result.ok) {
      setAccessToken(result.data.accessToken);
      setUser(result.data.user);
      setBusiness(result.data.business ?? null);
    }
    return result;
  }, []);

  const signup = useCallback(async (payload) => {
    const result = await authApi.signup(payload);
    if (result.ok) {
      setAccessToken(result.data.accessToken);
      setUser(result.data.user);
      setBusiness(result.data.business ?? null);
    }
    return result;
  }, []);

  const logout = useCallback(async () => {
    // Local state is cleared regardless of the request's outcome — a network failure must not
    // leave someone looking logged in when they asked to leave.
    try {
      await authApi.logout();
    } finally {
      clearSession();
    }
  }, [clearSession]);

  const value = useMemo(
    () => ({
      user,
      business,
      isAuthenticated: Boolean(user),
      isBootstrapping,
      login,
      signup,
      logout,
    }),
    [user, business, isBootstrapping, login, signup, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside an AuthProvider');
  }
  return context;
};

/**
 * The clinic's timezone, or null when there isn't one to be had.
 *
 * Its own hook because almost every component that renders a time needs exactly this and nothing
 * else from auth, and because null already has a defined meaning downstream: the formatters fall
 * back to the viewer's zone rather than rendering nothing.
 *
 * Deliberately does NOT go through `useAuth`, and so does not throw outside a provider. That
 * strictness is right for `useAuth` — code that reads the user or calls `logout` is broken without
 * a session and should say so loudly. This is a display preference with a working default, and
 * anything that merely shows a time should degrade rather than take the screen down with it.
 */
export const useClinicTimezone = () => useContext(AuthContext)?.business?.timezone ?? null;

export default AuthContext;
