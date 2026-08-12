/**
 * Chat controllers.
 *
 * REST covers the whole chat surface — create a session, read history, send a message — so
 * the API is complete and testable with curl. Socket.IO adds real-time delivery on top of the
 * same service; it is not a second implementation.
 */

import chatService from '../services/chatService.js';
import { sendData } from '../utils/httpResponse.js';

/**
 * The chat surface carries the caller's name as well as their identity — the assistant greets
 * people by it. It is copied from `req.auth`, which is built from the database row, so it is
 * subject to exactly the same verification as the ids beside it and grants exactly as much
 * authority as they do outside their own scope: none.
 *
 * @returns {import('../services/appointmentService.js').Caller}
 */
const callerFrom = (req) => ({
  userId: req.auth.userId,
  businessId: req.auth.businessId,
  role: req.auth.role,
  fullName: req.auth.fullName,
});

const sessionIdParam = (req) => req.params.id;

/** @returns {import('../../../shared/chat.js').ChatSessionView} */
const toSessionView = (session) => ({
  id: session.id,
  title: session.title,
  status: session.status,
  messageCount: session.messageCount,
  lastMessageAt: session.lastMessageAt?.toISOString() ?? null,
  createdAt: session.createdAt.toISOString(),
});

/**
 * Assistant turns carry their structured payload in extracted_data. Replaying it lets a
 * reloaded conversation render doctor cards and the prefilled form exactly as first shown.
 *
 * @returns {import('../../../shared/chat.js').ChatMessageView}
 */
export const toMessageView = (message) => ({
  id: message.id,
  role: message.role,
  content: message.content,
  createdAt: message.createdAt.toISOString(),
  reply: message.role === 'assistant' && message.extractedData ? message.extractedData : null,
});

export const createSession = async (req, res) => {
  const input = req.body;
  const session = await chatService.createSession(callerFrom(req), input?.title);
  sendData(res, { session: toSessionView(session) }, 201);
};

export const listSessions = async (req, res) => {
  const queryParams = req.query;

  const { items, nextCursor } = await chatService.listSessions(callerFrom(req), {
    limit: queryParams.limit,
    cursor: queryParams.cursor,
  });

  // `nextCursor: null` is the end of the list, said explicitly. A client cannot infer it from
  // a short page — a page can be short because rows moved while it was being read.
  sendData(res, { sessions: items.map(toSessionView), nextCursor });
};

export const listMessages = async (req, res) => {
  const messages = await chatService.getMessages(callerFrom(req), sessionIdParam(req));
  sendData(res, { messages: messages.map(toMessageView) });
};

export const sendMessage = async (req, res) => {
  const input = req.body;

  const { userMessage, assistantMessage, reply } = await chatService.handleMessage(
    callerFrom(req),
    sessionIdParam(req),
    input.content,
  );

  sendData(
    res,
    {
      userMessage: toMessageView(userMessage),
      assistantMessage: toMessageView(assistantMessage),
      reply,
    },
    201,
  );
};

export default { createSession, listSessions, listMessages, sendMessage };
