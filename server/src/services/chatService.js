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

import { BOOKING_FIELDS, CHAT_INTENTS, CHAT_ROLES, REPLY_KIND } from '../../../shared/constants.js';
import { chatSessionCursorSchema } from '../../../shared/schemas.js';

import { extract, getProvider } from '../ai/extraction.js';
import { zonedDateTimeToUtc } from '../ai/naturalDate.js';
import { buildSystemPrompt } from '../ai/prompts.js';
import { generateTitle } from '../ai/title.js';
import { env } from '../config/env.js';
import { pool, withTransaction } from '../db/pool.js';
import { AppError, NotFoundError, ValidationError } from '../errors/AppError.js';
import { aiLogger } from '../logger/index.js';
import aiLogRepository from '../repositories/aiLogRepository.js';
import appointmentRepository from '../repositories/appointmentRepository.js';
import businessRepository from '../repositories/businessRepository.js';
import chatRepository from '../repositories/chatRepository.js';
import providerRepository from '../repositories/providerRepository.js';
import { decodeCursor, encodeCursor } from '../utils/cursor.js';
import appointmentService from './appointmentService.js';

/**
 * Optional progress callbacks for a transport that can push.
 *
 * A turn's *result* is unchanged by these — they are notifications about work already
 * committed, never a way to influence it. REST passes none and behaves exactly as before;
 * the socket passes both and delivers the same turn in stages.
 *
 * @typedef {object} TurnHooks
 * @property {(message: object) => void} [onUserMessage] The user's message, the moment it is
 *   durably saved.
 * @property {(delta: string) => void} [onReplyDelta] A fragment of the assistant's prose,
 *   while the model is still writing it.
 */

/**
 * A hook is someone else's code on our critical path. A listener that throws is their bug,
 * and it must not cost the user a turn that otherwise succeeded.
 */
const notify = (hook, value) => {
  if (!hook) return;
  try {
    hook(value);
  } catch (error) {
    aiLogger.error({ err: error }, 'chat turn hook threw');
  }
};

/**
 * The client-facing view of an appointment.
 *
 * Exported because it is also the payload of the `appointment:created` socket event, which the
 * REST layer emits for a booking made in the in-chat form. One mapper keeps both routes into a
 * booking sending the same shape, and keeps internal columns — the tenant id, the source, the
 * cancellation fields — off the wire.
 *
 * @returns {import('../../../shared/chat.js').ChatAppointmentSummary}
 */
export const toAppointmentSummary = (appointment) => ({
  id: appointment.id,
  providerName: appointment.providerName,
  providerSpecialty: appointment.providerSpecialty,
  startsAt: appointment.startsAt.toISOString(),
  endsAt: appointment.endsAt.toISOString(),
  status: appointment.status,
});

/** Today's date as the clinic sees it, which is what relative dates resolve against. */
const businessToday = (timezone) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

/* ------------------------------------------------------------------ sessions ---- */

/** @param {import('./appointmentService.js').Caller} caller */
export const createSession = async (caller, title) =>
  chatRepository.createSession(pool, {
    businessId: caller.businessId,
    userId: caller.userId,
    title: title ?? null,
  });

/**
 * One page of the caller's conversations.
 *
 * The cursor arrives as opaque text from a client and is treated as untrusted input: decoded,
 * schema-checked, and rejected as a bad request if it is neither. It carries no authority
 * either way — the rows are scoped to `caller.userId` regardless of what it says, so a forged
 * cursor can at most name a position in someone's own list.
 *
 * @param {import('./appointmentService.js').Caller} caller
 * @param {{ limit?: number, cursor?: string }} [options]
 * @returns {Promise<{ items: object[], nextCursor: string | null }>}
 */
export const listSessions = async (caller, options = {}) => {
  let after = null;

  if (options.cursor) {
    const decoded = decodeCursor(options.cursor);
    const parsed = decoded ? chatSessionCursorSchema.safeParse(decoded) : null;

    if (!parsed?.success) {
      throw new ValidationError('The request contains invalid data', [
        { path: 'cursor', message: 'Not a valid cursor' },
      ]);
    }

    after = { activityAt: new Date(parsed.data.activityAt), id: parsed.data.id };
  }

  const { items, nextCursor } = await chatRepository.listSessionsForUser(pool, caller.userId, {
    limit: options.limit,
    after,
  });

  return {
    items,
    nextCursor: nextCursor
      ? encodeCursor({ activityAt: nextCursor.activityAt.toISOString(), id: nextCursor.id })
      : null,
  };
};

