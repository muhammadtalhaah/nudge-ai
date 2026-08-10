/**
 * Chat controllers.
 *
 * REST covers the whole chat surface — create a session, read history, send a message — so
 * the API is complete and testable with curl. Socket.IO adds real-time delivery on top of the
 * same service; it is not a second implementation.
 */

import chatService from '../services/chatService.js';
import { sendData } from '../utils/httpResponse.js';

/** @returns {import('../services/appointmentService.js').Caller} */
const callerFrom = (req) => ({
  userId: req.auth.userId,
  businessId: req.auth.businessId,
  role: req.auth.role,
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
  const sessions = await chatService.listSessions(callerFrom(req));
  sendData(res, { sessions: sessions.map(toSessionView) });
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
