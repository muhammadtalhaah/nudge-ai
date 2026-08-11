/**
 * "The assistant is working" indicator.
 *
 * Pushed by the server the moment a turn starts, which is what makes the wait feel like a
 * conversation rather than a frozen page.
 */

import { Bot } from 'lucide-react';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';

const TypingIndicator = () => {
  return (
    <div className="flex gap-3" aria-live="polite">
      <Avatar aria-hidden="true">
        <AvatarFallback className="bg-secondary text-secondary-foreground">
          <Bot className="size-4" />
        </AvatarFallback>
      </Avatar>

      {/* No bubble either: the dots are the assistant mid-turn, and a container here would be
          a box that vanishes the instant the reply arrives. */}
      <div className="flex items-center gap-1 py-3">
        <span className="sr-only">The assistant is typing</span>
        {[0, 150, 300].map((delay) => (
          <span
            key={delay}
            className="bg-muted-foreground/60 size-1.5 animate-bounce rounded-full"
            style={{ animationDelay: `${delay}ms` }}
            aria-hidden="true"
          />
        ))}
      </div>
    </div>
  );
};

export default TypingIndicator;
