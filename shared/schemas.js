/**
 * Zod schemas shared by the server (request validation) and the client (form validation).
 *
 * One definition per contract, used on both sides — a field rule can never disagree
 * between the browser and the API.
 *
 * These schemas are also the runtime type system this codebase relies on: anything that
 * crosses a trust boundary (a request body, a query string, a model's JSON) is parsed
 * through one of them before any other code sees it.
 */

import { z } from 'zod';

import {
  APPOINTMENT_SOURCE_VALUES,
  APPOINTMENT_STATUS_VALUES,
  BOOKING_FIELDS,
  CHAT_INTENT_VALUES,
  LIMITS,
} from './constants.js';

/* ------------------------------------------------------------------ auth ---- */

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(255, 'Email is too long')
  .pipe(z.email('Enter a valid email address'));

export const passwordSchema = z
  .string()
  .min(
    LIMITS.PASSWORD_MIN_LENGTH,
    `Password must be at least ${LIMITS.PASSWORD_MIN_LENGTH} characters`,
  )
  .max(LIMITS.PASSWORD_MAX_LENGTH, 'Password is too long');

export const signupSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your full name').max(120, 'Name is too long'),
  email: emailSchema,
  password: passwordSchema,
  phone: z
    .string()
    .trim()
    .max(30, 'Phone number is too long')
    .regex(/^[\d\s()+-]*$/, 'Phone number contains invalid characters')
    .optional(),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password'),
});

/* ---------------------------------------------------------- appointments ---- */

/** ISO-8601 instant, e.g. 2026-08-12T14:30:00.000Z or with an offset. */
export const isoDateTimeSchema = z.iso.datetime({ offset: true });

/** Calendar date with no zone, as the model is asked to emit it. */
export const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD');

/** 24-hour wall-clock time. */
export const clockTimeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use the format HH:MM');

export const createAppointmentSchema = z.object({
  providerId: z.uuid('Choose a provider'),
  startsAt: isoDateTimeSchema,
  notes: z.string().trim().max(LIMITS.NOTES_MAX_LENGTH, 'Notes are too long').optional(),
  source: z.enum(APPOINTMENT_SOURCE_VALUES).optional(),
  chatSessionId: z.uuid().optional(),
});

/**
 * A YYYY-MM-DD date as local midnight, and today's local midnight, as comparable timestamps.
 *
 * Built from calendar fields rather than by parsing the string, because `new Date('2026-08-11')`
 * is midnight *UTC* — the previous day for anyone west of Greenwich. "Has that date passed?" is
 * a question about the user's own calendar, so both sides of the comparison are local.
 *
 * Read at parse time, never at import: a tab left open overnight must not still think it is
 * yesterday.
 */
const localMidnight = (isoDate) => {
  if (typeof isoDate !== 'string') return NaN;
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(year, month - 1, day).getTime();
};

const startOfToday = () => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
};

/**
 * Today or later, in the user's own timezone.
 *
 * Anything that is not a date passes. Zod carries on running a field's remaining checks after
 * a format check has already failed, so without this "not-a-date" came back as both malformed
 * *and* in the past — a second error that says nothing, on a value there is nothing to say
 * about. The format rule is the one complaint that belongs to it.
 */
const isNotPastDate = (isoDate) => {
  const chosen = localMidnight(isoDate);
  return Number.isNaN(chosen) || chosen >= startOfToday();
};

/**
 * A wall-clock time that has already gone by *on the day chosen*.
 *
 * Only ever true for today — 09:00 is not in the past on any other date, which is exactly why
 * this cannot be a rule on `time` alone. Anything unparseable is not past, for the reason above.
 */
const isPastTimeToday = (isoDate, clockTime) => {
  if (typeof clockTime !== 'string') return false;
  if (localMidnight(isoDate) !== startOfToday()) return false;

  const [hour, minute] = clockTime.split(':').map(Number);
  const now = new Date();
  return hour * 60 + minute <= now.getHours() * 60 + now.getMinutes();
};

/**
 * What the booking form submits. The form collects a date and a time separately because
 * that is the natural UI, then composes them into `startsAt` in the browser's timezone.
 *
 * The past-date rule is enforced here as well as by the date input's `min`, because `min` only
 * constrains the picker: a date typed into the field, or one the assistant prefilled from
 * "last Tuesday", reaches submit untouched. `appointmentService.book` refuses a past instant
 * regardless — this is the same rule stated early, on the field the user has to change.
 */
