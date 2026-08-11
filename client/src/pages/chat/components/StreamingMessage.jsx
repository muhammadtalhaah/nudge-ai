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

import { Avatar, AvatarFallback } from '@/components/ui/avatar';

const StreamingMessage = ({ text }) => (
  <div className="flex gap-3">
    <Avatar aria-hidden="true">
      <AvatarFallback className="bg-secondary text-secondary-foreground">
        <Bot className="size-4" />
      </AvatarFallback>
    </Avatar>

    <div className="sm-tablet:max-w-[75%] min-w-0 max-w-[85%]">
      {/* Static, so it is announced on appearance and not repeated as the text grows. */}
      <span className="sr-only">The assistant is replying</span>

      {/* Unbubbled, exactly like the finished assistant turn it becomes — otherwise the reply
          visibly changes shape at the moment streaming ends. */}
      <div className="text-foreground text-left text-sm whitespace-pre-wrap" aria-hidden="true">
        {text}
        <span className="bg-foreground/70 ml-0.5 inline-block h-3.5 w-0.5 translate-y-0.5 animate-pulse rounded-full" />
      </div>
    </div>
  </div>
);

export default StreamingMessage;
