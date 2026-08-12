/**
 * Domain constants shared by the server and the client.
 *
 * This file is imported by BOTH packages: the server imports it directly at runtime, and Vite
 * bundles it for the client. Keeping the values in one place is what stops the two sides from
 * drifting on enum spellings.
 */

export const USER_ROLES = {
  CUSTOMER: 'customer',
  STAFF: 'staff',
  ADMIN: 'admin',
};

export const USER_ROLE_VALUES = Object.values(USER_ROLES);

/**
 * Appointment lifecycle. This prototype confirms on booking (no staff approval step
 * exists), but the full lifecycle is modelled so the schema does not need to change
 * when an approval queue is added.
 */
export const APPOINTMENT_STATUS = {
  PENDING: 'PENDING',
  CONFIRMED: 'CONFIRMED',
  CANCELLED: 'CANCELLED',
  COMPLETED: 'COMPLETED',
  NO_SHOW: 'NO_SHOW',
};

export const APPOINTMENT_STATUS_VALUES = Object.values(APPOINTMENT_STATUS);

/** Statuses that occupy a slot — mirrors the WHERE clause of the DB exclusion constraint. */
export const BLOCKING_APPOINTMENT_STATUSES = [
  APPOINTMENT_STATUS.PENDING,
  APPOINTMENT_STATUS.CONFIRMED,
];

export const APPOINTMENT_SOURCE = {
  CHAT: 'chat',
  FORM: 'form',
};

export const APPOINTMENT_SOURCE_VALUES = Object.values(APPOINTMENT_SOURCE);

export const CHAT_ROLES = {
  USER: 'user',
  ASSISTANT: 'assistant',
  SYSTEM: 'system',
};

export const CHAT_ROLE_VALUES = Object.values(CHAT_ROLES);

/**
 * Intents the extraction step may return. Deliberately small.
 *
 * `LIST` is the person's own appointments and nothing else. That narrowness is the whole
 * reason `PROVIDERS` and `AVAILABILITY` exist as intents of their own: "list the doctors" and
 * "show me what's free" are also list-shaped questions, and folding them into `LIST` answered
 * every one of them with "you have no upcoming appointments" — a true sentence about a
 * question nobody asked.
 */
export const CHAT_INTENTS = {
  BOOK: 'book',
  CANCEL: 'cancel',
  /** The caller's own upcoming appointments. */
  LIST: 'list',
  /** Who works here, and what they treat. */
  PROVIDERS: 'providers',
  /** Free times for a doctor on a day. */
  AVAILABILITY: 'availability',
  /**
   * Someone is telling you how they feel, and has not asked for an appointment yet.
   *
   * Split out of `BOOK` because folding the two together is what had "I have a headache"
   * answered with a booking form. Describing a symptom is the opening of a conversation, not a
   * request to see someone — so this intent resolves to plain prose and nothing else: no
   * prefill, no doctor cards, no form. The assistant acknowledges, asks what it needs to, and
   * offers a doctor once that is actually worth doing. The turn where the person accepts that
   * offer is the one that returns `BOOK`, and the booking flow is unchanged from there on.
   */
  SYMPTOM: 'symptom',
  GREETING: 'greeting',
  OTHER: 'other',
};

export const CHAT_INTENT_VALUES = Object.values(CHAT_INTENTS);

/** Booking fields the assistant tries to collect, in the order it should ask for them. */
export const BOOKING_FIELDS = ['specialty', 'providerName', 'date', 'time'];

/**
 * A part of the day, as people ask for it: "Tuesday morning", "some time this afternoon".
 *
 * Deliberately not a booking field. It never becomes an appointment — an appointment has an
 * exact `time` — it only narrows which free slots are worth showing. Treating it as a fifth
 * thing to collect would have the assistant asking "morning or afternoon?" before it could
 * book, when the person had already named 10:00.
 */
export const TIME_OF_DAY = {
  MORNING: 'morning',
  AFTERNOON: 'afternoon',
  EVENING: 'evening',
};

export const TIME_OF_DAY_VALUES = Object.values(TIME_OF_DAY);

/**
 * Which clinic-local hours each one covers, as `[fromHour, untilHour)`.
 *
 * In the clinic's timezone, not the viewer's, and that is the whole point: "Tuesday morning"
 * means the morning of the clinic's Tuesday. Someone five hours ahead asking for a morning
 * appointment is not asking for the clinic's 04:00 — and if these windows were applied in the
 * reader's zone, that is exactly what they would get.
 *
 * The boundaries are the conventional ones rather than anything derived from business hours:
 * they only have to agree with what a person means, and a clinic that opens at 09:00 has no
 * morning slots before it regardless.
 */