export const bookingFormSchema = z
  .object({
    providerId: z.uuid('Choose a provider'),
    date: calendarDateSchema.refine(isNotPastDate, 'That date has passed — choose today or later'),
    time: clockTimeSchema,
    notes: z.string().trim().max(LIMITS.NOTES_MAX_LENGTH, 'Notes are too long').optional(),
  })
  /*
   * Cross-field, so it cannot live on `time`: whether 09:00 has passed depends entirely on which
   * day was chosen. Reported against `time` anyway, because that is the field to change — moving
   * the day to fix "that time has passed today" is not what anyone means.
   */
  .refine((values) => !isPastTimeToday(values.date, values.time), {
    path: ['time'],
    message: 'That time has already passed today',
  });

export const cancelAppointmentSchema = z.object({
  reason: z.string().trim().max(300, 'Reason is too long').optional(),
});

export const rescheduleAppointmentSchema = z.object({
  startsAt: isoDateTimeSchema,
});

/** Query for a provider's free slots on one local calendar date. */
export const availabilityQuerySchema = z.object({
  providerId: z.uuid('Choose a provider'),
  date: calendarDateSchema,
});

export const providerListQuerySchema = z.object({
  specialty: z.string().trim().max(80).optional(),
});

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(LIMITS.PAGE_SIZE_MAX).default(LIMITS.PAGE_SIZE_DEFAULT),
});

export const appointmentListQuerySchema = paginationSchema.extend({
  status: z.enum(APPOINTMENT_STATUS_VALUES).optional(),
  scope: z.enum(['upcoming', 'past', 'all']).default('all'),
});

export const idParamSchema = z.object({ id: z.uuid('Not a valid id') });

/* ------------------------------------------------------------------ chat ---- */

export const createSessionSchema = z.object({
  title: z.string().trim().max(120, 'Title is too long').optional(),
});

export const sendMessageSchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, 'Type a message')
    .max(LIMITS.MESSAGE_MAX_LENGTH, `Keep it under ${LIMITS.MESSAGE_MAX_LENGTH} characters`),
});

/**
 * The conversation list is paginated by cursor rather than by page number.
 *
 * Page numbers assume a stable ordering, and this list has the opposite: it is ordered by most
 * recent activity, which changes every time the open conversation receives a message. By the
 * time someone scrolls to page two, page one has reshuffled underneath them, so an offset
 * returns rows they have already seen and skips ones they have not. A cursor names a position
 * in the ordering instead of counting from the top, so it stays correct while the list moves.
 */
export const chatSessionListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(LIMITS.PAGE_SIZE_MAX).default(20),
  // Opaque to the client; the shape below is what it must decode to.
  cursor: z.string().trim().min(1).max(400).optional(),
});

/** The decoded contents of a conversation-list cursor: the last row of the previous page. */
export const chatSessionCursorSchema = z.object({
  activityAt: isoDateTimeSchema,
  id: z.uuid(),
});

/* -------------------------------------------------- AI extraction output ---- */

/**
 * The booking details the model is asked to pull out of the conversation.
 *
 * A missing key means the same thing as an explicit null and is accepted as one. The prompt
 * asks for all five every time, and models mostly comply — but not when there is nothing to
 * report: asked "what have I got booked?", Mistral returns `"fields": {}`, which is a
 * perfectly good answer to the question. Insisting on the keys rejected the whole turn and
 * handed the person a booking form instead of their appointments.
 *
 * Values are still validated exactly as strictly. A malformed date is a failure; an absent
 * one is not.
 */
const absentAsNull = (schema) => schema.nullish().transform((value) => value ?? null);

export const bookingFieldsSchema = z
  .object({
    specialty: absentAsNull(z.string().trim().max(80)),
    providerName: absentAsNull(z.string().trim().max(120)),
    date: absentAsNull(calendarDateSchema),
    time: absentAsNull(clockTimeSchema),
    notes: absentAsNull(z.string().trim().max(LIMITS.NOTES_MAX_LENGTH)),
  })
  .default({});

/**
 * The contract the LLM must satisfy. Its output is parsed through this before anything
 * downstream trusts it — a malformed or hallucinated response degrades to the structured
 * form instead of propagating into business logic.
 */
export const aiExtractionSchema = z.object({
  intent: z.enum(CHAT_INTENT_VALUES),
  fields: bookingFieldsSchema,
  // Like `fields`: absent is a claim that nothing is missing, not a malformed response.
  missing: z.array(z.enum(BOOKING_FIELDS)).default([]),
  // The two that must be there. An unknown intent is a model inventing capabilities, and a
  // turn with no prose has nothing to show the person — both are real failures.
  reply: z.string().trim().min(1).max(1200),
});
