/**
 * Converting between instants and a timezone's wall clock.
 *
 * Appointments are instants in the database and wall-clock times to everyone who talks about
 * them. "09:00 on Tuesday" is not a moment until you say whose 09:00 — so every crossing
 * between the two needs a zone, and for this application that zone is the clinic's.
 *
 * It lives in `shared/` because both sides make the same crossing and must agree on it. The
 * server turns "the clinic opens at 09:00" into a UTC range to query, and the browser turns a
 * time somebody typed into the instant it will be booked at. Two implementations of that is two
 * chances to be off by an hour, and the off-by-one would land on a real appointment.
 *
 * There is no `Temporal` here on purpose: it is not available across the browsers and Node
 * versions this has to run on, so the conversion is done with `Intl` — which every runtime has,
 * and which owns the DST rules that make this hard.
 */

/** Read the parts of an instant as some zone's wall clock. */
const wallClockParts = (instant, timeZone) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    // Avoids the '24' that `hour12: false` can emit at midnight in some implementations.
    hourCycle: 'h23',
  }).formatToParts(instant);

const partValue = (parts, type) => Number(parts.find((part) => part.type === type)?.value ?? '0');

/**
 * The local wall-clock hour of an instant, as a decimal (10:30 → 10.5).
 *
 * Business hours and "morning" are human concepts in the clinic's own timezone, while instants
 * are stored in UTC. This is how a stored instant is judged against either.
 */
export const localHourDecimal = (instant, timeZone) => {
  const parts = wallClockParts(instant, timeZone);
  return partValue(parts, 'hour') + partValue(parts, 'minute') / 60;
};

/**
 * The calendar date an instant falls on in a timezone, as YYYY-MM-DD.
 *
 * What "today" means to the clinic, which is not always what it means to the person reading —
 * and it is the clinic's day that a relative date like "tomorrow" has to resolve against.
 */
export const zonedCalendarDate = (instant, timeZone) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);

/**
 * An instant's local wall clock in a timezone, re-encoded as if those numbers were UTC.
 *
 * Not a real instant, and not meant to be one — it is a comparable number. Subtracting it from
 * the UTC encoding of a wanted wall-clock time gives that zone's offset at that moment,
 * *including the calendar day*, which is the part an hour-only reading cannot see.
 */
const localWallClockAsUtc = (instant, timeZone) => {
  const parts = wallClockParts(instant, timeZone);

  return Date.UTC(
    partValue(parts, 'year'),
    partValue(parts, 'month') - 1,
    partValue(parts, 'day'),
    partValue(parts, 'hour'),
    partValue(parts, 'minute'),
    partValue(parts, 'second'),
  );
};

/**
 * Turn a wall-clock date and time in a timezone into the UTC instant it names.
 *
 * Works by guessing UTC, measuring how far the guess lands from the intended local time in the
 * target zone, and correcting. Two passes settle it even across a DST boundary, where the
 * offset itself depends on the instant being measured.
 *
 * Two details below are corrections to earlier versions of this, and both are load-bearing:
 *
 * The whole local date-time is compared, not the hour alone. An hour-only comparison cannot see
 * which local *day* the guess landed on, so it settles on the right o'clock on the wrong date —
 * a day early in Americas zones for hours near midnight, a day late in Asian ones for hours
 * near the end of the day. Correct in UTC, which is why fixtures in UTC never catch it.
 *
 * And hour 24 is normalised first. A clinic may close at 24 — midnight — but no timezone ever
 * reports an hour of 24, so the correction measured a drift of -24 against it and pushed the
 * guess a full day forward on every pass. A midnight close came back three days late, and every
 * "free slot" after it belonged to another day.
 *
 * @param {string} isoDate YYYY-MM-DD, a calendar date in `timeZone`.
 * @param {number} hour 0–24, where 24 is midnight ending that date.
 * @param {number} minute
 * @param {string} timeZone IANA zone name.
 * @returns {Date}
 */
export const zonedWallClockToUtc = (isoDate, hour, minute, timeZone) => {
  const [year, month, day] = isoDate.split('-').map(Number);

  // Midnight at the end of a day is midnight at the start of the next one — a real hour, on a
  // real date, which is what the correction below needs.
  const dayOffset = Math.floor(hour / 24);
  const target = Date.UTC(
    year,
    (month ?? 1) - 1,
    (day ?? 1) + dayOffset,
    hour - dayOffset * 24,
    minute,
  );

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

/**
 * The same crossing, from a `HH:MM` string. Null when either half is malformed.
 *
 * @param {string} isoDate YYYY-MM-DD in `timeZone`.
 * @param {string} clockTime HH:MM in `timeZone`.
 * @param {string} timeZone IANA zone name.
 * @returns {Date | null}
 */
export const zonedDateTimeToUtc = (isoDate, clockTime, timeZone) => {
  const dateParts = String(isoDate).split('-').map(Number);
  const timeParts = String(clockTime).split(':').map(Number);

  if (dateParts.length !== 3 || timeParts.length < 2) return null;
  if ([...dateParts, ...timeParts.slice(0, 2)].some((part) => Number.isNaN(part))) return null;

  const instant = zonedWallClockToUtc(isoDate, timeParts[0], timeParts[1], timeZone);
  return Number.isNaN(instant.getTime()) ? null : instant;
};
