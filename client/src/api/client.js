/**
 * The HTTP client.
 *
 * Two things live here and nowhere else: attaching the access token, and recovering from an
 * expired one. Every other module calls a resource function and never thinks about auth.
 *
 * The access token is held in memory only — never localStorage or sessionStorage — so an XSS
 * bug cannot read it out of storage. The long-lived refresh token is an httpOnly cookie the
 * page's JavaScript cannot see at all.
 */

import { create } from 'apisauce';

import { API_BASE_URL } from '@/config/constants';

/**
 * In-memory token store. A module-level variable rather than React state because the API
 * client is not a component and must not re-render to read the current token.
 */
let accessToken = null;
let onSessionExpired = null;

export const setAccessToken = (token) => {
  accessToken = token;
};

export const getAccessToken = () => accessToken;

/** Registered by AuthProvider so a dead session can clear app state exactly once. */
export const setSessionExpiredHandler = (handler) => {
  onSessionExpired = handler;
};

const apiClient = create({
  baseURL: API_BASE_URL,
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
  // Required for the refresh cookie to be sent at all.
  withCredentials: true,
});

apiClient.addRequestTransform((request) => {
  if (accessToken) {
    request.headers.Authorization = `Bearer ${accessToken}`;
  }
});

/**
 * Single-flight refresh.
 *
 * Without this, a page that fires five queries on mount with an expired token would send
 * five concurrent refresh requests. The server rotates on every use and revokes the whole
 * family on reuse — so four of those would look like a replay attack and log the user out.
 * Sharing one in-flight promise is what makes rotation safe on the client.
 */
let refreshPromise = null;

const refreshSession = async () => {
  if (!refreshPromise) {
    refreshPromise = apiClient
      .post('/auth/refresh')
      .then((response) => {
        if (response.ok && response.data?.data?.accessToken) {
          setAccessToken(response.data.data.accessToken);
          return response.data.data;
        }
        return null;
      })
      .finally(() => {
        // Cleared regardless of outcome so a later attempt is not stuck with a stale result.
        refreshPromise = null;
      });
  }

  return refreshPromise;
};

/** Paths that must never trigger a refresh-and-retry, or we would recurse. */
const AUTH_PATHS = ['/auth/refresh', '/auth/login', '/auth/signup', '/auth/logout'];

/**
 * Call the API, transparently refreshing once on an expired access token.
 *
 * Returns a normalised result rather than throwing, so callers get a consistent shape and
 * TanStack Query decides what an error means.
 */
export const request = async (method, url, payloadOrParams, config) => {
  const invoke = () => {
    switch (method) {
      case 'get':
        return apiClient.get(url, payloadOrParams, config);
      case 'post':
        return apiClient.post(url, payloadOrParams, config);
      case 'patch':
        return apiClient.patch(url, payloadOrParams, config);
      case 'put':
        return apiClient.put(url, payloadOrParams, config);
      case 'delete':
        return apiClient.delete(url, payloadOrParams, config);
      default:
        throw new Error(`Unsupported method: ${method}`);
    }
  };

  let response = await invoke();

  const isAuthPath = AUTH_PATHS.some((path) => url.startsWith(path));
  const isExpired = response.status === 401 && response.data?.error?.code === 'TOKEN_EXPIRED';

  if (isExpired && !isAuthPath) {
    const refreshed = await refreshSession();

    if (refreshed) {
      response = await invoke();
    } else if (onSessionExpired) {
      onSessionExpired();
    }
  }

  return normalise(response);
};

/**
 * Flatten apisauce's response into one shape.
 *
 * `details` is preserved because forms map it back onto individual fields — losing it would
 * turn a precise "email already taken" into a generic banner.
 */
const normalise = (response) => {
  if (response.ok && response.data?.success) {
    return {
      ok: true,
      data: response.data.data,
      meta: response.data.meta ?? null,
      status: response.status,
    };
  }

  const serverError = response.data?.error;

  return {
    ok: false,
    status: response.status ?? 0,
    error: {
      code: serverError?.code ?? mapTransportProblem(response.problem),
      message: serverError?.message ?? messageForProblem(response.problem),
      details: serverError?.details ?? null,
    },
    requestId: response.data?.requestId ?? null,
  };
};

const mapTransportProblem = (problem) => {
  if (problem === 'TIMEOUT_ERROR') return 'TIMEOUT';
  if (problem === 'NETWORK_ERROR' || problem === 'CONNECTION_ERROR') return 'NETWORK_ERROR';
  return 'UNKNOWN_ERROR';
};

/** User-facing copy for failures that never reached the server. */
const messageForProblem = (problem) => {
  switch (problem) {
    case 'TIMEOUT_ERROR':
      return 'The server took too long to respond. Please try again.';
    case 'NETWORK_ERROR':
    case 'CONNECTION_ERROR':
      return 'Could not reach the server. Check your connection.';
    case 'SERVER_ERROR':
      return 'Something went wrong on our end. Please try again.';
    default:
      return 'Something went wrong. Please try again.';
  }
};

export { refreshSession };
export default apiClient;
