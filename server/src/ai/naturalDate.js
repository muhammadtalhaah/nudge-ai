/**
 * Natural-language date and time resolution for the offline rule-based provider.
 *
 * Only the stub provider uses this. When a real model is driving, the current date is
 * injected into the system prompt and the model is asked to emit an absolute YYYY-MM-DD —
 * resolving "next Tuesday" is exactly the kind of thing a language model is better at than a
 * regex, so we do not duplicate it there.
 *
 * All resolution happens against a caller-supplied "today", never against a hidden clock, so
 * the behaviour is testable.
 */

const WEEKDAYS = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const toIsoDate = (date) => date.toISOString().slice(0, 10);

const addDays = (date, days) => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

/**
 * Resolve a date reference to YYYY-MM-DD, or null when the text contains no date.
 *
 * Ordering matters: "day after tomorrow" must be tested before "tomorrow", otherwise the
 * shorter phrase matches first and silently gives the wrong day.
 *
 * @param {string} text
 * @param {Date} today
 * @returns {string | null}
 */
export const resolveDate = (text, today) => {
  const lower = text.toLowerCase();

  // Explicit ISO date wins outright.
  const isoMatch = /\b(\d{4}-\d{2}-\d{2})\b/.exec(lower);
  if (isoMatch?.[1]) return isoMatch[1];

  if (/\bday after tomorrow\b/.test(lower)) return toIsoDate(addDays(today, 2));
  if (/\btomorrow\b/.test(lower)) return toIsoDate(addDays(today, 1));
  if (/\btoday\b/.test(lower)) return toIsoDate(today);

  // "in 3 days"
  const inDays = /\bin (\d{1,2}) days?\b/.exec(lower);
  if (inDays?.[1]) return toIsoDate(addDays(today, Number(inDays[1])));

  // "next monday" / "on friday" / bare "tuesday"
  const weekdayMatch =
    /\b(?:next |this |on )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/.exec(
      lower,
    );
  if (weekdayMatch?.[1]) {
    const target = WEEKDAYS[weekdayMatch[1]];
    const current = today.getUTCDay();
    // Always the next occurrence: a bare weekday name never means a day in the past, and
    // "next X" on that same weekday means a week out rather than today.
    let delta = (target - current + 7) % 7;
    if (delta === 0) delta = 7;
    return toIsoDate(addDays(today, delta));
  }

  // "12 August" / "August 12"
  const monthNames = [
    'january',
    'february',
    'march',
    'april',
    'may',
    'june',
    'july',
    'august',
    'september',
    'october',
    'november',
    'december',
  ];
  const monthPattern = monthNames.join('|');
  const dayMonth = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)? (${monthPattern})\\b`).exec(lower);
  const monthDay = new RegExp(`\\b(${monthPattern}) (\\d{1,2})(?:st|nd|rd|th)?\\b`).exec(lower);

  const explicit = dayMonth
    ? { day: Number(dayMonth[1]), month: monthNames.indexOf(dayMonth[2]) }
    : monthDay
      ? { day: Number(monthDay[2]), month: monthNames.indexOf(monthDay[1]) }
      : null;

  if (explicit && explicit.month >= 0 && explicit.day >= 1 && explicit.day <= 31) {
    let year = today.getUTCFullYear();
    const candidate = new Date(Date.UTC(year, explicit.month, explicit.day));
    // A date already past this year almost certainly means next year.
    if (candidate.getTime() < today.getTime()) year += 1;
    return toIsoDate(new Date(Date.UTC(year, explicit.month, explicit.day)));
  }

  return null;
};

/**
 * Resolve a time reference to HH:MM (24-hour), or null when absent.
 *
 * Bare hours below 8 are read as afternoon ("at 3" means 15:00, not 03:00) because a clinic
 * is shut at three in the morning. Documented rather than silent, since it is a guess.
 *
 * @param {string} text
 * @returns {string | null}
 */
export const resolveTime = (text) => {
  const lower = text.toLowerCase();

  // 14:30, 9:05
  const explicit = /\b([01]?\d|2[0-3]):([0-5]\d)\s*(am|pm)?\b/.exec(lower);
  if (explicit) {
    let hour = Number(explicit[1]);
    const minute = explicit[2];
    const meridiem = explicit[3];
    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
    return `${String(hour).padStart(2, '0')}:${minute}`;
  }

  // 10am, 2 pm
  const meridiemOnly = /\b(\d{1,2})\s*(am|pm)\b/.exec(lower);
  if (meridiemOnly) {
    let hour = Number(meridiemOnly[1]);
    if (hour > 12) return null;
    if (meridiemOnly[2] === 'pm' && hour < 12) hour += 12;
    if (meridiemOnly[2] === 'am' && hour === 12) hour = 0;
    return `${String(hour).padStart(2, '0')}:00`;
  }

  // "at 3" / "at 10"
  const bare = /\bat (\d{1,2})\b(?!\s*:)/.exec(lower);
  if (bare?.[1]) {
    let hour = Number(bare[1]);
    if (hour > 23) return null;
    if (hour < 8) hour += 12;
    return `${String(hour).padStart(2, '0')}:00`;
  }

  if (/\bnoon\b|\bmidday\b/.test(lower)) return '12:00';
  if (/\bmorning\b/.test(lower)) return '09:00';
  if (/\bafternoon\b/.test(lower)) return '14:00';
  if (/\bevening\b/.test(lower)) return '17:00';

  return null;
};

/**
 * Combine a local date and time in a given IANA timezone into a UTC instant.
 *
 * Re-exported rather than implemented here. This module used to carry its own copy, and that
 * copy compared only the hour — so it could settle on the right o'clock on the wrong calendar
 * day, for times near midnight in zones far from UTC. The version in `shared/timezone.js`
 * compares the whole local date-time and is the one both the server and the browser use.
 */
export { zonedDateTimeToUtc } from '../../../shared/timezone.js';
