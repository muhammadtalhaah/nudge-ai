/**
 * Socket.IO layer — real-time chat delivery.
 *
 * This file is transport, not logic. It authenticates the connection, then forwards messages
 * to the same `chatService.handleMessage` the REST endpoint calls. There is no second
 * implementation of the conversation rules, no separate booking path, and no business rule
 * that only holds over one of the two transports.
 *
 * What the socket buys over polling: the assistant's "thinking" state is pushed the moment
 * work starts, the reply is delivered a fragment at a time as the model writes it, and a
 * booking made in one tab appears in another without a refresh.
 *
 * Streaming does not give the socket any extra authority. Deltas carry prose and nothing
 * else; the appointment, the doctor cards and the prefilled form still arrive only with the
 * final ASSISTANT_REPLY, from the service.
 */

import { randomUUID } from 'node:crypto';

import { Server } from 'socket.io';

import { SOCKET_EVENTS } from '../../shared/constants.js';
import { sendMessageSchema } from '../../shared/schemas.js';

import { env } from './config/env.js';
import { toMessageView } from './controllers/chatController.js';
import { pool } from './db/pool.js';
import { AppError } from './errors/AppError.js';
import { socketLogger } from './logger/index.js';
import userRepository from './repositories/userRepository.js';
import chatService from './services/chatService.js';
import { verifyAccessToken } from './utils/tokens.js';

/**
 * Per-user message budget for the socket path.
 *
 * express-rate-limit only guards HTTP, so without this the WebSocket would be an unmetered
 * route to the same paid model calls. Same window and ceiling as the REST chat limiter, so
 * the choice of transport does not change what a user is allowed to do.
 */
const messageTimestamps = new Map();

const withinRateLimit = (userId) => {
  const now = Date.now();
  const cutoff = now - env.RATE_LIMIT_WINDOW_MS;

  const recent = (messageTimestamps.get(userId) ?? []).filter((at) => at > cutoff);

  if (recent.length >= env.CHAT_RATE_LIMIT_MAX) {
    messageTimestamps.set(userId, recent);
    return false;
  }

  recent.push(now);
  messageTimestamps.set(userId, recent);
  return true;
};

/** Stops the map growing without bound on a long-lived process. */
const startRateLimitCleanup = () => {
  const timer = setInterval(() => {
    const cutoff = Date.now() - env.RATE_LIMIT_WINDOW_MS;
    for (const [userId, timestamps] of messageTimestamps) {
      const recent = timestamps.filter((at) => at > cutoff);
      if (recent.length === 0) messageTimestamps.delete(userId);
      else messageTimestamps.set(userId, recent);
    }
  }, env.RATE_LIMIT_WINDOW_MS);

  timer.unref();
  return timer;
};

/**
 * Each user gets a private room, so a booking confirmation reaches every tab that user has
 * open and nobody else's. Rooms are keyed by user id, never by session id supplied by a client.
 */
const roomFor = (userId) => `user:${userId}`;

/**
 * @param {import('node:http').Server} httpServer
 * @returns {Server}
 */
