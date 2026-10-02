import { isOpenDate } from './accountability.js';
import { currentStreak } from './history.js';
import { checkinXp, levelFromXp } from './rpg.js';
import { weekEndOf, weekStartOf } from './time.js';

export class CheckinError extends Error {}

/** Records a workout and reports what changed: XP, level-ups, streak and pledge progress. */
export function recordCheckin(store, guild, { userId, date, kind, minutes, note }) {
  if (!isOpenDate(guild, date)) {
    throw new CheckinError("That week has already been settled, so it's too late to log a workout for it.");
  }
  const guildId = guild.guild_id;
  const minutesByDate = store.minutesByDate(guildId, userId);
  const alreadyCheckedInToday = minutesByDate.has(date);
  const dates = new Set([...minutesByDate.keys(), date]);
  const streak = currentStreak(dates, date);
  const xp = checkinXp({ minutes, streak, alreadyCheckedInToday });

  const xpBefore = store.totals(guildId, userId).xp;
  const id = store.addCheckin({ guildId, userId, localDate: date, kind, minutes, note, xp });

  const week = weekStartOf(date);
  return {
    id,
    xp,
    streak,
    levelBefore: levelFromXp(xpBefore),
    levelAfter: levelFromXp(xpBefore + xp),
    weekDays: store.workoutDays(guildId, userId, week, weekEndOf(date)),
    pledge: store.pledgeFor(guildId, userId, week),
  };
}

/** Undo is allowed for your latest check-in, within a day of posting it, while its week is still open. */
export function undoableCheckin(store, guild, userId, now = new Date()) {
  const latest = store.latestCheckin(guild.guild_id, userId);
  if (!latest) throw new CheckinError("You don't have any check-ins to undo.");
  const ageMs = now - new Date(latest.created_at);
  if (ageMs > 24 * 60 * 60 * 1000) throw new CheckinError('You can only undo a check-in within 24 hours of posting it.');
  if (!isOpenDate(guild, latest.local_date)) throw new CheckinError("That check-in's week has already been settled.");
  return latest;
}
