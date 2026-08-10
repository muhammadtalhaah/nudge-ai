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
import { formatDateTime } from '@/utils/formatDate';

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

const BookedConfirmation = ({ appointment }) => (
  <div className="border-status-confirmed/40 bg-status-confirmed/10 mt-3 flex items-start gap-2 rounded-md border px-3 py-2">
    <CalendarCheck
      className="text-status-confirmed-foreground mt-0.5 size-4 shrink-0"
      aria-hidden="true"
    />
    <div className="min-w-0 text-sm">
      <p className="font-medium">{appointment.providerName}</p>
      <p className="text-muted-foreground text-xs">
        {formatDateTime(appointment.startsAt)} · {appointment.providerSpecialty}
      </p>
    </div>
  </div>
);

const ChatMessage = ({ message, onBooked }) => {
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

        <div
          className={cn(
            'inline-block rounded-lg px-3 py-2 text-left text-sm whitespace-pre-wrap',
            isUser ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground',
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

            {reply.kind === 'form_fallback' ? (
              <Card className="mt-3">
                <CardContent className="space-y-3 p-3">
                  <div className="text-muted-foreground flex items-center gap-2 text-xs font-medium">
                    <ClipboardList className="size-3.5" aria-hidden="true" />
                    Finish the details
                  </div>

                  {/* Candidate doctors, when the assistant is narrowing a choice. */}
                  {reply.providers?.length > 1 ? (
                    <ProviderOptions providers={reply.providers} />
                  ) : null}

                  {/* The required fallback: prefilled with whatever was understood, with the
                      still-missing fields marked so the user knows what to supply. */}
                  <BookingForm
                    prefill={reply.prefill}
                    highlight={reply.missing ?? []}
                    onBooked={onBooked}
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
