/**
 * Appointment business rules.
 *
 * This module is the single gate for creating, reading and cancelling appointments. The REST
 * controllers call it, and so does the chat assistant — which means the assistant cannot
 * book anything a direct API call could not, and every rule below is enforced exactly once.
 */

import { APPOINTMENT_STATUS, ERROR_CODES } from '../../../shared/constants.js';

import { pool, withTransaction } from '../db/pool.js';
import { BadRequestError, NotFoundError } from '../errors/AppError.js';
import { translatePgError } from '../errors/pgErrors.js';
import { logger } from '../logger/index.js';
import appointmentRepository from '../repositories/appointmentRepository.js';
import businessRepository from '../repositories/businessRepository.js';
import providerRepository from '../repositories/providerRepository.js';

/**
 * Who is asking. Always derived from a verified token, never from request data — every
 * function in this module scopes its work to these three fields and nothing else.
 *
 * @typedef {object} Caller
 * @property {string} userId
 * @property {string} businessId
 * @property {string} role One of USER_ROLES.
 */

/** Admins may read across the tenant; everyone else only sees their own records. */
const canReadAnyRecord = (caller) => caller.role === 'admin';

/**
 * Translate database constraint violations into domain errors at the service boundary.
 *
 * The error middleware does this too, as a safety net for the HTTP path. Doing it here as
 * well matters because this service has a second caller — the chat assistant — which needs to
 * *handle* a rejected booking (by offering the structured form) rather than let it become a
 * 409 response. A service that leaks driver errors forces every caller to understand
 * SQLSTATE codes, so it is translated once, here.
 */
const asDomainError = async (operation) => {
  try {
    return await operation();
  } catch (error) {
    const translated = translatePgError(error);
    if (translated) throw translated;
    throw error;
  }
};

/**
 * The local wall-clock hour of an instant, in a given IANA timezone.
 *
 * Business hours are a human concept in the clinic's own timezone, while instants are
 * stored in UTC. `hourCycle: 'h23'` avoids the '24' that `hour12: false` can emit at
 * midnight in some implementations.
 */
const localHourDecimal = (instant, timeZone) => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);

  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return hour + minute / 60;
};

/**
 * An instant's local wall clock in a timezone, re-encoded as if those numbers were UTC.
 *
 * Not a real instant, and not meant to be one — it is a comparable number. Subtracting it
 * from the UTC encoding of a wanted wall-clock time gives that zone's offset at that moment,
 * including the calendar day, which is the part an hour-only reading cannot see.
 */
const localWallClockAsUtc = (instant, timeZone) => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);

  const value = (type) => Number(parts.find((part) => part.type === type)?.value ?? '0');

  return Date.UTC(
    value('year'),
    value('month') - 1,
    value('day'),
    value('hour'),
    value('minute'),
    value('second'),
  );
};

/**
 * Book an appointment.
 *
 * Confirms immediately: this prototype has no staff role, so a PENDING appointment would
 * have nobody to approve it. The status column still models the full lifecycle, so adding
 * an approval queue is a service change rather than a migration.
 *
 * @param {Caller} caller
 * @param {{ providerId: string, startsAt: Date, notes?: string | null, source?: string,
 *           chatSessionId?: string | null }} input
 */
export const book = async (caller, input) => {
  const provider = await providerRepository.findById(pool, caller.businessId, input.providerId);

  // Scoped by the caller's tenant, so a provider id from another business is reported as
  // not-found rather than confirming it exists.
  if (!provider) throw new NotFoundError('Provider');

  if (!provider.isActive) {
    throw new BadRequestError(
      ERROR_CODES.PROVIDER_UNAVAILABLE,
      `${provider.fullName} is not currently taking appointments`,
    );
  }

  if (input.startsAt.getTime() <= Date.now()) {
    throw new BadRequestError(ERROR_CODES.SLOT_IN_PAST, 'Choose a time in the future');
  }

  const business = await businessRepository.findById(pool, caller.businessId);
  if (!business) throw new NotFoundError('Business');

  const endsAt = new Date(input.startsAt.getTime() + provider.slotDurationMinutes * 60_000);

  const startHour = localHourDecimal(input.startsAt, business.timezone);
  const endHour = startHour + provider.slotDurationMinutes / 60;

  if (startHour < business.openHour || endHour > business.closeHour) {
    throw new BadRequestError(
      ERROR_CODES.OUTSIDE_BUSINESS_HOURS,
      `Appointments run between ${String(business.openHour).padStart(2, '0')}:00 and ` +
        `${String(business.closeHour).padStart(2, '0')}:00`,
    );
  }

  // No availability pre-check. The exclusion constraint decides, atomically.
  const appointment = await asDomainError(() =>
    appointmentRepository.create(pool, {
      businessId: caller.businessId,
      userId: caller.userId,
      providerId: provider.id,
      startsAt: input.startsAt,
      endsAt,
      status: APPOINTMENT_STATUS.CONFIRMED,
      notes: input.notes ?? null,
      source: input.source ?? 'form',
      chatSessionId: input.chatSessionId ?? null,
    }),
  );

  logger.info(
    {
      appointmentId: appointment.id,
      userId: caller.userId,
      providerId: provider.id,
      source: appointment.source,
    },
    'appointment booked',
  );

  return appointment;
};

