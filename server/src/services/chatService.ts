/**
 * Conversational booking.
 *
 * `handleMessage` is the single entry point for a chat turn. Both the REST endpoint and the
 * Socket.IO handler call it, so there is exactly one implementation of the conversation
 * rules and the WebSocket layer is pure transport.
 *
 * The division of labour that matters:
 *   the model  — reads prose, returns an intent and some strings
 *   this file  — decides what that means against real data
 *   appointmentService — performs and validates the booking
 *
 * The model cannot book, cancel, or read anything. It never sees an appointment id, and it is
 * never asked to authorise. If it hallucinates a doctor, resolution fails here and the user
 * gets the structured form.
 */

import type { BookingFormPrefill, ChatAppointmentSummary, ChatReply } from '@shared/chat.ts';
import {
  APPOINTMENT_STATUS,
  CHAT_INTENTS,
  CHAT_ROLES,
  REPLY_KIND,
  type BookingField,
} from '@shared/constants.ts';
import type { AiExtraction } from '@shared/schemas.ts';

import { extract, getProvider } from '../ai/extraction.ts';
import { zonedDateTimeToUtc } from '../ai/naturalDate.ts';
import { buildSystemPrompt } from '../ai/prompts.ts';
import type { CompletionContext } from '../ai/provider.ts';
import { env } from '../config/env.ts';
import { pool, withTransaction } from '../db/pool.ts';
import { AppError, NotFoundError } from '../errors/AppError.ts';
import { aiLogger } from '../logger/index.ts';
import aiLogRepository from '../repositories/aiLogRepository.ts';
import appointmentRepository, { type Appointment } from '../repositories/appointmentRepository.ts';
import businessRepository from '../repositories/businessRepository.ts';
import chatRepository, {
  type ChatMessage,
  type ChatSession,
} from '../repositories/chatRepository.ts';
import providerRepository from '../repositories/providerRepository.ts';
import appointmentService, { type Caller } from './appointmentService.ts';

export interface HandleMessageResult {
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
  reply: ChatReply;
}

/**
 * Optional progress callbacks for a transport that can push.
 *
 * A turn's *result* is unchanged by these — they are notifications about work already
 * committed, never a way to influence it. REST passes none and behaves exactly as before;
 * the socket passes both and delivers the same turn in stages.
 */
export interface TurnHooks {
  /** The user's message, the moment it is durably saved. */
  onUserMessage?: (message: ChatMessage) => void;
  /** A fragment of the assistant's prose, while the model is still writing it. */
  onReplyDelta?: (delta: string) => void;
}

/**
 * A hook is someone else's code on our critical path. A listener that throws is their bug,
 * and it must not cost the user a turn that otherwise succeeded.
 */
const notify = <T>(hook: ((value: T) => void) | undefined, value: T): void => {
  if (!hook) return;
  try {
    hook(value);
  } catch (error) {
    aiLogger.error({ err: error }, 'chat turn hook threw');
  }
};

const toAppointmentSummary = (appointment: Appointment): ChatAppointmentSummary => ({
  id: appointment.id,
  providerName: appointment.providerName,
  providerSpecialty: appointment.providerSpecialty,
  startsAt: appointment.startsAt.toISOString(),
  endsAt: appointment.endsAt.toISOString(),
  status: appointment.status,
});

/** Today's date as the clinic sees it, which is what relative dates resolve against. */
const businessToday = (timezone: string): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

/* ------------------------------------------------------------------ sessions ---- */

export const createSession = async (caller: Caller, title?: string): Promise<ChatSession> =>
  chatRepository.createSession(pool, {
    businessId: caller.businessId,
    userId: caller.userId,
    title: title ?? null,
  });

export const listSessions = async (caller: Caller): Promise<ChatSession[]> =>
  chatRepository.listSessionsForUser(pool, caller.userId);

/**
 * Load a session, enforcing ownership.
 *
 * 404 rather than 403 for someone else's session: a conversation id is not something we
 * should confirm the existence of.
 */
export const getOwnedSession = async (caller: Caller, sessionId: string): Promise<ChatSession> => {
  const session = await chatRepository.findSessionById(pool, sessionId);

  if (!session || session.userId !== caller.userId) {
    if (session) {
      aiLogger.warn(
        { callerId: caller.userId, sessionId, ownerId: session.userId },
        'blocked cross-user chat session access',
      );
    }
    throw new NotFoundError('Conversation');
  }

  return session;
};

