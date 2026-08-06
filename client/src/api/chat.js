/**
 * Chat API calls.
 *
 * Messages normally go over the socket, but this REST path is the documented fallback and is
 * what the tests exercise — the server treats both identically.
 */

import { ENDPOINTS, sessionMessagesPath } from './endpoints';
import { request } from './client';

const listSessions = () => request('get', ENDPOINTS.CHAT_SESSIONS);
const createSession = (payload = {}) => request('post', ENDPOINTS.CHAT_SESSIONS, payload);
const listMessages = (sessionId) => request('get', sessionMessagesPath(sessionId));
const sendMessage = (sessionId, payload) =>
  request('post', sessionMessagesPath(sessionId), payload);

export default { listSessions, createSession, listMessages, sendMessage };
