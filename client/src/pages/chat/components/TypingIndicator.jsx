/**
 * "The assistant is working" indicator.
 *
 * Pushed by the server the moment a turn starts, which is what makes the wait feel like a
 * conversation rather than a frozen page.
 */

import { Bot } from 'lucide-react';

const TypingIndicator = () => {
  return (
    <div className="flex gap-3" aria-live="polite">
      <div
        className="bg-secondary text-secondary-foreground flex size-8 shrink-0 items-center justify-center rounded-full"
        aria-hidden="true"
      >
        <Bot className="size-4" />
      </div>

      <div className="bg-muted flex items-center gap-1 rounded-lg px-3 py-3">
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