export const getMessages = async (caller: Caller, sessionId: string): Promise<ChatMessage[]> => {
  await getOwnedSession(caller, sessionId);
  return chatRepository.listMessages(pool, sessionId);
};

/* --------------------------------------------------------------- the AI turn ---- */

/**
 * Resolve the model's free-text provider/specialty strings onto a real provider row.
 *
 * This is where hallucination stops being dangerous: a name the model invented simply fails
 * to match, and the caller falls back to the form. Ambiguity is reported rather than guessed
 * at — silently picking one of three matching doctors would be worse than asking.
 */
const resolveProvider = async (
  businessId: string,
  fields: AiExtraction['fields'],
): Promise<
  | {
      status: 'resolved';
      provider: { id: string; fullName: string; specialty: string; slotDurationMinutes: number };
    }
  | {
      status: 'ambiguous';
      candidates: Array<{
        id: string;
        fullName: string;
        specialty: string;
        slotDurationMinutes: number;
      }>;
    }
  | { status: 'unknown' }
> => {
  if (fields.providerName) {
    const byName = await providerRepository.findByNameLike(pool, businessId, fields.providerName);
    if (byName.length === 1) return { status: 'resolved', provider: byName[0]! };
    if (byName.length > 1) return { status: 'ambiguous', candidates: byName };
  }

  if (fields.specialty) {
    const bySpecialty = await providerRepository.listActive(pool, businessId, fields.specialty);
    if (bySpecialty.length === 1) return { status: 'resolved', provider: bySpecialty[0]! };
    if (bySpecialty.length > 1) return { status: 'ambiguous', candidates: bySpecialty };
  }

  return { status: 'unknown' };
};

/** Build the form-fallback reply: prose, whatever was understood, and what is still needed. */
const formFallback = (
  text: string,
  prefill: BookingFormPrefill,
  missing: BookingField[],
  extras: Partial<ChatReply> = {},
): ChatReply => ({
  kind: REPLY_KIND.FORM_FALLBACK,
  text,
  prefill,
  missing,
  ...extras,
});

/**
 * Decide what a validated extraction actually means, and act on it.
 *
 * Returns the reply payload. Every branch that could book something goes through
 * appointmentService, so business-hours, past-date, active-provider and double-booking rules
 * are enforced identically whether a human filled the form or the assistant did.
 */
