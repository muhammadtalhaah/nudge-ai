/**
 * One turn of conversation.
 *
 * An assistant turn may carry a structured payload alongside its prose — doctor cards, a list
 * of appointments, a confirmation, or the prefilled booking form. Those parts are built by the
 * server from real records, never authored by the model, so nothing rendered here can be a
 * hallucinated appointment.
 */

import { useState } from 'react';
import { Bot, CalendarCheck, ClipboardList } from 'lucide-react';

import AppStatusBadge from '@/components/shared/AppStatusBadge';
import BookingForm from '@/components/shared/BookingForm';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useClinicTimezone } from '@/context/AuthContext';
import { cn } from '@/lib/utils';
import { formatDateTime, formatTime, zoneLabel } from '@/utils/formatDate';

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
 * The server sends instants, not "10:00", so the zone is chosen here — and it is the clinic's,
 * carried on the reply itself. These are times to be at a clinic, so drawing them in the reader's
 * zone silently renames them: a clinic on UTC offering a 09:00 was displayed as "14:00" to
 * someone five hours east, under a sentence that said morning.
 *
 * The zone is named next to the list for the same reason. Anyone whose own clock disagrees needs
 * to be told which one they are reading, and a caption is cheaper than them finding out at the
 * appointment.
 */
const SlotList = ({ slots, timeZone }) => (
  <div className="mt-3">
    <ul className="flex flex-wrap gap-1.5">
      {slots.map((slot) => (
        <li
          key={slot}
          className="bg-background/60 rounded-md border px-2 py-1 font-mono text-xs tabular-nums"
        >
          {formatTime(slot, timeZone)}
        </li>
      ))}
    </ul>

    {timeZone ? (
      <p className="text-muted-foreground mt-1.5 text-xs">
        Clinic time ({zoneLabel(timeZone, slots[0])})
      </p>
    ) : null}
  </div>
);

