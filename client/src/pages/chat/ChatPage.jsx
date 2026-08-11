/**
 * The assistant — the app's primary surface.
 *
 * A container: it owns layout and presentation, and delegates all state and transport to
 * useChatSession.
 */

import { useCallback, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bot, WifiOff } from 'lucide-react';

import ChatComposer from '@/components/chat/ChatComposer';
import ChatMessage from '@/components/chat/ChatMessage';
import StreamingMessage from '@/components/chat/StreamingMessage';
import TypingIndicator from '@/components/chat/TypingIndicator';
import ErrorState from '@/components/shared/ErrorState';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import useChatSession from '@/hooks/useChatSession';
import { SOCKET_STATUS } from '@/hooks/useSocket';

/** Concrete examples, so a first-time user knows what the assistant can actually do. */
const SUGGESTIONS = [
  'I need to see a dermatologist next Tuesday morning',
  'Book me a general check-up tomorrow at 10am',
  'What appointments do I have coming up?',
];

const ChatPage = () => {
  /**
   * Which conversation is open lives in the URL, so the sidebar can switch conversations by
   * navigation alone, and a reload or a shared link reopens the same thread.
   */
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedSessionId = searchParams.get('session');

  // Reflect whichever session actually opened — replace rather than push, so switching
  // conversations does not fill the back button with history entries.
  const handleSessionResolved = useCallback(
    (id) => {
      setSearchParams(
        (current) => {
          const params = new URLSearchParams(current);
          if (params.get('session') === id) return params;
          params.set('session', id);
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const {
    messages,
    isBootstrapping,
    isAwaitingReply,
    streamingText,
    error,
    socketStatus,
    sendMessage,
    retry,
  } = useChatSession(requestedSessionId, handleSessionResolved);

  const scrollRef = useRef(null);
  const bottomRef = useRef(null);

  // Follow the conversation as it grows. Also fires on the typing indicator and on each
  // streamed fragment, so neither the "working" state nor the growing reply slips below the
  // fold. 'auto' rather than 'smooth' while streaming: a smooth scroll re-triggered every few
  // tokens never finishes, and the view lags behind the text.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({
      behavior: streamingText ? 'auto' : 'smooth',
      block: 'end',
    });
  }, [messages, isAwaitingReply, streamingText]);

  const isOffline =
    socketStatus === SOCKET_STATUS.DISCONNECTED || socketStatus === SOCKET_STATUS.RECONNECTING;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* "New conversation" now lives in the sidebar, alongside the conversation list it
          affects, rather than being duplicated here. */}
      {/* Held to the conversation's column so the page reads as one column of content rather
          than a full-width header sitting above a narrower thread. */}

      {/* Connection state is surfaced rather than hidden — messages still send over REST. */}
      {isOffline ? (
        <Alert className="mx-auto w-full max-w-3xl">
          <WifiOff className="size-4" aria-hidden="true" />
          <AlertDescription>
            {socketStatus === SOCKET_STATUS.RECONNECTING
              ? 'Reconnecting… your messages will still send.'
              : 'Live updates are offline. Messages still send, but replies may be slower to appear.'}
          </AlertDescription>
        </Alert>
      ) : null}

      {/*
        Borderless and transparent: in the reference the conversation is the page, not a panel
        sitting on it. Card is kept for its layout rather than restyled globally — it still
        reads as a card everywhere else in the app.
      */}
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden border-0 bg-transparent p-0 shadow-none !gap-0">
        {/* aria-live so incoming assistant replies are announced without stealing focus. */}
        {/* A column rather than a plain block so the turns can sit at the bottom: `mt-auto` on
            the list pushes a short conversation down to the composer instead of stranding it at
            the top above a wall of empty card. Once the thread is long enough to scroll, the
            margin collapses and this behaves like an ordinary scroll container. */}
        <div
          ref={scrollRef}
          className="flex flex-1 flex-col overflow-y-auto p-4"
          role="log"
          aria-live="polite"
          aria-label="Conversation"
        >
          {isBootstrapping ? (
            <div className="mx-auto mt-auto w-full max-w-3xl space-y-6" aria-busy="true">
              <span className="sr-only">Loading your conversation</span>
              <Skeleton className="h-12 w-3/5" />
              <Skeleton className="ml-auto h-12 w-2/5" />
              <Skeleton className="h-20 w-4/5" />
            </div>
          ) : error && messages.length === 0 ? (
            <div className="m-auto">
              <ErrorState message={error} onRetry={retry} />
            </div>
          ) : messages.length === 0 ? (
            <Empty className="m-auto">
              <EmptyHeader>
                <EmptyMedia
                  variant="icon"
                  className="bg-secondary text-secondary-foreground rounded-full"
                >
                  <Bot aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle className="text-base">How can I help?</EmptyTitle>
                <EmptyDescription>Ask in your own words.</EmptyDescription>
              </EmptyHeader>

              <EmptyContent className="max-w-md gap-2">
                {SUGGESTIONS.map((suggestion) => (
                  <Button
                    key={suggestion}
                    variant="outline"
                    size="sm"
                    className="h-auto w-full justify-start py-2 text-left whitespace-normal"
                    onClick={() => sendMessage(suggestion)}
                  >
                    {suggestion}
                  </Button>
                ))}
              </EmptyContent>
            </Empty>
          ) : (
            // A measured column rather than the full width of the page: long assistant replies
            // are now unbubbled, so line length is what keeps them readable.
            <div className="mx-auto w-full max-w-3xl space-y-6">
              {messages.map((message, index) => (
                <ChatMessage
                  key={message.id}
                  isFirst={index === 0}
                  isLast={index === messages.length - 1}
                  message={message}
                />
              ))}

              {/* Once prose is arriving it replaces the dots — the reply itself is the better
                  progress indicator. The dots remain for the wait before the first token, and
                  for turns that do not stream at all. */}
              {streamingText ? (
                <StreamingMessage text={streamingText} />
              ) : isAwaitingReply ? (
                <TypingIndicator />
              ) : null}
            </div>
          )}

          {/* Scroll anchor. */}
          <div ref={bottomRef} />
        </div>

        {/* A send failure appears above the composer, where the retry action is. */}
        {error && messages.length > 0 ? (
          <div className="px-4 pb-2">
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          </div>
        ) : null}

        {/* Held to the same column as the conversation above it, so the composer lines up with
            the messages rather than spanning a width nothing else uses. */}
        <div className="mx-auto w-full max-w-3xl mb-5">
          <ChatComposer
            onSend={sendMessage}
            disabled={isBootstrapping}
            isSending={isAwaitingReply}
          />
        </div>
      </Card>
    </div>
  );
};

export default ChatPage;
