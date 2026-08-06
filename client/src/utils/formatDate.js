/**
 * Date formatting for display.
 *
 * The API sends UTC ISO strings; these render them in the viewer's local timezone, which is
 * what someone reading their own schedule expects. All formatting goes through Intl rather
 * than hand-rolled string building.
 */

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
});

const dayFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

export const formatDateTime = (iso) => (iso ? dateTimeFormatter.format(new Date(iso)) : '');
export const formatTime = (iso) => (iso ? timeFormatter.format(new Date(iso)) : '');
export const formatDay = (iso) => (iso ? dayFormatter.format(new Date(iso)) : '');

/** Relative phrasing for recent chat timestamps; falls back to a date once it is old. */
export const formatRelative = (iso) => {
  if (!iso) return '';

  const then = new Date(iso).getTime();
  const diffSeconds = Math.round((Date.now() - then) / 1000);

  if (diffSeconds < 45) return 'just now';
  if (diffSeconds < 3600) return `${Math.round(diffSeconds / 60)}m ago`;
  if (diffSeconds < 86_400) return `${Math.round(diffSeconds / 3600)}h ago`;

  return dateTimeFormatter.format(new Date(iso));
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
 * Compose a local date and time into an ISO instant with offset.
 *
 * The booking form collects a date and a time separately because that is the natural UI. They
 * are combined in the browser's timezone, which is what the user meant when they typed them.
 */
export const toIsoInstant = (isoDate, clockTime) => {
  if (!isoDate || !clockTime) return null;
  const [hour, minute] = clockTime.split(':').map(Number);
  const [year, month, day] = isoDate.split('-').map(Number);
  const local = new Date(year, month - 1, day, hour, minute, 0, 0);
  return Number.isNaN(local.getTime()) ? null : local.toISOString();
};

/** Today's local calendar date as YYYY-MM-DD, for date input minimums. */
export const todayIsoDate = () => {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
};
