/**
 * Server-initiated real-time fan-out.
 *
 * Socket.IO's own handlers have the io instance in scope. A REST controller does not, and
 * reaching for it by importing socket.js would close a cycle: socket.js already imports the
 * controllers' view mappers. This module is the seam between the two — `server.js` registers
 * the instance once at startup, and controllers depend on this file rather than on the
 * transport that owns it.
 *
 * It also owns the room convention, so the socket handlers and the REST layer cannot drift onto
 * two different keys. A booking emitted into `user:<id>` while a listener waits on `users:<id>`
 * is a silent nothing-happens, which is the most expensive kind of bug to go looking for.
 *
 * Having no instance is a valid state rather than an error: `createApp` is mounted on its own by
 * the HTTP test suites, which never attach a socket server. Emits become no-ops there.
 */

import { SOCKET_EVENTS } from '../../shared/constants.js';

import { socketLogger } from './logger/index.js';

let ioServer = null;
let hasWarnedUnregistered = false;

/**
 * Hand the realtime layer its Socket.IO server.
 *
 * Called by the bootstrap immediately after `attachSocketServer`, and by the socket test
 * harness, which is its own bootstrap. Pass null to unregister.
 */
export const setRealtimeServer = (io) => {
  ioServer = io;
  hasWarnedUnregistered = false;
};

/**
 * Each user has a private room, so anything announced into it reaches every tab that user has
 * open and nobody else's. Keyed by user id, never by anything a client supplied.
 */
export const roomFor = (userId) => `user:${userId}`;

/**
 * @returns {boolean} Whether the event was handed to Socket.IO. Callers ignore it — it exists
 *   so the seam's failure modes can be asserted directly.
 */
const emitToUser = (userId, event, payload) => {
  if (!ioServer) {
    /*
     * Warned once rather than per emit. A process serving HTTP with no socket server registered
     * is almost always a missed wiring line in a new bootstrap, and that should be visible —
     * but it is also the normal state of the HTTP test suites, so it must not become a flood.
     */
    if (!hasWarnedUnregistered) {
      hasWarnedUnregistered = true;
      socketLogger.warn(
        { event },
        'no socket server registered — real-time events are not being delivered',
      );
    }
    return false;
  }

  try {
    ioServer.to(roomFor(userId)).emit(event, payload);
    return true;
  } catch (error) {
    /*
     * A broadcast is a notification about work that is already committed. Losing one costs
     * somebody a refresh; letting it throw would cost the caller a response it has already
     * earned — a successful booking reported as a failure.
     */
    socketLogger.error({ err: error, event, userId }, 'could not broadcast to user');
    return false;
  }
};

/**
 * Announce a booking to every tab its owner has open.
 *
 * The same event and the same payload shape as the conversational path in socket.js, so the
 * client needs one handler for both routes into a booking: `appointment` is a
 * `ChatAppointmentSummary`, not a raw row.
 *
 * `sessionId` and `chatMessage` travel only when the booking produced a conversation turn that
 * no other event carries — the in-chat form, which completes over REST. On the conversational
 * path `ASSISTANT_REPLY` has already delivered that turn, so they are omitted and a client
 * cannot append the same message twice.
 *
 * @param {{ userId: string,
 *           appointment: import('../../shared/chat.js').ChatAppointmentSummary,
 *           sessionId?: string | null,
 *           chatMessage?: import('../../shared/chat.js').ChatMessageView | null }} input
 */
export const emitAppointmentCreated = ({
  userId,
  appointment,
  sessionId = null,
  chatMessage = null,
}) =>
  emitToUser(userId, SOCKET_EVENTS.APPOINTMENT_CREATED, {
    appointment,
    ...(chatMessage && sessionId ? { sessionId, chatMessage } : {}),
  });

export default { setRealtimeServer, roomFor, emitAppointmentCreated };
