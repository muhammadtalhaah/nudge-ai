/**
 * Date formatting for display.
 *
 * The API sends UTC ISO strings, and rendering one means choosing a timezone. This module makes
 * that choice explicit, because the right answer is not the same for everything on screen:
 *
 *   An appointment or a free slot is a time to physically be at the clinic, so it is shown in
 *   the CLINIC's zone. Anything else is a lie of omission — a clinic in UTC offering 09:00 was
 *   being drawn as "14:00" to a reader five hours east, who then reads "Tuesday morning" over a
 *   list of afternoons. Those functions take a `timeZone` and are given the clinic's.
 *
 *   A message timestamp ("2h ago", "yesterday") is about the reader's own day, not the clinic's,
 *   so it stays in the viewer's zone and takes no argument.
 *
 * A `timeZone` of null or undefined falls back to the viewer's zone. That is deliberate: the
 * clinic zone arrives with the session, and if it is ever missing the UI degrades to what it
 * did before rather than rendering nothing.
 *
 * All formatting goes through Intl rather than hand-rolled string building.
 */

import { zonedCalendarDate, zonedDateTimeToUtc } from '@shared/timezone.js';

/**
 * `Intl.DateTimeFormat` construction is the expensive part, and these are rebuilt on every
 * render of every row. Cached per shape-and-zone; the set of zones in play is one.
 */
const formatters = new Map();

const formatterFor = (key, timeZone, options) => {
  const cacheKey = `${key}|${timeZone ?? 'local'}`;
  let formatter = formatters.get(cacheKey);

  if (!formatter) {
    // `timeZone: undefined` is what Intl wants for "the runtime's zone" — an explicit null
    // throws, so it is normalised here rather than at every call site.
    formatter = new Intl.DateTimeFormat(undefined, { ...options, timeZone: timeZone ?? undefined });
    formatters.set(cacheKey, formatter);
  }

  return formatter;
};

const DATE_TIME = {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
};
const TIME = { hour: '2-digit', minute: '2-digit' };
const DAY = { weekday: 'long', day: 'numeric', month: 'long' };

/**
 * A day and a time, in the clinic's zone: "Tue 18 Aug, 09:00".
 *
 * @param {string} iso
 * @param {string | null} [timeZone] The clinic's IANA zone.
 */
export const formatDateTime = (iso, timeZone) =>
  iso ? formatterFor('dateTime', timeZone, DATE_TIME).format(new Date(iso)) : '';

/**
 * A clock time in the clinic's zone: "09:00".
 *
 * @param {string} iso
 * @param {string | null} [timeZone] The clinic's IANA zone.
 */
export const formatTime = (iso, timeZone) =>
  iso ? formatterFor('time', timeZone, TIME).format(new Date(iso)) : '';

/**
 * The same instant as a canonical 24-hour `HH:MM` in the clinic's zone.
 *
 * Not a display format — a *value*. `<input type="time">` and `clockTimeSchema` both accept only
 * this shape, so anything that fills the time field has to produce it. `formatTime` cannot: it
 * follows the reader's locale, which in a 12-hour one yields "02:00 PM" and is rejected.
 *
 * Locale-proof by construction rather than by pinning one: `hourCycle: 'h23'` overrides whatever
 * the runtime's locale prefers (and rules out the '24' that `hour12: false` can emit at midnight),
 * and reading the hour and minute out as *parts* means no separator, meridiem or numbering system
 * can get into the result.
 */
export const formatClockValue = (iso, timeZone) => {
  if (!iso) return '';

  const parts = formatterFor('clockValue', timeZone, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));

  const hour = parts.find((part) => part.type === 'hour')?.value ?? '00';
  const minute = parts.find((part) => part.type === 'minute')?.value ?? '00';
  return `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
};

/**
 * The short name of a timezone at a given instant: "UTC", "GMT+5".
 *
 * Shown next to clinic times so a reader in another zone knows these are not theirs. Taken at an
 * instant rather than in the abstract because the abbreviation moves with daylight saving.
 */
export const zoneLabel = (timeZone, iso) => {
  if (!timeZone) return '';

  const parts = formatterFor('zoneName', timeZone, {
    hour: '2-digit',
    timeZoneName: 'short',
  }).formatToParts(iso ? new Date(iso) : new Date());

  return parts.find((part) => part.type === 'timeZoneName')?.value ?? '';
};

/** Relative phrasing for recent chat timestamps; falls back to a date once it is old. */
export const formatRelative = (iso) => {
  if (!iso) return '';

  const then = new Date(iso).getTime();
  const diffSeconds = Math.round((Date.now() - then) / 1000);

  if (diffSeconds < 45) return 'just now';
  if (diffSeconds < 3600) return `${Math.round(diffSeconds / 60)}m ago`;
  if (diffSeconds < 86_400) return `${Math.round(diffSeconds / 3600)}h ago`;

  // Viewer-local, like the rest of this function: it is describing when the reader was sent
  // something, not when they are due at a clinic.
  return formatterFor('dateTime', null, DATE_TIME).format(new Date(iso));
};

/**
 * Which recency bucket an instant falls into: 'today' | 'yesterday' | 'week' | 'older'.
 *
 * Buckets are calendar-based, not elapsed-time based, because that is how people read their
 * own history — something at 11pm last night is "yesterday" at 1am, not "2h ago". Comparing
 * midnights rather than subtracting milliseconds is also what keeps it correct across a
 * daylight-saving boundary, where a "day" is not 24 hours.
 */
export const recencyBucket = (iso) => {
  if (!iso) return 'older';

  const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return 'older';

  const days = Math.round((startOfDay(new Date()) - startOfDay(then)) / 86_400_000);

  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return 'week';
  return 'older';
};

/** True when the instant falls on today's local calendar date. */
export const isToday = (iso) => {
  if (!iso) return false;
  const date = new Date(iso);
  const now = new Date();
  return (
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear()
  );
};

/**
 * Compose a date and a wall-clock time into an ISO instant.
 *
 * The booking form collects them separately because that is the natural UI, and combines them
 * in the CLINIC's zone — the picker's times are the clinic's, so the time somebody types into
 * it is the clinic's too. Combining in the browser's zone instead would book a slot several
 * hours from the one on the screen.
 *
 * @param {string} isoDate YYYY-MM-DD
 * @param {string} clockTime HH:MM
 * @param {string | null} [timeZone] The clinic's IANA zone; the viewer's when absent.
 */
export const toIsoInstant = (isoDate, clockTime, timeZone) => {
  if (!isoDate || !clockTime) return null;

  if (timeZone) {
    const instant = zonedDateTimeToUtc(isoDate, clockTime, timeZone);
    return instant ? instant.toISOString() : null;
  }

  const [hour, minute] = clockTime.split(':').map(Number);
  const [year, month, day] = isoDate.split('-').map(Number);
  const local = new Date(year, month - 1, day, hour, minute, 0, 0);
  return Number.isNaN(local.getTime()) ? null : local.toISOString();
};

/**
 * Today's calendar date as YYYY-MM-DD, for date input minimums.
 *
 * The clinic's today, not the reader's. Late in the evening for anyone east of the clinic those
 * are different dates, and it is the clinic's calendar the appointment lands on.
 *
 * @param {string | null} [timeZone] The clinic's IANA zone; the viewer's when absent.
 */
export const todayIsoDate = (timeZone) => {
  if (timeZone) return zonedCalendarDate(new Date(), timeZone);

  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
};