/**
 * Load a session, enforcing ownership.
 *
 * 404 rather than 403 for someone else's session: a conversation id is not something we
 * should confirm the existence of.
 *
 * @param {import('./appointmentService.js').Caller} caller
 */
export const getOwnedSession = async (caller, sessionId) => {
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

/** @param {import('./appointmentService.js').Caller} caller */
export const getMessages = async (caller, sessionId) => {
  await getOwnedSession(caller, sessionId);
  return chatRepository.listMessages(pool, sessionId);
};

/**
 * Record a booking that was completed in the structured form, as a turn of the conversation.
 *
 * The form is the assistant's fallback path — it is rendered inside a chat bubble and it
 * answers a question the assistant asked — so a booking made in it is part of the conversation
 * and not a silent side effect of it. Without this, the only trace was a toast: gone on the
 * next render, absent on reload, and leaving the thread ending on the question rather than the
 * answer.
 *
 * The payload is the same `APPOINTMENT_CREATED` reply the conversational path produces, built
 * here from the appointment row that was just written — so the client renders one confirmation
 * for both routes into a booking, and the model has authored none of it.
 *
 * It also ends the booking draft: `findBookingDraft` treats an `APPOINTMENT_CREATED` reply as
 * the end of what is in progress, so the next vague message cannot book this appointment again.
 *
 * @param {import('./appointmentService.js').Caller} caller
 * @param {string} sessionId
 * @param {object} appointment As returned by `appointmentService.book`.
 * @returns {Promise<{ message: object,
 *   reply: import('../../../shared/chat.js').ChatReply }>}
 */
export const recordFormBooking = async (caller, sessionId, appointment) => {
  const session = await getOwnedSession(caller, sessionId);

  /** @type {import('../../../shared/chat.js').ChatReply} */
  const reply = {
    kind: REPLY_KIND.APPOINTMENT_CREATED,
    // No date or time in the prose, for the same reason the conversational path omits them:
    // the server only knows the clinic's timezone, and the card below is rendered in the
    // viewer's. Times are formatted in exactly one place.
    text: `Booked with ${appointment.providerName}. The details are below, and it is now in your appointments.`,
    appointment: toAppointmentSummary(appointment),
  };

  const message = await withTransaction(async (tx) =>
    chatRepository.addMessage(tx, {
      sessionId: session.id,
      role: CHAT_ROLES.ASSISTANT,
      content: reply.text,
      extractedData: reply,
    }),
  );

  return { message, reply };
};

/* --------------------------------------------------------------- the AI turn ---- */

/**
 * Resolve the model's free-text provider/specialty strings onto a real provider row.
 *
 * This is where hallucination stops being dangerous: a name the model invented simply fails
 * to match, and the caller falls back to the form. Ambiguity is reported rather than guessed
 * at — silently picking one of three matching doctors would be worse than asking.
 *
 * @returns {Promise<{ status: 'resolved', provider: object }
 *   | { status: 'ambiguous', candidates: object[] }
 *   | { status: 'unknown' }>}
 */
const resolveProvider = async (businessId, fields) => {
  // A doctor the conversation already settled on. Preferred over re-matching the name,
  // because this id came from a real row in this tenant — and it is still re-read here rather
  // than trusted, so a provider deactivated since that turn drops out like any other.
  if (fields.providerId && !fields.providerName) {
    const known = await providerRepository.findById(pool, businessId, fields.providerId);
    if (known?.isActive) return { status: 'resolved', provider: known };
  }

  if (fields.providerName) {
    const byName = await providerRepository.findByNameLike(pool, businessId, fields.providerName);
    if (byName.length === 1) return { status: 'resolved', provider: byName[0] };
    if (byName.length > 1) return { status: 'ambiguous', candidates: byName };
  }

  if (fields.specialty) {
    const bySpecialty = await providerRepository.listActive(pool, businessId, fields.specialty);
    if (bySpecialty.length === 1) return { status: 'resolved', provider: bySpecialty[0] };
    if (bySpecialty.length > 1) return { status: 'ambiguous', candidates: bySpecialty };
  }

  return { status: 'unknown' };
};

/** @returns {import('../../../shared/chat.js').ChatProviderSummary} */
const toProviderSummary = (provider) => ({
  id: provider.id,
  fullName: provider.fullName,
  specialty: provider.specialty,
  slotDurationMinutes: provider.slotDurationMinutes,
});

/** Every bookable doctor, as the client renders them. */
const listProviderSummaries = async (businessId) => {
  const providers = await providerRepository.listActive(pool, businessId);
  return providers.map(toProviderSummary);
};

/**
 * Fold the conversation's booking draft under this turn's extraction.
 *
 * The model is asked to repeat what it already knows, and mostly does. This is what happens
 * when it does not: the draft supplies the gap, so "make it 3pm instead" does not throw away
 * the doctor chosen two turns ago, and a model that returns nothing but an intent still
 * advances the booking rather than restarting it.
 *
 * The current turn always wins. Anything the person just said overwrites the draft, which is
 * what makes correcting yourself work — and it is why the merge only ever fills nulls.
 *
 * There is one exception to that, and it is the only place this function is not simply a fill:
 * a new specialty retires the doctor chosen under the old one. Keeping both would let
 * "actually it's about my skin" resolve to the cardiologist named two turns ago, which is a
 * wrong booking rather than a clumsy question.
 *
 * @param {import('../ai/provider.js').CompletionContext['draft']} draft
 * @param {object} fields This turn's extracted fields.
 */
const mergeDraft = (draft, fields) => {
  const changedSpecialty =
    Boolean(fields.specialty) && Boolean(draft.specialty) && fields.specialty !== draft.specialty;

  // Every key present and null rather than absent: this becomes the form's prefill, which is a
  // contract with the client, and an absent key does not survive JSON the way a null does.
  const merged = {
    specialty: draft.specialty ?? null,
    /**
     * The draft contributes the id and never the name, which is what makes the precedence
     * right: `providerName` after this merge is only ever what the model said *this* turn, so
     * naming a doctor switches to them and saying nothing keeps the one already chosen.
     *
     * Carrying the name too would also send an exact full name back through a LIKE match —
     * ambiguous the moment one doctor's name contains another's ("Dr. Chen", "Dr. Chenoweth"),
     * and the person gets asked to make a choice they already made.
     */
    providerName: null,
    providerId: changedSpecialty && !fields.providerName ? null : (draft.providerId ?? null),
    date: draft.date ?? null,
    time: draft.time ?? null,
    notes: draft.notes ?? null,
  };

  for (const [key, value] of Object.entries(fields)) {
    if (value !== null && value !== undefined && value !== '') merged[key] = value;
  }

  return merged;
};

/**
 * Build the form-fallback reply: prose, whatever was understood, and what is still needed.
 *
 * @returns {import('../../../shared/chat.js').ChatReply}
 */
const formFallback = (text, prefill, missing, extras = {}) => ({
  kind: REPLY_KIND.FORM_FALLBACK,
  text,
  prefill,
  missing,
  ...extras,
});

/**
 * Answer "what is free on Thursday?" from the calendar.
 *
 * The one place the assistant reports availability, and it does not decide any of it: the
 * slots come from `appointmentService.getAvailability`, generated from business hours minus
 * real bookings. The model is told in its prompt never to claim a time is free, precisely so
 * that the only free times a person is ever shown are these.
 *
 * A doctor and a day are both required, and neither is guessed. The draft supplies them when
 * the conversation already has them, so "and what about Friday?" works.
 *
 * @param {import('./appointmentService.js').Caller} caller
 * @param {object} extraction
 * @param {import('../ai/provider.js').CompletionContext} context
 * @returns {Promise<import('../../../shared/chat.js').ChatReply>}
 */
const actOnAvailability = async (caller, extraction, context) => {
  /**
   * The doctor carries over from the conversation; the day never does.
   *
   * A day is the *subject* of an availability question, not a detail of it — "and what about
   * Friday?" is asking about a different day by definition. Mistral answers that one by
   * writing Friday into its prose and leaving `date` null, and inheriting Thursday there
   * produces the worst available outcome: a list of real times for a day nobody asked about,
   * under a sentence naming another. Asking which day costs a turn and is never wrong.
   */
  const fields = mergeDraft({ ...context.draft, date: null }, extraction.fields);
  const resolution = await resolveProvider(caller.businessId, fields);

  const prefill = {
    specialty: fields.specialty,
    date: fields.date,
    time: null,
    notes: fields.notes,
    providerId: resolution.status === 'resolved' ? resolution.provider.id : null,
  };

  // Availability is per-doctor, so "when are you free this week?" cannot be answered as
  // asked. Showing the doctors is the useful half of the answer.
  if (resolution.status !== 'resolved') {
    return formFallback(
      resolution.status === 'ambiguous'
        ? 'Several of our doctors match that — whose availability would you like?'
        : `${extraction.reply} Which doctor did you have in mind?`,
      prefill,
      ['providerName'],
      {
        providers:
          resolution.status === 'ambiguous'
            ? resolution.candidates.map(toProviderSummary)
            : await listProviderSummaries(caller.businessId),
      },
    );
  }

  const provider = resolution.provider;

  if (!fields.date) {
    return formFallback(`${extraction.reply} Which day shall I check?`, prefill, ['date'], {
      providers: [toProviderSummary(provider)],
    });
  }

  const { slots } = await appointmentService.getAvailability(caller, provider.id, fields.date);

  if (slots.length === 0) {
    // The date is dropped from what carries forward — it is the part that did not work, and
    // leaving it in would have the next vague turn ask about the same full day.
    return formFallback(
      `${provider.fullName} has nothing free that day. Would another day work?`,
      { ...prefill, date: null },
      ['date'],
      { providers: [toProviderSummary(provider)] },
    );
  }

  return {
    kind: REPLY_KIND.SLOT_LIST,
    text: extraction.reply,
    slots,
    slotDate: fields.date,
    providers: [toProviderSummary(provider)],
    // Carried so the conversation remembers whose day this was: naming one of these times is
    // then a complete booking rather than an orphaned "10:00".
    prefill,
    missing: ['time'],
  };
};

/**
 * Decide what a validated extraction actually means, and act on it.
 *
 * Returns the reply payload. Every branch that could book something goes through
 * appointmentService, so business-hours, past-date, active-provider and double-booking rules
 * are enforced identically whether a human filled the form or the assistant did.
 *
 * @param {import('./appointmentService.js').Caller} caller
 * @param {string} sessionId
 * @param {object} extraction Already validated against aiExtractionSchema.
 * @param {import('../ai/provider.js').CompletionContext} context
 * @param {string} timezone
 * @returns {Promise<import('../../../shared/chat.js').ChatReply>}
 */
const actOnExtraction = async (caller, sessionId, extraction, context, timezone) => {
  const { intent } = extraction;

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

  if (intent === CHAT_INTENTS.PROVIDERS) {
    // The model has the catalogue in its prompt and answers this well in prose. The cards go
    // alongside it anyway, because they are built from live rows: if the model drops a doctor
    // or invents one, what the person sees under the sentence is still the truth.
    return {
      kind: REPLY_KIND.PROVIDER_LIST,
      text: extraction.reply,
      providers: await listProviderSummaries(caller.businessId),
    };
  }

  if (intent === CHAT_INTENTS.AVAILABILITY) {
    return actOnAvailability(caller, extraction, context);
  }

  if (intent === CHAT_INTENTS.GREETING || intent === CHAT_INTENTS.OTHER) {
    return { kind: REPLY_KIND.MESSAGE, text: extraction.reply };
  }

  /* ------------------------------------------------------------------ booking ---- */

  // The turn's own reading of the message, over everything the conversation had already
  // settled. From here down, `fields` is the whole booking rather than one message's worth
  // of it — which is why a "yes" that extracts nothing still books what was on offer.
  const fields = mergeDraft(context.draft, extraction.fields);

  const resolution = await resolveProvider(caller.businessId, fields);

  const prefill = {
    specialty: fields.specialty,
    date: fields.date,
    time: fields.time,
    notes: fields.notes,
    providerId: resolution.status === 'resolved' ? resolution.provider.id : null,
  };

  /**
   * What is still genuinely absent, recomputed rather than taken from `extraction.missing`.
   *
   * The model reports what *this message* lacked; after the merge that is often already
   * answered, and reporting it would ask someone for a detail sitting in the prefill next to
   * the question. The recomputation is also what stops the draft from making `missing` and
   * `prefill` contradict each other.
   */
  const stillMissing = BOOKING_FIELDS.filter((field) => {
    // Choosing the doctor answers what the appointment is for — their specialty is the
    // answer. Asking anyway is the kind of question that makes an assistant feel like a form.
    if (field === 'providerName') return resolution.status !== 'resolved';
    if (field === 'specialty') return resolution.status !== 'resolved' && !fields.specialty;
    return !fields[field];
  });

  if (resolution.status === 'unknown') {
    return formFallback(
      fields.specialty || fields.providerName
        ? `I could not match that to one of our doctors. ${extraction.reply}`
        : extraction.reply,
      prefill,
      stillMissing,
      { providers: await listProviderSummaries(caller.businessId) },
    );
  }

  if (resolution.status === 'ambiguous') {
    return formFallback(
      'Several of our doctors match that — which would you prefer?',
      prefill,
      ['providerName'],
      { providers: resolution.candidates.map(toProviderSummary) },
    );
  }

  // Provider is known; a date and time are still required.
  if (!fields.date || !fields.time) {
    return formFallback(extraction.reply, prefill, stillMissing, {
      providers: [toProviderSummary(resolution.provider)],
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
        providers: [toProviderSummary(resolution.provider)],
      });
    }
    throw error;
  }
};

