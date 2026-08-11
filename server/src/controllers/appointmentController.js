/**
 * Appointment controllers.
 *
 * Note what is absent: no ownership checks, no status rules, no SQL. Those belong to the
 * service. The controller's whole job is to turn a validated request into a service call and
 * a service result into a response.
 */

import { logger } from '../logger/index.js';
import { emitAppointmentCreated } from '../realtime.js';
import appointmentService from '../services/appointmentService.js';
import chatService, { toAppointmentSummary } from '../services/chatService.js';
import { buildPaginationMeta, sendData, sendList } from '../utils/httpResponse.js';
import { toMessageView } from './chatController.js';

/**
 * Identity comes exclusively from the verified token. If this read ever moved to req.body,
 * any user could act as any other — so it lives in one helper, used everywhere.
 *
 * @returns {import('../services/appointmentService.js').Caller}
 */
const callerFrom = (req) => ({
  userId: req.auth.userId,
  businessId: req.auth.businessId,
  role: req.auth.role,
});

/**
 * Every route reading this has already passed `validate({ params: idParamSchema })`, which
 * replaces req.params with the parsed object — so the value is a verified UUID string.
 */
const idParam = (req) => req.params.id;

export const create = async (req, res) => {
  const input = req.body;
  const caller = callerFrom(req);
  const chatSessionId = input.chatSessionId ?? null;

  /*
   * Authorise the conversation before booking into it, not after.
   *
   * `chat_session_id` is a foreign key, so an id that is not a real conversation would
   * otherwise fail at the INSERT as an opaque constraint violation — and one belonging to
   * someone else would attach this appointment to their thread. Checking first turns both into
   * the ordinary 404 the rest of the API returns for a conversation that is not yours, before
   * anything has been written.
   */
  if (chatSessionId) await chatService.getOwnedSession(caller, chatSessionId);

  const appointment = await appointmentService.book(caller, {
    providerId: input.providerId,
    startsAt: new Date(input.startsAt),
    notes: input.notes ?? null,
    // A client claiming source 'chat' is harmless (it is analytics metadata), but default
    // to 'form' so only the chat service can attribute a booking to itself.
    source: 'form',
    chatSessionId,
  });

  /*
   * A booking made in the in-chat form becomes a turn of that conversation, so the thread ends
   * on the confirmation rather than on the question the form was answering. Returned in the
   * response as well as persisted: the form has no socket of its own, and this is what lets it
   * show the confirmation immediately.
   *
   * Never allowed to fail the request. The appointment is already made and confirmed by the
   * time this runs — losing a transcript entry is a cosmetic problem, and reporting a booking
   * as failed when it succeeded is not.
   */
  let chatMessage = null;

  if (chatSessionId) {
    try {
      const recorded = await chatService.recordFormBooking(caller, chatSessionId, appointment);
      chatMessage = toMessageView(recorded.message);
    } catch (error) {
      logger.error(
        { err: error, appointmentId: appointment.id, sessionId: chatSessionId },
        'could not record the booking in its conversation',
      );
    }
  }

  /*
   * The user's other tabs learn about the booking here.
   *
   * Last, and only on this path: everything above it has committed, so there is no way to
   * announce a booking that did not happen. The emit is failure-isolated inside the realtime
   * module — a socket problem must not turn a 201 into an error, because the appointment is
   * real either way and a missed broadcast costs a refresh.
   *
   * The confirmation turn rides along only when there is one, so the conversational path (where
   * ASSISTANT_REPLY already delivered it) cannot append the same message twice.
   */
  emitAppointmentCreated({
    userId: caller.userId,
    appointment: toAppointmentSummary(appointment),
    sessionId: chatSessionId,
    chatMessage,
  });

  sendData(res, { appointment, chatMessage }, 201);
};

export const list = async (req, res) => {
  const queryParams = req.query;

  const { items, total } = await appointmentService.list(callerFrom(req), {
    status: queryParams.status,
    scope: queryParams.scope,
    page: queryParams.page,
    limit: queryParams.limit,
  });

  sendList(res, items, buildPaginationMeta(queryParams.page, queryParams.limit, total));
};

export const getOne = async (req, res) => {
  const appointment = await appointmentService.getById(callerFrom(req), idParam(req));
  sendData(res, { appointment });
};

export const cancel = async (req, res) => {
  const input = req.body;
  const appointment = await appointmentService.cancel(
    callerFrom(req),
    idParam(req),
    input?.reason ?? null,
  );
  sendData(res, { appointment });
};

export const reschedule = async (req, res) => {
  const input = req.body;
  const appointment = await appointmentService.reschedule(
    callerFrom(req),
    idParam(req),
    new Date(input.startsAt),
  );
  sendData(res, { appointment });
};

export const availability = async (req, res) => {
  const queryParams = req.query;
  const result = await appointmentService.getAvailability(
    callerFrom(req),
    queryParams.providerId,
    queryParams.date,
  );
  sendData(res, result);
};

export default { create, list, getOne, cancel, reschedule, availability };
