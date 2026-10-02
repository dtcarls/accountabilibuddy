import { addDays, daysBetween, daysLeftInWeek, lastSettleableWeek, weekStartOf } from './time.js';

/** Buddies get nudged when their partner has gone this many days (and every multiple of it) without a workout. */
export const IDLE_NUDGE_DAYS = 3;

/**
 * Settles one finished week: everyone with a pledge either hit their target
 * or gets a debt recorded. Safe to call twice for the same week.
 */
export function settleWeek(store, guildId, weekStart) {
  const weekEnd = addDays(weekStart, 6);
  const results = [];
  for (const userId of store.pledgeMembers(guildId)) {
    const pledge = store.pledgeFor(guildId, userId, weekStart);
    if (!pledge) continue;
    const done = store.workoutDays(guildId, userId, weekStart, weekEnd);
    const met = done >= pledge.target;
    const debtId = met
      ? null
      : store.addDebt({
          guildId,
          userId,
          recipientId: pledge.recipient_id,
          stake: pledge.stake,
          weekStart,
          target: pledge.target,
          done,
        });
    results.push({ userId, target: pledge.target, done, met, stake: pledge.stake, recipientId: pledge.recipient_id, debtId });
  }
  return { weekStart, weekEnd, results, leaderboard: store.leaderboard(guildId, weekStart, weekEnd) };
}

/**
 * Who needs a poke today:
 *  - atRisk: has a pledge, hasn't worked out today, and needs a workout on
 *    every remaining day (or more) to make it.
 *  - idle: has a buddy and has gone IDLE_NUDGE_DAYS, 2x, 3x... days without a workout.
 */
export function remindersFor(store, guildId, today) {
  const week = weekStartOf(today);
  const daysLeft = daysLeftInWeek(today);
  const atRisk = [];
  for (const userId of store.pledgeMembers(guildId)) {
    const pledge = store.pledgeFor(guildId, userId, week);
    if (!pledge) continue;
    if (store.workoutDays(guildId, userId, today, today) > 0) continue;
    const needed = pledge.target - store.workoutDays(guildId, userId, week, today);
    if (needed > 0 && needed >= daysLeft) {
      atRisk.push({
        userId,
        needed,
        daysLeft,
        impossible: needed > daysLeft,
        stake: pledge.stake,
        buddyId: store.getBuddy(guildId, userId),
      });
    }
  }

  const riskIds = new Set(atRisk.map((r) => r.userId));
  const idle = store
    .buddiedMembers(guildId)
    .map((m) => ({ userId: m.user_id, buddyId: m.buddy_id, daysSince: daysBetween(m.last_date, today) }))
    .filter((m) => !riskIds.has(m.userId) && m.daysSince >= IDLE_NUDGE_DAYS && m.daysSince % IDLE_NUDGE_DAYS === 0);

  return { atRisk, idle };
}

/**
 * What the scheduler should do for a server right now. Pure: reads the guild
 * row and the clock, returns the work, and leaves bookkeeping to the caller.
 */
export function dueWork(guild, local) {
  const today = local.toISODate();
  const settleable = lastSettleableWeek(local);
  const weeksToSettle = [];
  // A brand new server starts settling from its first full week rather than
  // judging weeks from before anyone made a pledge.
  if (guild.last_settled_week) {
    for (let w = addDays(guild.last_settled_week, 7); w <= settleable; w = addDays(w, 7)) weeksToSettle.push(w);
  }
  return {
    today,
    weeksToSettle,
    settledThrough: guild.last_settled_week ? (weeksToSettle.at(-1) ?? guild.last_settled_week) : settleable,
    remind: local.hour === guild.reminder_hour && guild.last_reminder_date !== today,
  };
}

/** Whether a check-in on `date` can still change anything (its week hasn't been settled yet). */
export function isOpenDate(guild, date) {
  return !guild.last_settled_week || weekStartOf(date) > guild.last_settled_week;
}
