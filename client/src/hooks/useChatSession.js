/**
 * Chat session state and the socket wiring for one conversation.
 *
 * Owns: ensuring a session exists, replaying its history, sending over the socket, and folding
 * incoming events into local state. The page component is presentation only.
 *
 * Messages are kept in local state rather than the Query cache because they arrive by push and
 * are append-only — a cache built for request/response would be fighting the transport.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import chatApi from '@/api/chat';
import { SOCKET_STATUS, useSocket } from '@/hooks/useSocket';
import { queryKeys } from '@/config/queryKeys';
import { SOCKET_EVENTS } from '@shared/constants.js';

/**
 * @param requestedSessionId  a specific conversation to open (from the URL), or null to resume
 *                            the most recent one
 * @param onSessionResolved   called with the id actually opened, so the caller can reflect it
 *                            in the URL
 */
export const useChatSession = (requestedSessionId = null, onSessionResolved = null) => {
  const { socket, status: socketStatus } = useSocket();
  const queryClient = useQueryClient();

  const [sessionId, setSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isAwaitingReply, setIsAwaitingReply] = useState(false);
  const [error, setError] = useState(null);

  /**
   * The reply currently being written, as `{ turnId, text }`, or null between turns.
   *
   * Kept apart from `messages` rather than pushed in as a provisional entry: it has no id,
   * it is not persisted, and it may be superseded by prose the server authored instead. A
   * draft in the message list would be a message the conversation does not actually contain.
   */
  const [streamingTurn, setStreamingTurn] = useState(null);

  // Held in a ref so `bootstrap` does not change identity when the callback does, which would
  // otherwise re-run the effect and reload the conversation on every render.
  const onResolvedRef = useRef(onSessionResolved);
  onResolvedRef.current = onSessionResolved;

  // Mirrors sessionId for use inside socket handlers, which are registered once and would
  // otherwise close over a stale value.
  const sessionIdRef = useRef(null);
  const setSession = useCallback((id) => {
    sessionIdRef.current = id;
    setSessionId(id);
  }, []);

  /**
   * Open a conversation: the one asked for, else the most recent, else a new one.
   *
   * Resuming rather than always creating means a refresh does not lose the thread, and it
   * exercises the stored structured payloads — a reloaded conversation still shows its
   * prefilled forms and doctor cards.
   */
  const bootstrap = useCallback(async () => {
    setIsBootstrapping(true);
    setError(null);
    // A draft belongs to the conversation that was open when it started.
    setStreamingTurn(null);

    const open = async (id) => {
      const historyResult = await chatApi.listMessages(id);
      if (!historyResult.ok) {
        // A stale id in the URL (deleted, or someone else's) reads as not-found. Fall back to
        // resuming rather than showing an error for what is usually just an old bookmark.
        if (historyResult.error.code === 'NOT_FOUND') return false;
        setError(historyResult.error.message);
        setIsBootstrapping(false);
        return true;
      }
      setSession(id);
      setMessages(historyResult.data.messages);
      onResolvedRef.current?.(id);
      setIsBootstrapping(false);
      return true;
    };

    if (requestedSessionId && (await open(requestedSessionId))) return;

    const sessionsResult = await chatApi.listSessions();
    if (!sessionsResult.ok) {
      setError(sessionsResult.error.message);
      setIsBootstrapping(false);
      return;
    }

    const existing = sessionsResult.data.sessions.find((session) => session.status === 'active');
    if (existing && (await open(existing.id))) return;

    const created = await chatApi.createSession({});
    if (!created.ok) {
      setError(created.error.message);
      setIsBootstrapping(false);
      return;
    }

    setSession(created.data.session.id);
    setMessages([]);
    onResolvedRef.current?.(created.data.session.id);
    setIsBootstrapping(false);
    void queryClient.invalidateQueries({ queryKey: queryKeys.chat.sessions });
  }, [requestedSessionId, setSession, queryClient]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  /** Fold socket events into local state. */
  useEffect(() => {
    if (!socket) return undefined;

    const appendUnlessPresent = (incoming) => {
      setMessages((current) =>
        // The sender already has an optimistic copy; matching on id keeps it from doubling.
        current.some((message) => message.id === incoming.id) ? current : [...current, incoming],
      );
    };

    const handleUserMessage = ({ sessionId: eventSessionId, message }) => {
      if (eventSessionId !== sessionIdRef.current) return;
      setMessages((current) => {
        // Replace the optimistic placeholder with the persisted row.
        const withoutPending = current.filter((existing) => !existing.isPending);
        return withoutPending.some((existing) => existing.id === message.id)
          ? withoutPending
          : [...withoutPending, message];
      });
    };

    /**
     * A fragment of prose. Appends when it belongs to the turn already on screen, and starts
     * a fresh one otherwise — so a second turn cannot graft its text onto the first.
     */
    const handleDelta = ({ sessionId: eventSessionId, turnId, delta }) => {
      if (eventSessionId !== sessionIdRef.current || !delta) return;
      setStreamingTurn((current) =>
        current?.turnId === turnId
          ? { turnId, text: current.text + delta }
          : { turnId, text: delta },
      );
    };

    const handleAssistantReply = ({ sessionId: eventSessionId, message }) => {
      if (eventSessionId !== sessionIdRef.current) return;
      // The draft is retired in the same update as the real message, so the bubble is
      // replaced rather than briefly disappearing.
      setStreamingTurn(null);
      appendUnlessPresent(message);
      setIsAwaitingReply(false);
      // The sidebar list is ordered by last activity, and a conversation's title is derived
      // from its first message — so it needs refreshing after a completed turn.
      void queryClient.invalidateQueries({ queryKey: queryKeys.chat.sessions });
    };

    const handleTyping = ({ typing }) => {
      setIsAwaitingReply(Boolean(typing));
      // The server sends this last, whatever the outcome — so it also clears a draft left
      // behind by a turn that ended without a reply.
      if (!typing) setStreamingTurn(null);
    };

    const handleAppointmentCreated = () => {
      // A booking made in conversation must show up on the appointments page without a reload.
      void queryClient.invalidateQueries({ queryKey: queryKeys.appointments.all });
    };

    const handleError = (payload) => {
      setError(payload?.message ?? 'Something went wrong.');
      setIsAwaitingReply(false);
      // A half-written reply is not an answer. Dropping it is what stops a failed turn from
      // leaving a truncated sentence on screen as though the assistant had finished.
      setStreamingTurn(null);
      // Drop the optimistic message: it was never persisted, so leaving it would misrepresent
      // the conversation.
      setMessages((current) => current.filter((message) => !message.isPending));
    };

    socket.on(SOCKET_EVENTS.MESSAGE_RECEIVED, handleUserMessage);
    socket.on(SOCKET_EVENTS.ASSISTANT_DELTA, handleDelta);
    socket.on(SOCKET_EVENTS.ASSISTANT_REPLY, handleAssistantReply);
    socket.on(SOCKET_EVENTS.ASSISTANT_TYPING, handleTyping);
    socket.on(SOCKET_EVENTS.APPOINTMENT_CREATED, handleAppointmentCreated);
    socket.on(SOCKET_EVENTS.ERROR, handleError);

    return () => {
      socket.off(SOCKET_EVENTS.MESSAGE_RECEIVED, handleUserMessage);
      socket.off(SOCKET_EVENTS.ASSISTANT_DELTA, handleDelta);
      socket.off(SOCKET_EVENTS.ASSISTANT_REPLY, handleAssistantReply);
      socket.off(SOCKET_EVENTS.ASSISTANT_TYPING, handleTyping);
      socket.off(SOCKET_EVENTS.APPOINTMENT_CREATED, handleAppointmentCreated);
      socket.off(SOCKET_EVENTS.ERROR, handleError);
    };
  }, [socket, queryClient]);

  /**
   * Send a message.
   *
   * Prefers the socket, and falls back to the REST endpoint when it is not connected — the
   * server treats both identically, so a dropped WebSocket degrades the experience without
   * breaking it.
   */
  const sendMessage = useCallback(
    async (content) => {
      const trimmed = content.trim();
      if (!trimmed || !sessionIdRef.current) return;

      setError(null);
      setIsAwaitingReply(true);

      // Optimistic echo so the message appears instantly.
      const optimistic = {
        id: `pending-${Date.now()}`,
        role: 'user',
        content: trimmed,
        createdAt: new Date().toISOString(),
        reply: null,
        isPending: true,
      };
      setMessages((current) => [...current, optimistic]);

      if (socket && socketStatus === SOCKET_STATUS.CONNECTED) {
        socket.emit(SOCKET_EVENTS.MESSAGE_SEND, {
          sessionId: sessionIdRef.current,
          content: trimmed,
        });
        return;
      }

      const result = await chatApi.sendMessage(sessionIdRef.current, { content: trimmed });

      if (!result.ok) {
        setError(result.error.message);
        setIsAwaitingReply(false);
        setMessages((current) => current.filter((message) => !message.isPending));
        return;
      }

      setMessages((current) => [
        ...current.filter((message) => !message.isPending),
        result.data.userMessage,
        result.data.assistantMessage,
      ]);
      setIsAwaitingReply(false);
      void queryClient.invalidateQueries({ queryKey: queryKeys.appointments.all });
    },
    [socket, socketStatus, queryClient],
  );

  /** Leave this conversation and start a fresh one. */
  const startNewConversation = useCallback(async () => {
    const created = await chatApi.createSession({});
    if (!created.ok) {
      setError(created.error.message);
      return null;
    }
    setSession(created.data.session.id);
    setMessages([]);
    setError(null);
    setStreamingTurn(null);
    onResolvedRef.current?.(created.data.session.id);
    void queryClient.invalidateQueries({ queryKey: queryKeys.chat.sessions });
    return created.data.session.id;
  }, [setSession, queryClient]);

  return {
    sessionId,
    messages,
    isBootstrapping,
    isAwaitingReply,
    /**
     * The reply as far as it has been written. Empty string when nothing is streaming — which
     * includes every REST-fallback turn and every turn served by the offline provider, so the
     * page must still handle a reply that simply appears.
     */
    streamingText: streamingTurn?.text ?? '',
    error,
    socketStatus,
    sendMessage,
    startNewConversation,
    retry: bootstrap,
  };
};

export default useChatSession;
