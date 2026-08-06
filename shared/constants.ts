/**
 * Domain constants shared by the server and the client.
 *
 * This file is imported by BOTH packages: the TypeScript server compiles it directly,
 * and Vite transpiles it for the JavaScript client. Keeping the values in one place is
 * what stops the two sides from drifting on enum spellings.
 */

export const USER_ROLES = {
  CUSTOMER: 'customer',
  STAFF: 'staff',
  ADMIN: 'admin',
} as const;

export type UserRole = (typeof USER_ROLES)[keyof typeof USER_ROLES];
export const USER_ROLE_VALUES = Object.values(USER_ROLES) as UserRole[];

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
} as const;

export type AppointmentStatus = (typeof APPOINTMENT_STATUS)[keyof typeof APPOINTMENT_STATUS];
export const APPOINTMENT_STATUS_VALUES = Object.values(APPOINTMENT_STATUS) as AppointmentStatus[];

/** Statuses that occupy a slot — mirrors the WHERE clause of the DB exclusion constraint. */
export const BLOCKING_APPOINTMENT_STATUSES: AppointmentStatus[] = [
  APPOINTMENT_STATUS.PENDING,
  APPOINTMENT_STATUS.CONFIRMED,
];

export const APPOINTMENT_SOURCE = {
  CHAT: 'chat',
  FORM: 'form',
} as const;

export type AppointmentSource = (typeof APPOINTMENT_SOURCE)[keyof typeof APPOINTMENT_SOURCE];
export const APPOINTMENT_SOURCE_VALUES = Object.values(APPOINTMENT_SOURCE) as AppointmentSource[];

export const CHAT_ROLES = {
  USER: 'user',
  ASSISTANT: 'assistant',
  SYSTEM: 'system',
} as const;

export type ChatRole = (typeof CHAT_ROLES)[keyof typeof CHAT_ROLES];
export const CHAT_ROLE_VALUES = Object.values(CHAT_ROLES) as ChatRole[];

/** Intents the extraction step may return. Deliberately small. */
export const CHAT_INTENTS = {
  BOOK: 'book',
  CANCEL: 'cancel',
  LIST: 'list',
  GREETING: 'greeting',
  OTHER: 'other',
} as const;

export type ChatIntent = (typeof CHAT_INTENTS)[keyof typeof CHAT_INTENTS];
export const CHAT_INTENT_VALUES = Object.values(CHAT_INTENTS) as ChatIntent[];

/** Booking fields the assistant tries to collect, in the order it should ask for them. */
export const BOOKING_FIELDS = ['specialty', 'providerName', 'date', 'time'] as const;
export type BookingField = (typeof BOOKING_FIELDS)[number];

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
} as const;

export type ReplyKind = (typeof REPLY_KIND)[keyof typeof REPLY_KIND];

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
  APPOINTMENT_CREATED: 'appointment:created',
  ERROR: 'chat:error',
} as const;

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
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** How many prior turns are replayed to the model. "Simple memory is sufficient." */
export const CHAT_HISTORY_TURNS = 10;

export const LIMITS = {
  MESSAGE_MAX_LENGTH: 2000,
  NOTES_MAX_LENGTH: 500,
  PASSWORD_MIN_LENGTH: 8,
  PASSWORD_MAX_LENGTH: 128,
  PAGE_SIZE_DEFAULT: 20,
  PAGE_SIZE_MAX: 100,
} as const;