export const attachSocketServer = (httpServer) => {
  const io = new Server(httpServer, {
    // Same-origin in production, and the Vite dev server proxies /socket.io, so this only
    // matters if the client is ever served from a different host.
    cors: { origin: env.CORS_ORIGINS, credentials: true },
    // Slightly above the client's default so a brief stall does not drop the connection.
    pingTimeout: 25_000,
  });

  /**
   * Handshake authentication.
   *
   * The access token is verified and then checked against the database, exactly as
   * requireAuth does for HTTP — a socket must not be a way to keep using a token that was
   * invalidated by a logout-all or a deactivation. A long-lived connection makes this more
   * important than it is for a single request, not less.
   *
   * What lands on `socket.data.auth` is the same caller identity requireAuth builds, plus
   * the email — sockets never carry a client-supplied id.
   */
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) {
        next(new Error('UNAUTHENTICATED'));
        return;
      }

      const payload = verifyAccessToken(token);
      const user = await userRepository.findById(pool, payload.sub);

      if (!user || !user.isActive || user.tokenVersion !== payload.tokenVersion) {
        next(new Error('UNAUTHENTICATED'));
        return;
      }

      socket.data.auth = {
        userId: user.id,
        businessId: user.businessId,
        role: user.role,
        email: user.email,
      };

      next();
    } catch {
      // Deliberately opaque: a handshake failure should not explain itself.
      next(new Error('UNAUTHENTICATED'));
    }
  });

  io.on('connection', (socket) => {
    const auth = socket.data.auth;
    if (!auth) {
      socket.disconnect(true);
      return;
    }

    void socket.join(roomFor(auth.userId));
    socketLogger.info({ userId: auth.userId, socketId: socket.id }, 'socket connected');

    socket.on(SOCKET_EVENTS.MESSAGE_SEND, async (payload, ack) => {
      const respond = (result) => {
        if (typeof ack === 'function') ack(result);
      };

      /**
       * Identifies this turn on the wire. Deltas are broadcast to every tab the user has
       * open, and the rate limit permits more than one message per window — so without an
       * id, two overlapping turns would append into the same bubble.
       */
      const turnId = randomUUID();
      const room = roomFor(auth.userId);

      try {
        // Same Zod schema as the REST route — one definition of a valid message.
        const parsedBody = sendMessageSchema.safeParse(payload);
        const rawSessionId = payload?.sessionId;

        if (!parsedBody.success || typeof rawSessionId !== 'string') {
          socket.emit(SOCKET_EVENTS.ERROR, {
            code: 'VALIDATION_ERROR',
            message: 'A sessionId and a non-empty message are required',
          });
          respond({ success: false });
          return;
        }

        if (!withinRateLimit(auth.userId)) {
          socket.emit(SOCKET_EVENTS.ERROR, {
            code: 'RATE_LIMITED',
            message: 'You are sending messages too quickly. Please wait a moment.',
          });
          respond({ success: false });
          return;
        }

        // Tell the client work has started, before the (possibly slow) model call.
        socket.emit(SOCKET_EVENTS.ASSISTANT_TYPING, { sessionId: rawSessionId, typing: true });

        // Ownership of the session is enforced inside the service, which throws NotFound for
        // someone else's conversation. The socket does not re-implement that check.
        const { assistantMessage, reply } = await chatService.handleMessage(
          auth,
          rawSessionId,
          parsedBody.data.content,
          {
            /**
             * Echoed as soon as it is persisted rather than at the end of the turn. It has
             * to come first: the assistant's prose starts arriving seconds before the turn
             * completes, and a second tab must not see an answer to a message it has not
             * been shown. It also means a message that was saved is reported as saved even
             * if the model call later fails.
             */
            onUserMessage: (message) => {
              io.to(room).emit(SOCKET_EVENTS.MESSAGE_RECEIVED, {
                sessionId: rawSessionId,
                message: toMessageView(message),
              });
            },

            // Prose only, and only from providers that genuinely generate incrementally.
            onReplyDelta: (delta) => {
              io.to(room).emit(SOCKET_EVENTS.ASSISTANT_DELTA, {
                sessionId: rawSessionId,
                turnId,
                delta,
              });
            },
          },
        );

        /**
         * The authoritative turn. Whatever streamed above was a draft; this is the reply
         * that gets persisted, replayed on reload, and is allowed to carry structure.
         */
        io.to(room).emit(SOCKET_EVENTS.ASSISTANT_REPLY, {
          sessionId: rawSessionId,
          turnId,
          message: toMessageView(assistantMessage),
          reply,
        });

        if (reply.appointment) {
          // Lets the appointments view invalidate its cache without polling.
          io.to(room).emit(SOCKET_EVENTS.APPOINTMENT_CREATED, {
            appointment: reply.appointment,
          });
        }

        respond({ success: true });
      } catch (error) {
        const isExpected = error instanceof AppError;

        socketLogger[isExpected ? 'warn' : 'error'](
          { err: error, userId: auth.userId },
          'socket message failed',
        );

        // turnId lets the client discard a half-written bubble for this turn specifically,
        // rather than clearing whatever happened to be on screen.
        socket.emit(SOCKET_EVENTS.ERROR, {
          code: isExpected ? error.code : 'INTERNAL_ERROR',
          message: isExpected ? error.message : 'Something went wrong. Please try again.',
          turnId,
        });
        respond({ success: false });
      } finally {
        socket.emit(SOCKET_EVENTS.ASSISTANT_TYPING, { sessionId: null, typing: false });
      }
    });

    socket.on('disconnect', (reason) => {
      socketLogger.info(
        { userId: auth.userId, socketId: socket.id, reason },
        'socket disconnected',
      );
    });
  });

  startRateLimitCleanup();
  return io;
};