/**
 * Always scoped to the caller — there is no code path that lists another user's records.
 *
 * @param {Caller} caller
 * @param {{ status?: string, scope: 'upcoming' | 'past' | 'all', page: number,
 *           limit: number }} input
 */
export const list = async (caller, input) =>
  appointmentRepository.listForUser(pool, {
    userId: caller.userId,
    status: input.status,
    scope: input.scope,
    page: input.page,
    limit: input.limit,
  });

/**
 * Fetch one appointment, enforcing ownership.
 *
 * Ownership lives here rather than in middleware because it needs the loaded record. The
 * error is 404, not 403: telling an attacker "this exists but is not yours" leaks that the
 * id is real.
 *
 * @param {Caller} caller
 */
export const getById = async (caller, id) => {
  const appointment = await appointmentRepository.findById(pool, id);

  if (!appointment) throw new NotFoundError('Appointment');

  const isOwner = appointment.userId === caller.userId;
  const isSameTenantAdmin =
    canReadAnyRecord(caller) && appointment.businessId === caller.businessId;

  if (!isOwner && !isSameTenantAdmin) {
    logger.warn(
      { callerId: caller.userId, appointmentId: id, ownerId: appointment.userId },
      'blocked cross-user appointment access',
    );
    throw new NotFoundError('Appointment');
  }

  return appointment;
};

/**
 * Cancel an appointment, freeing its slot for someone else.
 *
 * The status guard is in the UPDATE's WHERE clause, so a double-cancel or a cancel of a
 * completed appointment changes no rows and is reported as an invalid transition.
 *
 * @param {Caller} caller
 */
export const cancel = async (caller, id, reason) => {
  // Reuses getById so the ownership rule has exactly one implementation.
  const existing = await getById(caller, id);

  if (existing.status === APPOINTMENT_STATUS.CANCELLED) {
    throw new BadRequestError(
      ERROR_CODES.INVALID_STATUS_TRANSITION,
      'That appointment is already cancelled',
    );
  }

  const cancelled = await appointmentRepository.cancel(pool, id, reason ?? null);

  if (!cancelled) {
    throw new BadRequestError(
      ERROR_CODES.INVALID_STATUS_TRANSITION,
      `A ${existing.status.toLowerCase()} appointment cannot be cancelled`,
    );
  }

  logger.info({ appointmentId: id, userId: caller.userId }, 'appointment cancelled');
  return cancelled;
};

/**
 * Reschedule = cancel the old appointment and book a new one, atomically.
 *
 * Both happen in one transaction so the old slot is never released without the new one
 * being secured. If the new time is taken, the exclusion constraint aborts the transaction
 * and the original appointment is left untouched.
 *
 * @param {Caller} caller
 * @param {string} id
 * @param {Date} newStartsAt
 */
export const reschedule = async (caller, id, newStartsAt) => {
  const existing = await getById(caller, id);

  if (
    existing.status !== APPOINTMENT_STATUS.CONFIRMED &&
    existing.status !== APPOINTMENT_STATUS.PENDING
  ) {
    throw new BadRequestError(
      ERROR_CODES.INVALID_STATUS_TRANSITION,
      `A ${existing.status.toLowerCase()} appointment cannot be rescheduled`,
    );
  }

  if (newStartsAt.getTime() <= Date.now()) {
    throw new BadRequestError(ERROR_CODES.SLOT_IN_PAST, 'Choose a time in the future');
  }

  const provider = await providerRepository.findById(pool, caller.businessId, existing.providerId);
  if (!provider) throw new NotFoundError('Provider');

  const business = await businessRepository.findById(pool, caller.businessId);
  if (!business) throw new NotFoundError('Business');

  const startHour = localHourDecimal(newStartsAt, business.timezone);
  if (
    startHour < business.openHour ||
    startHour + provider.slotDurationMinutes / 60 > business.closeHour
  ) {
    throw new BadRequestError(
      ERROR_CODES.OUTSIDE_BUSINESS_HOURS,
      `Appointments run between ${String(business.openHour).padStart(2, '0')}:00 and ` +
        `${String(business.closeHour).padStart(2, '0')}:00`,
    );
  }

  return asDomainError(() =>
    withTransaction(async (tx) => {
      // Cancelling first releases the old slot within the transaction, which also makes
      // moving an appointment by a few minutes (overlapping itself) possible.
      const released = await appointmentRepository.cancel(tx, id, 'Rescheduled');
      if (!released) {
        throw new BadRequestError(
          ERROR_CODES.INVALID_STATUS_TRANSITION,
          'That appointment can no longer be rescheduled',
        );
      }

      const replacement = await appointmentRepository.create(tx, {
        businessId: caller.businessId,
        userId: caller.userId,
        providerId: existing.providerId,
        startsAt: newStartsAt,
        endsAt: new Date(newStartsAt.getTime() + provider.slotDurationMinutes * 60_000),
        status: APPOINTMENT_STATUS.CONFIRMED,
        notes: existing.notes,
        source: existing.source,
        chatSessionId: existing.chatSessionId,
      });

      logger.info(
        { previousId: id, appointmentId: replacement.id, userId: caller.userId },
        'appointment rescheduled',
      );

      return replacement;
    }),
  );
};