const actOnExtraction = async (
  caller: Caller,
  sessionId: string,
  extraction: AiExtraction,
  context: CompletionContext,
  timezone: string,
): Promise<ChatReply> => {
  const { intent, fields } = extraction;

  if (intent === CHAT_INTENTS.LIST) {
    const upcoming = await appointmentRepository.listUpcomingForUser(pool, caller.userId);
    return {
      kind: REPLY_KIND.APPOINTMENT_LIST,
      text: upcoming.length
        ? extraction.reply
        : 'You have no upcoming appointments. Would you like to book one?',
      appointments: upcoming.map(toAppointmentSummary),
    };
  }

  if (intent === CHAT_INTENTS.CANCEL) {
    const upcoming = await appointmentRepository.listUpcomingForUser(pool, caller.userId);

    if (upcoming.length === 0) {
      return { kind: REPLY_KIND.MESSAGE, text: 'You have no upcoming appointments to cancel.' };
    }

    // Cancellation is never performed from a model instruction. The user picks the exact
    // appointment in the UI, which calls the ordinary REST endpoint — so the destructive
    // action always requires a deliberate human click on a specific record.
    return {
      kind: REPLY_KIND.APPOINTMENT_LIST,
      text:
        upcoming.length === 1
          ? 'Here is your upcoming appointment — use Cancel to confirm.'
          : 'Which of these would you like to cancel? Use Cancel on the one you mean.',
      appointments: upcoming.map(toAppointmentSummary),
    };
  }

  if (intent === CHAT_INTENTS.GREETING || intent === CHAT_INTENTS.OTHER) {
    return { kind: REPLY_KIND.MESSAGE, text: extraction.reply };
  }

  /* ------------------------------------------------------------------ booking ---- */

  const resolution = await resolveProvider(caller.businessId, fields);

  const prefill: BookingFormPrefill = {
    specialty: fields.specialty,
    date: fields.date,
    time: fields.time,
    notes: fields.notes,
    providerId: resolution.status === 'resolved' ? resolution.provider.id : null,
  };

  if (resolution.status === 'unknown') {
    return formFallback(
      fields.specialty || fields.providerName
        ? `I could not match that to one of our doctors. ${extraction.reply}`
        : extraction.reply,
      prefill,
      extraction.missing.length ? extraction.missing : ['specialty', 'providerName'],
      { providers: context.providers.map((p) => ({ ...p, slotDurationMinutes: 30 })) },
    );
  }

  if (resolution.status === 'ambiguous') {
    return formFallback(
      'Several of our doctors match that — which would you prefer?',
      prefill,
      ['providerName'],
      {
        providers: resolution.candidates.map((candidate) => ({
          id: candidate.id,
          fullName: candidate.fullName,
          specialty: candidate.specialty,
          slotDurationMinutes: candidate.slotDurationMinutes,
        })),
      },
    );
  }

  // Provider is known; a date and time are still required.
  if (!fields.date || !fields.time) {
    const missing: BookingField[] = [];
    if (!fields.date) missing.push('date');
    if (!fields.time) missing.push('time');

    return formFallback(extraction.reply, prefill, missing, {
      providers: [
        {
          id: resolution.provider.id,
          fullName: resolution.provider.fullName,
          specialty: resolution.provider.specialty,
          slotDurationMinutes: resolution.provider.slotDurationMinutes,
        },
      ],
    });
  }

  const startsAt = zonedDateTimeToUtc(fields.date, fields.time, timezone);
  if (!startsAt || Number.isNaN(startsAt.getTime())) {
    return formFallback(
      'I could not work out that date and time. Could you confirm it below?',
      prefill,
      ['date', 'time'],
    );
  }

  // Everything is known: attempt the real booking through the same service the REST API
  // uses. Its errors are the authority on whether this was possible.
  try {
    const appointment = await appointmentService.book(caller, {
      providerId: resolution.provider.id,
      startsAt,
      notes: fields.notes,
      source: 'chat',
      chatSessionId: sessionId,
    });

    return {
      kind: REPLY_KIND.APPOINTMENT_CREATED,
      /**
       * Deliberately no date or time in this sentence.
       *
       * The client renders the accompanying appointment card in the *viewer's* timezone,
       * while the server only knows the clinic's. Putting a time in both places produced a
       * reply that read "at 10:00" above a card reading "15:00" — both correct, and
       * thoroughly confusing. Times are formatted in exactly one place: the client.
       */
      text: `Booked with ${appointment.providerName}. The details are below, and it is now in your appointments.`,
      appointment: toAppointmentSummary(appointment),
    };
  } catch (error) {
    // An expected business-rule rejection (slot taken, outside hours, in the past) becomes a
    // form fallback carrying the user's own message back, so nothing they typed is lost.
    if (error instanceof AppError && error.statusCode < 500) {
      return formFallback(`${error.message} Try another time below.`, prefill, ['date', 'time'], {
        providers: [
          {
            id: resolution.provider.id,
            fullName: resolution.provider.fullName,
            specialty: resolution.provider.specialty,
            slotDurationMinutes: resolution.provider.slotDurationMinutes,
          },
        ],
      });
    }
    throw error;
  }
};

/**
 * Handle one turn of conversation.
 *
 * Ordering is deliberate: the user's message is persisted before the model is called, so a
 * provider outage cannot lose what they typed. `hooks` observe that same ordering — nothing
 * is announced before it is true.
 */