/**
 * Truncation, kept only for when the model cannot be asked or cannot answer.
 *
 * This used to be how every conversation was named, and it reads like it: half a sentence,
 * cut mid-word, repeated down the sidebar because six threads open the same way. It survives
 * as the floor under the real titles — a row labelled with the person's own words is a poor
 * label, but it is a better one than none.
 */
const truncatedTitle = (content) => {
  const firstLine = content.split('\n').find((line) => line.trim()) ?? content;
  const cleaned = firstLine.trim().replace(/\s+/g, ' ');
  return cleaned.length > 40 ? `${cleaned.slice(0, 39).trimEnd()}…` : cleaned;
};

/**
 * Give the conversation a name, once.
 *
 * Guarded on the title still being absent, which is what stops a second call on every
 * subsequent turn — and, because `setTitleIfEmpty` only writes over NULL, two turns racing
 * here cannot rename a conversation someone is already looking at.
 *
 * Deliberately after the reply has been built and stored. Naming a row in a list is not worth
 * a moment of the wait for an answer, and if this whole step falls over the turn is already
 * complete and safe.
 */
const nameConversation = async (session, userMessage, assistantReply) => {
  if (session.title !== null) return;

  try {
    const generated = await generateTitle(userMessage, assistantReply);
    await chatRepository.setTitleIfEmpty(
      pool,
      session.id,
      generated ?? truncatedTitle(userMessage),
    );
  } catch (error) {
    // Including the write. A conversation with no label is a cosmetic problem; a turn that
    // 500s after the booking is already made is not.
    aiLogger.error({ err: error, sessionId: session.id }, 'could not name the conversation');
  }
};

