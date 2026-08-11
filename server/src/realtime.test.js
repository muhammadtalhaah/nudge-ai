/**
 * The realtime seam, with Socket.IO stood in for.
 *
 * These are unit tests and touch no database — the seam's whole job is to decide *where* an
 * event goes, *what* travels with it, and what happens when it cannot be delivered. Getting the
 * room wrong or letting a broadcast throw are both failures a socket integration test would find
 * slowly, or not at all.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { SOCKET_EVENTS } from '../../shared/constants.js';

import { emitAppointmentCreated, roomFor, setRealtimeServer } from './realtime.js';

const APPOINTMENT = {
  id: 'appointment-1',
  providerName: 'Dr. Ada Generalist',
  providerSpecialty: 'General Practice',
  startsAt: '2030-06-12T09:30:00.000Z',
  endsAt: '2030-06-12T10:00:00.000Z',
  status: 'CONFIRMED',
};

const CHAT_MESSAGE = {
  id: 'assistant-confirmation',
  role: 'assistant',
  content: 'Booked with Dr. Ada Generalist.',
  createdAt: '2030-06-01T00:00:00.000Z',
  reply: { kind: 'appointment_created', text: 'Booked.', appointment: APPOINTMENT },
};

/** Records which room was addressed and what was emitted into it. */
const fakeIo = () => {
  const emit = vi.fn();
  const to = vi.fn(() => ({ emit }));
  return { to, emit };
};

/** An io whose emit fails, standing in for a transport that is having a bad day. */
const brokenIo = () => ({
  to: () => ({
    emit: () => {
      throw new Error('transport closed');
    },
  }),
});

afterEach(() => {
  // Module state, so one test must not leak its server into the next.
  setRealtimeServer(null);
});

describe('addressing', () => {
  it('emits into the owner’s private room and nobody else’s', () => {
    const io = fakeIo();
    setRealtimeServer(io);

    emitAppointmentCreated({ userId: 'user-1', appointment: APPOINTMENT });

    expect(io.to).toHaveBeenCalledTimes(1);
    expect(io.to).toHaveBeenCalledWith('user:user-1');
    // The one room key, shared with the socket handlers rather than spelled out twice.
    expect(io.to).toHaveBeenCalledWith(roomFor('user-1'));
  });

  it('uses the event name the client already listens for', () => {
    const io = fakeIo();
    setRealtimeServer(io);

    emitAppointmentCreated({ userId: 'user-1', appointment: APPOINTMENT });

    expect(io.emit).toHaveBeenCalledWith(SOCKET_EVENTS.APPOINTMENT_CREATED, expect.anything());
    expect(SOCKET_EVENTS.APPOINTMENT_CREATED).toBe('appointment:created');
  });
});

describe('the payload', () => {
  it('carries the appointment summary alone for a booking with no conversation', () => {
    const io = fakeIo();
    setRealtimeServer(io);

    emitAppointmentCreated({ userId: 'user-1', appointment: APPOINTMENT });

    expect(io.emit).toHaveBeenCalledWith(SOCKET_EVENTS.APPOINTMENT_CREATED, {
      appointment: APPOINTMENT,
    });
  });

  it('carries the confirmation turn for a booking made in the in-chat form', () => {
    const io = fakeIo();
    setRealtimeServer(io);

    emitAppointmentCreated({
      userId: 'user-1',
      appointment: APPOINTMENT,
      sessionId: 'session-7',
      chatMessage: CHAT_MESSAGE,
    });

    // Exactly what `messages` in the chat already holds, so the client appends it unchanged.
    expect(io.emit).toHaveBeenCalledWith(SOCKET_EVENTS.APPOINTMENT_CREATED, {
      appointment: APPOINTMENT,
      sessionId: 'session-7',
      chatMessage: CHAT_MESSAGE,
    });
  });

  it('omits the turn when there is none, so the chat path cannot append twice', () => {
    const io = fakeIo();
    setRealtimeServer(io);

    // The conversational path: ASSISTANT_REPLY has already delivered the assistant's turn.
    emitAppointmentCreated({
      userId: 'user-1',
      appointment: APPOINTMENT,
      sessionId: 'session-7',
      chatMessage: null,
    });

    const [, payload] = io.emit.mock.calls[0];
    expect(payload).not.toHaveProperty('chatMessage');
    expect(payload).not.toHaveProperty('sessionId');
  });
});

describe('failure isolation', () => {
  it('is a no-op when no socket server has been registered', () => {
    // The state of every HTTP-only test suite, and of any bootstrap that serves REST without
    // sockets. It must not be an error.
    expect(() =>
      emitAppointmentCreated({ userId: 'user-1', appointment: APPOINTMENT }),
    ).not.toThrow();

    expect(emitAppointmentCreated({ userId: 'user-1', appointment: APPOINTMENT })).toBe(false);
  });

  it('swallows a broken transport rather than failing its caller', () => {
    setRealtimeServer(brokenIo());

    /*
     * This is the constraint that matters most. The appointment is already committed by the time
     * the controller calls this, so a throw here would report a successful booking as a failure
     * and the user would try again — double-booking themselves over a dropped WebSocket.
     */
    expect(() =>
      emitAppointmentCreated({ userId: 'user-1', appointment: APPOINTMENT }),
    ).not.toThrow();

    expect(emitAppointmentCreated({ userId: 'user-1', appointment: APPOINTMENT })).toBe(false);
  });

  it('reports a delivered event', () => {
    setRealtimeServer(fakeIo());
    expect(emitAppointmentCreated({ userId: 'user-1', appointment: APPOINTMENT })).toBe(true);
  });
});