export const handleMessage = async (
  caller: Caller,
  sessionId: string,
  content: string,
  hooks: TurnHooks = {},
): Promise<HandleMessageResult> => {
  const session = await getOwnedSession(caller, sessionId);

  const business = await businessRepository.findById(pool, caller.businessId);
  if (!business) throw new NotFoundError('Business');

  // Persist first — the turn survives whatever happens next.
  const userMessage = await withTransaction(async (tx) => {
    const message = await chatRepository.addMessage(tx, {
      sessionId: session.id,
      role: CHAT_ROLES.USER,
      content,
    });
    await chatRepository.setTitleIfEmpty(tx, session.id, content);
    return message;
  });

  // Announced here rather than at the end of the turn, so a transport that streams the
  // assistant's prose cannot deliver the reply to another tab before the message it answers.
  notify(hooks.onUserMessage, userMessage);

  const [providers, specialties, history, lastReplyKind] = await Promise.all([
    providerRepository.listActive(pool, caller.businessId),
    providerRepository.listSpecialties(pool, caller.businessId),
    chatRepository.listRecentTurns(pool, session.id, env.AI_HISTORY_TURNS),
    chatRepository.findLastReplyKind(pool, session.id),
  ]);

  const context: CompletionContext = {
    specialties,
    providers: providers.map((provider) => ({
      id: provider.id,
      fullName: provider.fullName,
      specialty: provider.specialty,
    })),
    todayIsoDate: businessToday(business.timezone),
    timezone: business.timezone,
    lastReplyKind,
  };

  const result = await extract({
    systemPrompt: buildSystemPrompt(context, business.name),
    // The just-persisted message is the current turn, so it is excluded from history.
    history: history.slice(0, -1),
    userMessage: content,
    context,
    /**
     * What streams is the model's draft, and the distinction matters. The prompt has it say
     * "I'll get that booked", never "you're booked" — so the prose the user reads early is a
     * statement of intent, and the authoritative reply that follows below is what actually
     * happened, built from the records this service just wrote.
     */
    onReplyDelta: hooks.onReplyDelta ? (delta) => notify(hooks.onReplyDelta, delta) : undefined,
  });

  let reply: ChatReply;

  if (result.ok) {
    reply = await actOnExtraction(
      caller,
      session.id,
      result.extraction,
      context,
      business.timezone,
    );
  } else {
    // The required fallback: extraction failed, so hand over a structured form rather than
    // an error. Nothing the user typed is lost — it is already saved above.
    reply = formFallback(
      "I did not quite follow that. Could you fill in the details below and I'll book it?",
      {},
      ['specialty', 'providerName', 'date', 'time'],
      {
        providers: providers.map((provider) => ({
          id: provider.id,
          fullName: provider.fullName,
          specialty: provider.specialty,
          slotDurationMinutes: provider.slotDurationMinutes,
        })),
      },
    );
  }

  reply.degraded = result.degraded;

  const assistantMessage = await withTransaction(async (tx) =>
    chatRepository.addMessage(tx, {
      sessionId: session.id,
      role: CHAT_ROLES.ASSISTANT,
      content: reply.text,
      // The whole payload is stored so reloading the conversation restores the rich parts
      // (doctor cards, the prefilled form) instead of degrading to plain text.
      extractedData: reply as unknown as Record<string, unknown>,
    }),
  );

  // Logged last, and never allowed to fail the request: observability must not break the
  // feature it observes.
  try {
    await aiLogRepository.record(pool, {
      businessId: caller.businessId,
      userId: caller.userId,
      sessionId: session.id,
      messageId: userMessage.id,
      provider: result.telemetry.provider,
      model: result.telemetry.model,
      outcome: result.telemetry.outcome,
      promptTokens: result.telemetry.promptTokens,
      completionTokens: result.telemetry.completionTokens,
      latencyMs: result.telemetry.latencyMs,
      requestPayload: { historyTurns: history.length, messageLength: content.length },
      responsePayload: result.ok
        ? {
            intent: result.extraction.intent,
            missing: result.extraction.missing,
            replyKind: reply.kind,
          }
        : { raw: result.telemetry.rawResponse },
      errorMessage: result.telemetry.errorMessage,
    });
  } catch (error) {
    aiLogger.error({ err: error }, 'failed to write ai interaction log');
  }

  return { userMessage, assistantMessage, reply };
};

/** Exposed for the health endpoint so the UI can tell the user which mode it is in. */
export const describeProvider = (): { name: string; deterministic: boolean } => {
  const provider = getProvider();
  return { name: provider.name, deterministic: provider.isDeterministic };
};

export default {
  createSession,
  listSessions,
  getOwnedSession,
  getMessages,
  handleMessage,
  describeProvider,
};
