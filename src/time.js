import { DateTime } from 'luxon';

// Weeks run Monday through Sunday. Every date the bot stores is a local
// calendar date (YYYY-MM-DD) in the server's configured timezone.

/** Hours into Monday before last week gets settled, so Sunday-night stragglers can still log "yesterday". */
export const WEEK_GRACE_HOURS = 12;

export function isValidTimezone(tz) {
  return typeof tz === 'string' && DateTime.now().setZone(tz).isValid;
}

export function localNow(tz, now = new Date()) {
  return DateTime.fromJSDate(now).setZone(tz);
}

function parse(date) {
  return DateTime.fromISO(date, { zone: 'utc' });
}

export function addDays(date, days) {
  return parse(date).plus({ days }).toISODate();
}

export function weekStartOf(date) {
  return parse(date).startOf('week').toISODate();
}

export function weekEndOf(date) {
  return addDays(weekStartOf(date), 6);
}

/** Days left in the week including `date` itself (Monday = 7, Sunday = 1). */
export function daysLeftInWeek(date) {
  return 8 - parse(date).weekday;
}

export function daysBetween(from, to) {
  return Math.round(parse(to).diff(parse(from), 'days').days);
}

/** The most recent week that is over (including the Monday-morning grace period). */
export function lastSettleableWeek(local) {
  const thisWeek = weekStartOf(local.toISODate());
  const inGrace = local.weekday === 1 && local.hour < WEEK_GRACE_HOURS;
  return addDays(thisWeek, inGrace ? -14 : -7);
}

export function formatDate(date) {
  return parse(date).toFormat('ccc d LLL');
}
