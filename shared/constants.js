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
  GREETING: 'greeting',
  OTHER: 'other',
};

export const CHAT_INTENT_VALUES = Object.values(CHAT_INTENTS);

/** Booking fields the assistant tries to collect, in the order it should ask for them. */
export const BOOKING_FIELDS = ['specialty', 'providerName', 'date', 'time'];

/**
 * What a chat turn resolved to. `FORM_FALLBACK` is the required behaviour when the model
 * could not extract a complete, unambiguous booking — the client renders the structured
 * form prefilled with whatever was understood.
 */
export const REPLY_KIND = {
  MESSAGE: 'message',
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
