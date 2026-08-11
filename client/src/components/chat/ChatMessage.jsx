/**
 * One turn of conversation.
 *
 * An assistant turn may carry a structured payload alongside its prose — doctor cards, a list
 * of appointments, a confirmation, or the prefilled booking form. Those parts are built by the
 * server from real records, never authored by the model, so nothing rendered here can be a
 * hallucinated appointment.
 */

import { Bot, CalendarCheck, ClipboardList } from 'lucide-react';

import AppStatusBadge from '@/components/shared/AppStatusBadge';
import BookingForm from '@/components/shared/BookingForm';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { formatDateTime, formatTime } from '@/utils/formatDate';

const ProviderOptions = ({ providers }) => (
  <ul className="mt-3 grid gap-2">
    {providers.map((provider) => (
      <li key={provider.id} className="bg-background/60 rounded-md border px-3 py-2 text-sm">
        <p className="font-medium">{provider.fullName}</p>
        <p className="text-muted-foreground text-xs">
          {provider.specialty} · {provider.slotDurationMinutes} min appointments
        </p>
      </li>
    ))}
  </ul>
);

/**
 * Free start times for one doctor on one day.
 *
 * The server sends instants, not "10:00", so these are formatted here in the viewer's own
 * timezone — the same rule the appointment cards follow, and the reason no time appears in
 * the assistant's prose above them.
 */
const SlotList = ({ slots }) => (
  <ul className="mt-3 flex flex-wrap gap-1.5">
    {slots.map((slot) => (
      <li
        key={slot}
        className="bg-background/60 rounded-md border px-2 py-1 font-mono text-xs tabular-nums"
      >
        {formatTime(slot)}
      </li>
    ))}
  </ul>
);

const AppointmentList = ({ appointments }) => {
  if (appointments.length === 0) return null;

  return (
    <ul className="mt-3 grid gap-2">
      {appointments.map((appointment) => (
        <li key={appointment.id} className="bg-background/60 rounded-md border px-3 py-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{appointment.providerName}</p>
              <p className="text-muted-foreground text-xs">
                {formatDateTime(appointment.startsAt)}
              </p>
            </div>
            <AppStatusBadge status={appointment.status} />
          </div>
        </li>
      ))}
    </ul>
  );
};

/**
 * The confirmation card, shown for both routes into a booking — one the assistant completed
 * itself, and one finished in the form below its question.
 *
 * The time is formatted here and nowhere else: the server knows the clinic's timezone and only
 * the browser knows the viewer's, so the prose above deliberately names no time.
 */
const BookedConfirmation = ({ appointment }) => (
  <div className="border-status-confirmed/40 bg-status-confirmed/10 mt-3 flex items-start gap-2 rounded-md border px-3 py-2">
    <CalendarCheck
      className="text-status-confirmed-foreground mt-0.5 size-4 shrink-0"
      aria-hidden="true"
    />
    <div className="flex min-w-0 flex-1 items-start justify-between gap-2">
      <div className="min-w-0 text-sm">
        <p className="font-medium">{appointment.providerName}</p>
        <p className="text-muted-foreground text-xs">
          {formatDateTime(appointment.startsAt)} · {appointment.providerSpecialty}
        </p>
      </div>
      {/* The same badge the appointments page uses, so a confirmation reads identically
          wherever it appears. */}
      <AppStatusBadge status={appointment.status} />
    </div>
  </div>
);

/**
 * @param isBookingResolved a later turn in this conversation is a completed booking, so this
 *   turn's form has been answered and is not rendered again
 */
const ChatMessage = ({ message, onBooked, chatSessionId, isBookingResolved, isFirst, isLast }) => {
  const isUser = message.role === 'user';
  const reply = message.reply;

  return (
    <div className={cn('flex gap-3', isUser && 'flex-row-reverse')}>
      {/*
       * Only the assistant gets an avatar. Marking both sides is redundant — alignment and
       * bubble colour already say who is speaking — and the user's own avatar is the one that
       * adds nothing, since there is exactly one of them and they are reading their own screen.
       * Dropping it also stops the right-hand column from being indented away from the edge.
       */}
      {isUser ? null : (
        <Avatar className="ring-border/60 ring-1" aria-hidden="true">
          <AvatarFallback className="bg-secondary text-secondary-foreground">
            <Bot className="size-4" />
          </AvatarFallback>
        </Avatar>
      )}

      <div className={cn('min-w-0 max-w-[85%] sm-tablet:max-w-[75%]', isUser && 'text-right')}>
        {/* Names the speaker for screen readers, which cannot see the avatar or alignment. */}
        <span className="sr-only">{isUser ? 'You said' : 'Assistant said'}:</span>

        {/*
          Only the user's turn is a bubble.

          That asymmetry is the reference's, and it is doing real work: the assistant speaks in
          long form and a container around every reply turns the thread into a wall of boxes,
          while the user's turns are short and need the bubble to read as theirs. Alignment and
          the avatar already say who is speaking, so the assistant's surface is the page itself.
        */}
        <div
          className={cn(
            'text-left text-base whitespace-pre-wrap',
            isUser
              ? 'bg-secondary text-secondary-foreground inline-block rounded-3xl px-4 py-2.5'
              : 'text-foreground',
            isUser && isFirst && 'mt-10',
            isUser && isLast && 'mb-10',
            message.isPending && 'opacity-60',
          )}
        >
          {message.content}
        </div>

        {/* Structured parts, assistant turns only. */}
        {!isUser && reply ? (
          <div className="text-left">
            {reply.kind === 'appointment_created' && reply.appointment ? (
              <BookedConfirmation appointment={reply.appointment} />
            ) : null}

            {reply.kind === 'appointment_list' && reply.appointments ? (
              <AppointmentList appointments={reply.appointments} />
            ) : null}

            {reply.kind === 'provider_list' && reply.providers ? (
              <ProviderOptions providers={reply.providers} />
            ) : null}

            {/* Free times, read off the real calendar rather than claimed by the model. */}
            {reply.kind === 'slot_list' && reply.slots ? <SlotList slots={reply.slots} /> : null}

            {/*
              The form is dropped once the booking it was collecting has been made — the
              confirmation turn below it is the answer, and leaving a live form above it invites
              a second booking of the same appointment. Derived from the transcript rather than
              from local state, so a reload shows the same thing: this mirrors the server, where
              `findBookingDraft` also treats a completed booking as the end of the draft.

              The assistant's question is left standing. It is what was actually said, and the
              thread reads as a conversation that reached an answer.
            */}
            {reply.kind === 'form_fallback' && !isBookingResolved ? (
              <Card className="mt-3">
                <CardContent className="space-y-3 p-3">
                  <div className="text-muted-foreground flex items-center gap-2 text-xs font-medium">
                    <ClipboardList className="size-3.5" aria-hidden="true" />
                    Finish the details
                  </div>

                  {/* Candidate providers, when the assistant is narrowing a choice. */}
                  {reply.providers?.length > 1 ? (
                    <ProviderOptions providers={reply.providers} />
                  ) : null}

                  {/* The required fallback: prefilled with whatever was understood, with the
                      still-missing fields marked so the user knows what to supply. */}
                  <BookingForm
                    prefill={reply.prefill}
                    highlight={reply.missing ?? []}
                    onBooked={onBooked}
                    chatSessionId={chatSessionId}
                    compact
                  />
                </CardContent>
              </Card>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default ChatMessage;