const AppointmentList = ({ appointments, timeZone }) => {
  if (appointments.length === 0) return null;

  return (
    <ul className="mt-3 grid gap-2">
      {appointments.map((appointment) => (
        <li key={appointment.id} className="bg-background/60 rounded-md border px-3 py-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{appointment.providerName}</p>
              <p className="text-muted-foreground text-xs">
                {formatDateTime(appointment.startsAt, timeZone)}
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
 * The time is formatted here and nowhere else, which is why the prose above names none: one
 * place to render an instant, and one zone — the clinic's — so a confirmation cannot disagree
 * with the slot that was picked to make it.
 */
const BookedConfirmation = ({ appointment, timeZone }) => (
  <div className="border-status-confirmed/40 bg-status-confirmed/10 mt-3 flex items-start gap-2 rounded-md border px-3 py-2">
    <CalendarCheck
      className="text-status-confirmed-foreground mt-0.5 size-4 shrink-0"
      aria-hidden="true"
    />
    <div className="flex min-w-0 flex-1 items-start justify-between gap-2">
      <div className="min-w-0 text-sm">
        <p className="font-medium">{appointment.providerName}</p>
        <p className="text-muted-foreground text-xs">
          {formatDateTime(appointment.startsAt, timeZone)} · {appointment.providerSpecialty}
        </p>
      </div>
      {/* The same badge the appointments page uses, so a confirmation reads identically
          wherever it appears. */}
      <AppStatusBadge status={appointment.status} />
    </div>
  </div>
);

/**
 * The structured form, in the card it occupies inside a chat bubble.
 *
 * Shared by both incomplete-booking kinds so they cannot drift into two different forms:
 * `form_fallback` renders it open, and `needs_detail` keeps it behind a disclosure.
 *
 * @param withProviders whether to list the candidate providers inside the card. False when the
 *   caller has already shown them under the assistant's question, which is where they answer it.
 */
const BookingDetailsCard = ({ reply, onBooked, chatSessionId, withProviders = true }) => (
  <Card className="mt-3">
    <CardContent className="space-y-3 p-3">
      <div className="text-muted-foreground flex items-center gap-2 text-xs font-medium">
        <ClipboardList className="size-3.5" aria-hidden="true" />
        Finish the details
      </div>

      {/* Candidate providers, when the assistant is narrowing a choice. */}
      {withProviders && reply.providers?.length > 1 ? (
        <ProviderOptions providers={reply.providers} />
      ) : null}

      {/* Prefilled with whatever was understood, with the still-missing fields marked so the
          user knows what to supply. */}
      <BookingForm
        prefill={reply.prefill}
        highlight={reply.missing ?? []}
        onBooked={onBooked}
        chatSessionId={chatSessionId}
        compact
      />
    </CardContent>
  </Card>
);

/**
 * @param isBookingResolved a later turn in this conversation is a completed booking, so this
 *   turn's form has been answered and is not rendered again
 */
const ChatMessage = ({ message, onBooked, chatSessionId, isBookingResolved, isFirst, isLast }) => {
  const isUser = message.role === 'user';
  const reply = message.reply;
  const clinicTimezone = useClinicTimezone();

  /**
   * Whether the person asked for the form on a turn where the assistant only asked a question.
   *
   * Closed by default, which is the whole point: the assistant is mid-conversation, and opening
   * a booking form to collect a day makes it a wrapper around the form it replaced. The
   * disclosure is still there because someone who would rather fill in four fields than have a
   * conversation should not have to talk their way to it.
   */
  const [isFormOpen, setIsFormOpen] = useState(false);

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
              <BookedConfirmation appointment={reply.appointment} timeZone={clinicTimezone} />
            ) : null}

            {reply.kind === 'appointment_list' && reply.appointments ? (
              <AppointmentList appointments={reply.appointments} timeZone={clinicTimezone} />
            ) : null}

            {reply.kind === 'provider_list' && reply.providers ? (
              <ProviderOptions providers={reply.providers} />
            ) : null}

            {/* Free times, read off the real calendar rather than claimed by the model. */}
            {reply.kind === 'slot_list' && reply.slots ? (
              // The zone the server computed these in, preferred over the session's: a
              // conversation replayed from history then still reads in the zone its times were
              // resolved for, even if the clinic has since been reconfigured.
              <SlotList slots={reply.slots} timeZone={reply.slotTimezone ?? clinicTimezone} />
            ) : null}

            {/*
              The assistant is still gathering details and has asked for them in the sentence
              above. So the answer is the conversation, and the form stays shut behind a
              disclosure — the person can reply "Tuesday" and never see a form at all.

              Candidate providers sit outside it, because when the question is "which of these
              doctors?" the cards are the answer to it rather than an aid to filling in a field.
            */}
            {reply.kind === 'needs_detail' && !isBookingResolved ? (
              <div className="mt-3">
                {reply.providers?.length > 1 ? (
                  <ProviderOptions providers={reply.providers} />
                ) : null}

                {isFormOpen ? (
                  <BookingDetailsCard
                    reply={reply}
                    onBooked={onBooked}
                    chatSessionId={chatSessionId}
                    withProviders={false}
                  />
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground -ml-2"
                    aria-expanded={false}
                    onClick={() => setIsFormOpen(true)}
                  >
                    <ClipboardList className="size-3.5" aria-hidden="true" />
                    Fill in the details instead
                  </Button>
                )}
              </div>
            ) : null}

            {/*
              The required fallback, opened: the assistant is stuck rather than curious. Asking
              again in prose would repeat the turn that just failed.

              Either form is dropped once the booking it was collecting has been made — the
              confirmation turn below it is the answer, and leaving a live form above it invites
              a second booking of the same appointment. Derived from the transcript rather than
              from local state, so a reload shows the same thing: this mirrors the server, where
              `findBookingDraft` also treats a completed booking as the end of the draft.

              The assistant's question is left standing. It is what was actually said, and the
              thread reads as a conversation that reached an answer.
            */}
            {reply.kind === 'form_fallback' && !isBookingResolved ? (
              <BookingDetailsCard reply={reply} onBooked={onBooked} chatSessionId={chatSessionId} />
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
};

export default ChatMessage;
