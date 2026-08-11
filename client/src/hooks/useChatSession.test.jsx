/**
 * When a conversation comes into existence.
 *
 * The rule these protect is that a conversation is created by a *message*, never by looking at
 * the chat page or clicking New Chat. Getting that wrong is not subtle — it fills everyone's
 * sidebar with empty rows — but it is easy to reintroduce, because "make sure a session exists"
 * is the obvious thing to do on mount.
 *
 * The socket is reported disconnected throughout so sends take the REST path, which resolves
 * inline and can be asserted on. The server treats both transports identically.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import useChatSession from './useChatSession';

const listMessages = vi.fn();
const createSession = vi.fn();
const sendMessage = vi.fn();
const listSessions = vi.fn();

vi.mock('@/api/chat', () => ({
  default: {
    listMessages: (...args) => listMessages(...args),
    createSession: (...args) => createSession(...args),
    sendMessage: (...args) => sendMessage(...args),
    listSessions: (...args) => listSessions(...args),
  },
}));

vi.mock('@/hooks/useSocket', () => ({
  SOCKET_STATUS: {
    IDLE: 'idle',
    CONNECTING: 'connecting',
    CONNECTED: 'connected',
    RECONNECTING: 'reconnecting',
    DISCONNECTED: 'disconnected',
  },
  useSocket: () => ({ socket: null, status: 'disconnected' }),
}));

const wrapper = ({ children }) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
};

const turn = (userText) => ({
  ok: true,
  data: {
    userMessage: { id: 'user-1', role: 'user', content: userText, createdAt: '', reply: null },
    assistantMessage: {
      id: 'assistant-1',
      role: 'assistant',
      content: 'Hello.',
      createdAt: '',
      reply: { kind: 'message', text: 'Hello.' },
    },
    reply: { kind: 'message', text: 'Hello.' },
  },
});

/** Render on a blank thread — no `?session=` in the URL. */
const openBlank = (onResolved) => renderHook(() => useChatSession(null, onResolved), { wrapper });

beforeEach(() => {
  listMessages.mockReset();
  createSession.mockReset();
  sendMessage.mockReset();
  listSessions.mockReset();

  createSession.mockResolvedValue({ ok: true, data: { session: { id: 'session-new' } } });
  sendMessage.mockImplementation(async (_id, { content }) => turn(content));
});

describe('opening a blank conversation', () => {
  it('creates nothing', async () => {
    const { result } = openBlank();

    await waitFor(() => expect(result.current.isBootstrapping).toBe(false));

    expect(createSession).not.toHaveBeenCalled();
    expect(listMessages).not.toHaveBeenCalled();
    expect(result.current.sessionId).toBeNull();
    expect(result.current.messages).toEqual([]);
  });
});

describe('sending the first message', () => {
  it('creates exactly one conversation and sends into it', async () => {
    const onResolved = vi.fn();
    const { result } = openBlank(onResolved);
    await waitFor(() => expect(result.current.isBootstrapping).toBe(false));

    await act(async () => {
      await result.current.sendMessage('I have a rash');
    });

    expect(createSession).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith('session-new', { content: 'I have a rash' });

    // Reflected in the URL, which is what makes a refresh reopen this thread.
    expect(onResolved).toHaveBeenCalledWith('session-new');
    expect(result.current.sessionId).toBe('session-new');
  });

  it('creates one conversation even when two messages are sent at once', async () => {
    const { result } = openBlank();
    await waitFor(() => expect(result.current.isBootstrapping).toBe(false));

    // A double-tapped suggestion. Both reads of the session id happen before either resolves,
    // so without the single-flight guard this is two conversations and a lost message.
    await act(async () => {
      await Promise.all([
        result.current.sendMessage('first'),
        result.current.sendMessage('second'),
      ]);
    });

    expect(createSession).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledTimes(2);
    for (const call of sendMessage.mock.calls) {
      expect(call[0]).toBe('session-new');
    }
  });

  it('reuses the conversation for every later message', async () => {
    const { result } = openBlank();
    await waitFor(() => expect(result.current.isBootstrapping).toBe(false));

    await act(async () => {
      await result.current.sendMessage('first');
    });
    await act(async () => {
      await result.current.sendMessage('second');
    });

    expect(createSession).toHaveBeenCalledTimes(1);
  });

  it('drops the optimistic message when the conversation cannot be created', async () => {
    createSession.mockResolvedValue({
      ok: false,
      status: 500,
      error: { code: 'INTERNAL_ERROR', message: 'Could not start a conversation', details: null },
    });

    const { result } = openBlank();
    await waitFor(() => expect(result.current.isBootstrapping).toBe(false));

    await act(async () => {
      await result.current.sendMessage('I have a rash');
    });

    // Nothing was sent, and the message is not left on screen pretending it was.
    expect(sendMessage).not.toHaveBeenCalled();
    expect(result.current.messages).toEqual([]);
    expect(result.current.error).toBe('Could not start a conversation');
    expect(result.current.isAwaitingReply).toBe(false);
  });

  it('recovers on the next attempt after a failure', async () => {
    createSession.mockResolvedValueOnce({
      ok: false,
      status: 500,
      error: { code: 'INTERNAL_ERROR', message: 'nope', details: null },
    });

    const { result } = openBlank();
    await waitFor(() => expect(result.current.isBootstrapping).toBe(false));

    await act(async () => {
      await result.current.sendMessage('first try');
    });
    await act(async () => {
      await result.current.sendMessage('second try');
    });

    // The failed request must not be left cached as "the conversation".
    expect(createSession).toHaveBeenCalledTimes(2);
    expect(sendMessage).toHaveBeenCalledWith('session-new', { content: 'second try' });
  });
});

