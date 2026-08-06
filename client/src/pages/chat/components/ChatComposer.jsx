/**
 * Message input.
 *
 * Enter sends, Shift+Enter adds a newline — the convention people already expect from chat.
 */

import { useState } from 'react';
import { Loader2, SendHorizontal } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { LIMITS } from '@shared/constants.ts';

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
      className="border-t p-3 sm-tablet:p-4"
    >
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <label htmlFor="chat-input" className="sr-only">
            Message the assistant
          </label>
          <Textarea
            id="chat-input"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Try “I need to see a dermatologist next Tuesday morning”"
            rows={1}
            className="max-h-32 min-h-10 resize-none"
            disabled={disabled}
            aria-invalid={isTooLong}
            aria-describedby={isTooLong ? 'chat-input-error' : undefined}
          />
          {isTooLong ? (
            <p id="chat-input-error" className="text-destructive mt-1 text-xs" role="alert">
              That message is too long — keep it under {LIMITS.MESSAGE_MAX_LENGTH} characters.
            </p>
          ) : null}
        </div>

        <Button type="submit" size="icon" disabled={!canSend} aria-label="Send message">
          {isSending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <SendHorizontal className="size-4" aria-hidden="true" />
          )}
        </Button>
      </div>
    </form>
  );
};

export default ChatComposer;
