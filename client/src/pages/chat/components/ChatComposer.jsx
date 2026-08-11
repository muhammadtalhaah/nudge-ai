/**
 * Message input.
 *
 * Enter sends, Shift+Enter adds a newline — the convention people already expect from chat.
 */

import { useState } from 'react';
import { ArrowUp } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { LIMITS } from '@shared/constants.js';

const ChatComposer = ({ onSend, disabled, isSending }) => {
  const [value, setValue] = useState('');

  const trimmed = value.trim();
  const isTooLong = value.length > LIMITS.MESSAGE_MAX_LENGTH;
  const canSend = trimmed.length > 0 && !isTooLong && !disabled;

  const submit = () => {
    if (!canSend) return;
    onSend(trimmed);
    setValue('');
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="p-3 sm-tablet:p-4"
    >
      {/*
        One rounded surface holding the field and the send control, rather than a bordered
        input with a button parked next to it. The whole thing takes the focus ring — via
        `focus-within` — so the affordance is the container the person is actually typing in.
      */}
      <div
        className={cn(
          'bg-secondary flex items-end gap-2 rounded-3xl py-2 pr-2 pl-4 transition-colors',
          'focus-within:ring-ring/60 focus-within:ring-2',
          isTooLong && 'ring-destructive ring-2',
        )}
      >
        <Label htmlFor="chat-input" className="sr-only">
          Message the assistant
        </Label>

        {/* The field carries no chrome of its own — the container above is the input. */}
        <Textarea
          id="chat-input"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Try “I need to see a dermatologist next Tuesday morning”"
          rows={1}
          className="max-h-32 min-h-9 flex-1 resize-none border-0 bg-transparent py-1.5 shadow-none focus-visible:ring-0 dark:bg-transparent"
          disabled={disabled}
          aria-invalid={isTooLong}
          aria-describedby={isTooLong ? 'chat-input-error' : undefined}
        />

        <Button
          type="submit"
          size="icon"
          className="size-9 shrink-0 rounded-full text-white"
          disabled={!canSend}
          aria-label="Send message"
        >
          {isSending ? (
            <Spinner role={undefined} aria-label={undefined} aria-hidden="true" />
          ) : (
            <ArrowUp className="size-5" aria-hidden="true" />
          )}
        </Button>
      </div>

      {isTooLong ? (
        <p id="chat-input-error" className="text-destructive mt-2 px-1 text-xs" role="alert">
          That message is too long — keep it under {LIMITS.MESSAGE_MAX_LENGTH} characters.
        </p>
      ) : null}
    </form>
  );
};

export default ChatComposer;
