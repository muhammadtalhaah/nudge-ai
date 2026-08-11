/**
 * How pushed server events fold into an open conversation.
 *
 * Separate from useChatSession.test.jsx because that file deliberately reports the socket
 * disconnected, to drive sends down the REST path. Here the socket is connected and a fake one
 * stands in for it, so the handlers the hook registers can be driven directly.
 *
 * The rule worth protecting is idempotence. A booking made in the in-chat form completes over
 * REST: the tab that made it appends the confirmation turn from the response, and then receives
 * its own broadcast back, because the event goes to every tab the user has open. A second copy
 * of that turn in the transcript would read as two bookings.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SOCKET_EVENTS } from '@shared/constants.js';

import useChatSession from './useChatSession';

const listMessages = vi.fn();

vi.mock('@/api/chat', () => ({
  default: {
    listMessages: (...args) => listMessages(...args),
    createSession: vi.fn(),
    sendMessage: vi.fn(),
    listSessions: vi.fn(),
  },
}));

// Hoisted so the mock factory below can reach it — the factory runs before the module body.
const socketRef = vi.hoisted(() => ({ current: null }));

vi.mock('@/hooks/useSocket', () => ({
  SOCKET_STATUS: {
    IDLE: 'idle',
    CONNECTING: 'connecting',
    CONNECTED: 'connected',
    RECONNECTING: 'reconnecting',
    DISCONNECTED: 'disconnected',
  },
  useSocket: () => ({ socket: socketRef.current, status: 'connected' }),
}));

/** Records what the hook subscribed to, and lets a test push a server event at it. */
const createFakeSocket = () => {
  const handlers = new Map();

  return {
    on: (event, handler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    off: (event, handler) => {
      handlers.set(
        event,
        (handlers.get(event) ?? []).filter((existing) => existing !== handler),
      );
    },
    emit: vi.fn(),
    deliver: (event, payload) => {
      for (const handler of handlers.get(event) ?? []) handler(payload);
    },
  };
};

const wrapper = ({ children }) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
};

const SESSION_ID = 'session-open';

/** The turn the server records for a booking finished in the in-chat form. */
const CONFIRMATION = {
  id: 'assistant-booked',
  role: 'assistant',
  content: 'Booked with Dr. Ada Generalist.',
  createdAt: '',
  reply: {
    kind: 'appointment_created',
    text: 'Booked with Dr. Ada Generalist.',
    appointment: { id: 'appointment-1', providerName: 'Dr. Ada Generalist', status: 'CONFIRMED' },
  },
};

const APPOINTMENT = { id: 'appointment-1', providerName: 'Dr. Ada Generalist' };

const openSession = async () => {
  const rendered = renderHook(() => useChatSession(SESSION_ID, null), { wrapper });
  await waitFor(() => expect(rendered.result.current.isBootstrapping).toBe(false));
  return rendered;
};

const deliver = (payload) =>
  act(() => {
    socketRef.current.deliver(SOCKET_EVENTS.APPOINTMENT_CREATED, payload);
  });

beforeEach(() => {
  listMessages.mockReset();
  listMessages.mockResolvedValue({ ok: true, data: { messages: [] } });
  socketRef.current = createFakeSocket();
});

describe('a booking announced over the socket', () => {
  it('adds the confirmation turn to the open conversation', async () => {
    const { result } = await openSession();

    deliver({ appointment: APPOINTMENT, sessionId: SESSION_ID, chatMessage: CONFIRMATION });

    expect(result.current.messages).toEqual([CONFIRMATION]);
  });

  it('adds it only once, however many times it arrives', async () => {
    const { result } = await openSession();

    // The tab that made the booking already appended this from the REST response, and the
    // broadcast goes to every tab including that one.
    deliver({ appointment: APPOINTMENT, sessionId: SESSION_ID, chatMessage: CONFIRMATION });
    deliver({ appointment: APPOINTMENT, sessionId: SESSION_ID, chatMessage: CONFIRMATION });
    deliver({ appointment: APPOINTMENT, sessionId: SESSION_ID, chatMessage: CONFIRMATION });

    expect(result.current.messages).toEqual([CONFIRMATION]);
  });

  it('ignores a turn belonging to a different conversation', async () => {
    const { result } = await openSession();

    // Rooms are per user, not per conversation, so a tab reading one thread is told about a
    // booking made in another. It must not graft that turn onto what is on screen.
    deliver({
      appointment: APPOINTMENT,
      sessionId: 'session-elsewhere',
      chatMessage: CONFIRMATION,
    });

    expect(result.current.messages).toEqual([]);
  });

  it('adds nothing for a booking the assistant made itself', async () => {
    const { result } = await openSession();

    // The conversational path omits the turn: ASSISTANT_REPLY has already delivered it.
    deliver({ appointment: APPOINTMENT });

    expect(result.current.messages).toEqual([]);
  });
});