/**
 * Handle one turn of conversation.
 *
 * Ordering is deliberate: the user's message is persisted before the model is called, so a
 * provider outage cannot lose what they typed. `hooks` observe that same ordering — nothing
 * is announced before it is true.
 *
 * @param {import('./appointmentService.js').Caller} caller
 * @param {string} sessionId
 * @param {string} content
 * @param {TurnHooks} [hooks]
 * @returns {Promise<{ userMessage: object, assistantMessage: object,
 *   reply: import('../../../shared/chat.js').ChatReply }>}
 */
export const handleMessage = async (caller, sessionId, content, hooks = {}) => {
  const session = await getOwnedSession(caller, sessionId);

  const business = await businessRepository.findById(pool, caller.businessId);
  if (!business) throw new NotFoundError('Business');

  // Persist first — the turn survives whatever happens next.
  const userMessage = await withTransaction(async (tx) =>
    chatRepository.addMessage(tx, {
      sessionId: session.id,
      role: CHAT_ROLES.USER,
      content,
    }),
  );

  // Announced here rather than at the end of the turn, so a transport that streams the
  // assistant's prose cannot deliver the reply to another tab before the message it answers.
  notify(hooks.onUserMessage, userMessage);

  const [providers, specialties, history, lastReplyKind, draft] = await Promise.all([
    providerRepository.listActive(pool, caller.businessId),
    providerRepository.listSpecialties(pool, caller.businessId),
    chatRepository.listRecentTurns(pool, session.id, env.AI_HISTORY_TURNS),
    chatRepository.findLastReplyKind(pool, session.id),
    chatRepository.findBookingDraft(pool, session.id),
  ]);

  /** @type {import('../ai/provider.js').CompletionContext} */
  const context = {
    specialties,
    providers: providers.map((provider) => ({
      id: provider.id,
      fullName: provider.fullName,
      specialty: provider.specialty,
    })),
    todayIsoDate: businessToday(business.timezone),
    timezone: business.timezone,
    lastReplyKind,
    // The draft stores a provider id, because that is what survives a doctor being renamed.
    // The prompt needs a name, so it is resolved here against the live list — a doctor who
    // has since been deactivated is simply absent from it, and the draft loses them.
    draft: {
      ...draft,
      providerName:
        providers.find((provider) => provider.id === draft.providerId)?.fullName ?? null,
    },
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

  let reply;

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
      { providers: providers.map(toProviderSummary) },
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
      extractedData: reply,
    }),
  );

  await nameConversation(session, content, reply.text);

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
export const describeProvider = () => {
  const provider = getProvider();
  return { name: provider.name, deterministic: provider.isDeterministic };
};

export default {
  createSession,
  listSessions,
  getOwnedSession,
  getMessages,
  recordFormBooking,
  handleMessage,
  describeProvider,
};
