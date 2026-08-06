/**
 * Client-side configuration and route keys.
 *
 * Route paths live here rather than being typed as literals in components, so a path change
 * is one edit and a typo is a missing export rather than a silently dead link.
 */

export const ROUTES = {
  ROOT: '/',
  LOGIN: '/login',
  SIGNUP: '/signup',
  CHAT: '/chat',
  APPOINTMENTS: '/appointments',
  NOT_FOUND: '*',
};

/**
 * In development Vite proxies /api to the server, and in production the server serves this
 * bundle — so a relative base URL is correct in both cases and there is no cross-origin
 * request to configure. VITE_API_BASE_URL is honoured for the case where the client is
 * deployed separately from the API.
 */
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';

export const THEME_STORAGE_KEY = 'nudge-ai-theme';

export const QUERY_STALE_TIME_MS = 30_000;
