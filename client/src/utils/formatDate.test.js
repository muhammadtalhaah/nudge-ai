/**
 * Rendering an instant, and the zone that decision is made in.
 *
 * The bug these protect against is the one that made "next Tuesday morning" come back as a list
 * running 14:00 to 21:30: the clinic keeps its hours in one zone, the reader's browser is in
 * another, and every function here has to be explicit about which one it means.
 *
 * The assertions avoid literal locale output wherever the locale would decide it — the suite must
 * not start failing because it ran on a machine set to a different one. What is asserted is the
 * part that is a contract: the hour and minute for a given zone, the instant a wall clock names,
 * and the fact that the two are inverses.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { formatClockValue, toIsoInstant, todayIsoDate, zoneLabel } from './formatDate';

/** Mid-August: the northern-hemisphere zones below are all on summer time. */
const NINE_UTC = '2026-08-18T09:00:00.000Z';

describe('formatClockValue', () => {
  it('reads an instant as the clinic clock, not the reader’s', () => {
    expect(formatClockValue(NINE_UTC, 'UTC')).toBe('09:00');
    // +5, so the clinic's morning slot is the middle of this reader's afternoon. Showing them
    // "14:00" under a sentence about Tuesday morning is the reported bug.
    expect(formatClockValue(NINE_UTC, 'Asia/Karachi')).toBe('14:00');
    expect(formatClockValue(NINE_UTC, 'America/New_York')).toBe('05:00');
  });

  it('emits 24-hour HH:MM whatever the runtime locale prefers', () => {
    // The suite runs under en-US, which formats 09:00 as "09:00 AM" by default. That string is
    // rejected by both `<input type="time">` and clockTimeSchema, so a slot button built from it
    // silently could not be booked.
    const value = formatClockValue(NINE_UTC, 'UTC');
    expect(value).toMatch(/^\d{2}:\d{2}$/);
    expect(value).not.toMatch(/[AP]M/i);
  });

  it('calls midnight 00:00 rather than 24:00', () => {
    expect(formatClockValue('2026-08-18T00:00:00.000Z', 'UTC')).toBe('00:00');
  });

  it('is empty for a missing instant rather than throwing', () => {
    expect(formatClockValue(null, 'UTC')).toBe('');
    expect(formatClockValue(undefined, 'UTC')).toBe('');
  });
});

describe('toIsoInstant', () => {
  it('reads the typed time as the clinic’s wall clock', () => {
    expect(toIsoInstant('2026-08-18', '09:00', 'UTC')).toBe(NINE_UTC);
    expect(toIsoInstant('2026-08-18', '09:00', 'Asia/Karachi')).toBe('2026-08-18T04:00:00.000Z');
    expect(toIsoInstant('2026-08-18', '09:00', 'America/New_York')).toBe(
      '2026-08-18T13:00:00.000Z',
    );
  });

  it('falls back to the viewer’s zone when the clinic’s is unknown', () => {
    // Not a fixed string: the point is only that it still produces a usable instant, so a session
    // missing its tenant degrades instead of failing to book.
    expect(toIsoInstant('2026-08-18', '09:00', null)).toMatch(/^2026-08-1[789]T\d{2}:00:00\.000Z$/);
  });

  /**
   * The property the booking form depends on.
   *
   * Its slot buttons label themselves with `formatClockValue` and submit through `toIsoInstant`.
   * If those two disagree by an offset, clicking "09:00" books something else — which is the
   * failure that does not look like a bug until someone turns up at the wrong hour.
   */
  it('round-trips against formatClockValue in every zone', () => {
    for (const timeZone of ['UTC', 'Asia/Karachi', 'America/New_York', 'Australia/Adelaide']) {
      for (const clockTime of ['00:00', '09:00', '13:30', '23:30']) {
        const instant = toIsoInstant('2026-08-18', clockTime, timeZone);
        expect(formatClockValue(instant, timeZone), `${timeZone} ${clockTime}`).toBe(clockTime);
      }
    }
  });

  it('survives a daylight-saving transition', () => {
    // 08 March 2026, 02:00 local, is when New York springs forward. An hour either side of it
    // resolves against a different offset, and a naive conversion lands on the wrong one.
    expect(toIsoInstant('2026-03-08', '01:00', 'America/New_York')).toBe(
      '2026-03-08T06:00:00.000Z',
    );
    expect(toIsoInstant('2026-03-08', '03:00', 'America/New_York')).toBe(
      '2026-03-08T07:00:00.000Z',
    );
  });

  it('is null when either half is missing', () => {
    expect(toIsoInstant('', '09:00', 'UTC')).toBeNull();
    expect(toIsoInstant('2026-08-18', '', 'UTC')).toBeNull();
  });
});

describe('todayIsoDate', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is the clinic’s calendar day, which is not always the reader’s', () => {
    // 21:00 at the clinic is already tomorrow for anyone five hours east. The date input's floor
    // has to follow the clinic, because that is the calendar the appointment lands on.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-18T21:00:00.000Z'));

    expect(todayIsoDate('UTC')).toBe('2026-08-18');
    expect(todayIsoDate('Asia/Karachi')).toBe('2026-08-19');
    expect(todayIsoDate('America/New_York')).toBe('2026-08-18');
  });
});

describe('zoneLabel', () => {
  it('names the zone so a reader knows the times are not theirs', () => {
    expect(zoneLabel('UTC', NINE_UTC)).toBe('UTC');
    expect(zoneLabel('Asia/Karachi', NINE_UTC)).toBe('GMT+5');
  });

  it('is empty when there is no clinic zone to name', () => {
    // The caption is hidden in that case rather than reading "Clinic time ()".
    expect(zoneLabel(null)).toBe('');
  });
});