/**
 * Free slots for a provider on a given local date.
 *
 * Generated from business hours and the provider's slot length, minus anything already
 * booked. Deliberately simple: this prototype has no per-provider working hours or
 * time-off, so availability is "open during business hours unless taken".
 *
 * @param {Caller} caller
 * @param {string} providerId
 * @param {string} date YYYY-MM-DD in the business timezone.
 * @returns {Promise<{ providerId: string, date: string, slots: string[] }>}
 */
export const getAvailability = async (caller, providerId, date) => {
  const provider = await providerRepository.findById(pool, caller.businessId, providerId);
  if (!provider || !provider.isActive) throw new NotFoundError('Provider');

  const business = await businessRepository.findById(pool, caller.businessId);
  if (!business) throw new NotFoundError('Business');

  // Interpret the requested date in the business's timezone by finding the UTC instant
  // whose local wall clock reads openHour on that date.
  const dayStartUtc = zonedWallClockToUtc(date, business.openHour, business.timezone);
  const dayEndUtc = zonedWallClockToUtc(date, business.closeHour, business.timezone);

  const booked = await appointmentRepository.listBookedTimesForProvider(
    pool,
    providerId,
    dayStartUtc,
    dayEndUtc,
  );

  const stepMs = provider.slotDurationMinutes * 60_000;
  const slots = [];
  const now = Date.now();

  for (
    let cursor = dayStartUtc.getTime();
    cursor + stepMs <= dayEndUtc.getTime();
    cursor += stepMs
  ) {
    if (cursor <= now) continue; // never offer a slot in the past

    const slotStart = cursor;
    const slotEnd = cursor + stepMs;
    const overlaps = booked.some(
      (b) => slotStart < b.endsAt.getTime() && slotEnd > b.startsAt.getTime(),
    );

    if (!overlaps) slots.push(new Date(slotStart).toISOString());
  }

  return { providerId, date, slots };
};

/**
 * Convert a wall-clock hour on a calendar date in a timezone into the corresponding UTC
 * instant.
 *
 * Works by guessing UTC, measuring how far the guess lands from the intended local time in
 * the target zone, and correcting. Two passes settle it even across a DST boundary, where
 * the offset itself depends on the instant.
 *
 * Both details below are corrections to an earlier version that compared only the hour:
 *
 * The whole local date-time is compared, not the hour alone. An hour-only comparison cannot
 * see which local *day* the guess landed on, so it happily settled on the right o'clock on the
 * wrong date — a day early in Americas zones for early opening hours, a day late in Asian
 * ones for late closing hours. Correct in UTC, which is why the fixtures never caught it.
 *
 * And hour 24 is normalised first. `close_hour` may be 24 — a clinic open until midnight —
 * but no timezone reports an hour of 24, so the correction measured a drift of -24 against it
 * and pushed the guess a full day forward on each pass. A midnight close came back three days
 * late, and every "free slot" after it belonged to another day.
 */
const zonedWallClockToUtc = (isoDate, hour, timeZone) => {
  const [year, month, day] = isoDate.split('-').map(Number);

  // Midnight at the end of a day is midnight at the start of the next one — a real hour, on a
  // real date, which is what the loop below needs.
  const dayOffset = Math.floor(hour / 24);
  const target = Date.UTC(year, (month ?? 1) - 1, (day ?? 1) + dayOffset, hour - dayOffset * 24);

  let guess = target;

  for (let pass = 0; pass < 2; pass += 1) {
    // The guess's local wall clock, read back as though those numbers were UTC. Its distance
    // from the target is exactly the zone offset to remove.
    const driftMs = localWallClockAsUtc(new Date(guess), timeZone) - target;
    if (Math.abs(driftMs) < 30_000) break;
    guess -= driftMs;
  }

  return new Date(guess);
};

export default { book, list, getById, cancel, reschedule, getAvailability };
