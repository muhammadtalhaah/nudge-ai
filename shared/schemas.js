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
 * What the booking form submits. The form collects a date and a time separately because
 * that is the natural UI, then composes them into `startsAt` in the browser's timezone.
 */
export const bookingFormSchema = z.object({
  providerId: z.uuid('Choose a provider'),
  date: calendarDateSchema,
  time: clockTimeSchema,
  notes: z.string().trim().max(LIMITS.NOTES_MAX_LENGTH, 'Notes are too long').optional(),
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
