/**
 * Chat controllers.
 *
 * REST covers the whole chat surface — create a session, read history, send a message — so
 * the API is complete and testable with curl. Socket.IO adds real-time delivery on top of the
 * same service; it is not a second implementation.
 */

import type { Request, Response } from 'express';

import type { ChatMessageView, ChatReply, ChatSessionView } from '@shared/chat.ts';
import type { CreateSessionInput, SendMessageInput } from '@shared/schemas.ts';

import chatService from '../services/chatService.ts';
import type { Caller } from '../services/appointmentService.ts';
import type { ChatMessage, ChatSession } from '../repositories/chatRepository.ts';
import { sendData } from '../utils/httpResponse.ts';

const callerFrom = (req: Request): Caller => ({
  userId: req.auth!.userId,
  businessId: req.auth!.businessId,
  role: req.auth!.role,
});

const sessionIdParam = (req: Request): string => (req.params as unknown as { id: string }).id;

const toSessionView = (session: ChatSession): ChatSessionView => ({
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
 */
export const toMessageView = (message: ChatMessage): ChatMessageView => ({
  id: message.id,
  role: message.role,
  content: message.content,
  createdAt: message.createdAt.toISOString(),
  reply:
    message.role === 'assistant' && message.extractedData
      ? (message.extractedData as unknown as ChatReply)
      : null,
});

export const createSession = async (req: Request, res: Response): Promise<void> => {
  const input = req.body as CreateSessionInput;
  const session = await chatService.createSession(callerFrom(req), input?.title);
  sendData(res, { session: toSessionView(session) }, 201);
};

export const listSessions = async (req: Request, res: Response): Promise<void> => {
  const sessions = await chatService.listSessions(callerFrom(req));
  sendData(res, { sessions: sessions.map(toSessionView) });
};

export const listMessages = async (req: Request, res: Response): Promise<void> => {
  const messages = await chatService.getMessages(callerFrom(req), sessionIdParam(req));
  sendData(res, { messages: messages.map(toMessageView) });
};

export const sendMessage = async (req: Request, res: Response): Promise<void> => {
  const input = req.body as SendMessageInput;

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