describe('opening an existing conversation', () => {
  it('loads its history and creates nothing', async () => {
    listMessages.mockResolvedValue({
      ok: true,
      data: { messages: [{ id: 'm1', role: 'user', content: 'earlier', createdAt: '' }] },
    });

    const onResolved = vi.fn();
    const { result } = renderHook(() => useChatSession('session-existing', onResolved), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isBootstrapping).toBe(false));

    expect(listMessages).toHaveBeenCalledWith('session-existing');
    expect(createSession).not.toHaveBeenCalled();
    expect(result.current.sessionId).toBe('session-existing');
    expect(result.current.messages).toHaveLength(1);
    expect(onResolved).toHaveBeenCalledWith('session-existing');
  });

  it('sends into the conversation that is already open', async () => {
    listMessages.mockResolvedValue({ ok: true, data: { messages: [] } });

    const { result } = renderHook(() => useChatSession('session-existing', null), { wrapper });
    await waitFor(() => expect(result.current.isBootstrapping).toBe(false));

    await act(async () => {
      await result.current.sendMessage('another one');
    });

    expect(createSession).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith('session-existing', { content: 'another one' });
  });

  it('appends a turn the server persisted, once', async () => {
    listMessages.mockResolvedValue({ ok: true, data: { messages: [] } });

    const { result } = renderHook(() => useChatSession('session-existing', null), { wrapper });
    await waitFor(() => expect(result.current.isBootstrapping).toBe(false));

    // The in-chat booking form completes over REST and gets its confirmation turn back in the
    // response, so there is no chat event to carry it into the thread.
    const confirmation = {
      id: 'assistant-booked',
      role: 'assistant',
      content: 'Booked with Dr. Samuel Okafor.',
      createdAt: '',
      reply: { kind: 'appointment_created', text: 'Booked.', appointment: { id: 'a1' } },
    };

    act(() => {
      result.current.appendMessage(confirmation);
    });
    // A socket may deliver the same row as well; matching on id is what stops it doubling.
    act(() => {
      result.current.appendMessage(confirmation);
    });

    expect(result.current.messages).toEqual([confirmation]);
  });

  it('falls back to a blank thread when the id in the URL is gone', async () => {
    listMessages.mockResolvedValue({
      ok: false,
      status: 404,
      error: { code: 'NOT_FOUND', message: 'Conversation not found', details: null },
    });

    const { result } = renderHook(() => useChatSession('session-deleted', null), { wrapper });
    await waitFor(() => expect(result.current.isBootstrapping).toBe(false));

    // An old bookmark should not create a conversation, and should not show an error either.
    expect(createSession).not.toHaveBeenCalled();
    expect(result.current.sessionId).toBeNull();
    expect(result.current.error).toBeNull();
  });
});