export const TIME_OF_DAY_WINDOWS = {
  [TIME_OF_DAY.MORNING]: [0, 12],
  [TIME_OF_DAY.AFTERNOON]: [12, 17],
  [TIME_OF_DAY.EVENING]: [17, 24],
};

/**
 * What a chat turn resolved to.
 *
 * `NEEDS_DETAIL` and `FORM_FALLBACK` are both "the booking is not complete yet", and the
 * difference between them is how the assistant is asking — which is a judgement about the
 * conversation, so the server makes it rather than the client guessing from the payload:
 *
 *   NEEDS_DETAIL — the assistant knows what it is missing and can ask for it in a sentence.
 *   A day, a time, which of two doctors. The client shows the question; the form is available
 *   behind it but closed, because opening a booking form to ask "which day?" answers a
 *   question nobody asked and turns a conversation into data entry.
 *
 *   FORM_FALLBACK — the assistant is genuinely stuck, which is the brief's required
 *   behaviour: the extraction failed, or the person named a doctor that matches nothing, or
 *   the clinic refused the slot. Asking again in prose would repeat a turn that just failed,
 *   so the form is opened.
 *
 * Both carry the same payload, so the draft machinery treats them identically.
 */
export const REPLY_KIND = {
  MESSAGE: 'message',
  NEEDS_DETAIL: 'needs_detail',
  FORM_FALLBACK: 'form_fallback',
  APPOINTMENT_CREATED: 'appointment_created',
  APPOINTMENT_LIST: 'appointment_list',
  /** The clinic's doctors, as cards rather than a sentence the model composed. */
  PROVIDER_LIST: 'provider_list',
  /** Free start times for one doctor on one day, computed from real bookings. */
  SLOT_LIST: 'slot_list',
};

export const SOCKET_EVENTS = {
  // client → server
  MESSAGE_SEND: 'chat:message',
  SESSION_JOIN: 'chat:join',
  // server → client
  MESSAGE_RECEIVED: 'chat:received',
  ASSISTANT_TYPING: 'assistant:typing',
  /**
   * A fragment of the assistant's prose, as the model produces it. Carries a `turnId` so a
   * client can tell two in-flight turns apart, and so the terminal ASSISTANT_REPLY knows
   * which partial bubble it replaces.
   */
  ASSISTANT_DELTA: 'assistant:delta',
  ASSISTANT_REPLY: 'assistant:reply',
  /**
   * A booking, announced to every tab its owner has open.
   *
   * Payload: `{ appointment, sessionId?, chatMessage? }`, where `appointment` is a
   * `ChatAppointmentSummary`.
   *
   * The two optional fields carry the conversation turn recorded for a booking finished in the
   * in-chat form, which completes over REST and so has no assistant reply of its own. They are
   * absent on the conversational path, where ASSISTANT_REPLY has already delivered that turn —
   * which is what stops a client appending the same message twice.
   *
   * This is the only event emitted from outside the socket handlers; the REST layer reaches it
   * through `server/src/realtime.js`.
   */
  APPOINTMENT_CREATED: 'appointment:created',
  ERROR: 'chat:error',
};

/** Application error codes. The HTTP status lives with the error class on the server. */
export const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  EMAIL_TAKEN: 'EMAIL_TAKEN',
  SLOT_UNAVAILABLE: 'SLOT_UNAVAILABLE',
  SLOT_IN_PAST: 'SLOT_IN_PAST',
  OUTSIDE_BUSINESS_HOURS: 'OUTSIDE_BUSINESS_HOURS',
  INVALID_STATUS_TRANSITION: 'INVALID_STATUS_TRANSITION',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  RATE_LIMITED: 'RATE_LIMITED',
  AI_UNAVAILABLE: 'AI_UNAVAILABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
};

/** How many prior turns are replayed to the model. "Simple memory is sufficient." */
export const CHAT_HISTORY_TURNS = 10;

export const LIMITS = {
  MESSAGE_MAX_LENGTH: 2000,
  NOTES_MAX_LENGTH: 500,
  PASSWORD_MIN_LENGTH: 8,
  PASSWORD_MAX_LENGTH: 128,
  PAGE_SIZE_DEFAULT: 20,
  PAGE_SIZE_MAX: 100,
};
