/**
 * The reply as it is being written.
 *
 * Deliberately thinner than ChatMessage: prose and a caret, no doctor cards, no confirmation,
 * no booking form. Those parts are built by the server from real records and arrive only with
 * the finished turn — a partial reply is something to read, never something to act on.
 *
 * The text is hidden from assistive technology. The conversation log is an aria-live region,
 * and a value that changes on every token would be announced dozens of times per reply. The
 * completed message is announced once, which is the useful version of the same information.
 */

import { Bot } from 'lucide-react';

const StreamingMessage = ({ text }) => (
  <div className="flex gap-3">
    <div
      className="bg-secondary text-secondary-foreground flex size-8 shrink-0 items-center justify-center rounded-full"
      aria-hidden="true"
    >
      <Bot className="size-4" />
    </div>

    <div className="sm-tablet:max-w-[75%] min-w-0 max-w-[85%]">
      {/* Static, so it is announced on appearance and not repeated as the text grows. */}
      <span className="sr-only">The assistant is replying</span>

      <div
        className="bg-muted text-foreground inline-block rounded-lg px-3 py-2 text-left text-sm whitespace-pre-wrap"
        aria-hidden="true"
      >
        {text}
        <span className="bg-foreground/70 ml-0.5 inline-block h-3.5 w-0.5 translate-y-0.5 animate-pulse rounded-full" />
      </div>
    </div>
  </div>
);

export default StreamingMessage;
