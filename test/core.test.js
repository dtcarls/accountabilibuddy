import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DateTime } from 'luxon';
import { dueWork, isOpenDate, remindersFor, settleWeek } from '../src/accountability.js';
import { CheckinError, recordCheckin, undoableCheckin } from '../src/checkins.js';
import { bestWeek, currentStreak, longestStreak, renderHeatmap } from '../src/history.js';
import { checkinXp, levelFromXp, levelProgress, moodFor, statsFromXp, titleForLevel } from '../src/rpg.js';
import { Store } from '../src/store.js';
import { daysLeftInWeek, lastSettleableWeek, weekStartOf } from '../src/time.js';

const G = 'guild-1';

function log(store, userId, date, minutes = 30, kind = 'strength') {
  return recordCheckin(store, store.getGuild(G), { userId, date, kind, minutes });
}

describe('time', () => {
  test('weeks start on Monday', () => {
    assert.equal(weekStartOf('2026-10-04'), '2026-09-28'); // Sunday
    assert.equal(weekStartOf('2026-09-28'), '2026-09-28'); // Monday
    assert.equal(daysLeftInWeek('2026-09-28'), 7);
    assert.equal(daysLeftInWeek('2026-10-04'), 1);
  });

  test('last week only becomes settleable after the Monday grace period', () => {
    const mondayMorning = DateTime.fromISO('2026-10-05T09:00', { zone: 'America/Chicago' });
    const mondayNoon = DateTime.fromISO('2026-10-05T12:00', { zone: 'America/Chicago' });
    assert.equal(lastSettleableWeek(mondayMorning), '2026-09-21');
    assert.equal(lastSettleableWeek(mondayNoon), '2026-09-28');
  });
});

describe('rpg', () => {
  test('xp scales with minutes, streak and repeat check-ins', () => {
    assert.equal(checkinXp({ minutes: 30, streak: 1, alreadyCheckedInToday: false }), 100);
    assert.equal(checkinXp({ minutes: 500, streak: 1, alreadyCheckedInToday: false }), 280);
    assert.equal(checkinXp({ minutes: 30, streak: 20, alreadyCheckedInToday: false }), 150);
    assert.equal(checkinXp({ minutes: 30, streak: 1, alreadyCheckedInToday: true }), 50);
  });

  test('levels', () => {
    assert.equal(levelFromXp(0), 1);
    assert.equal(levelFromXp(99), 1);
    assert.equal(levelFromXp(100), 2);
    assert.equal(levelFromXp(1000), 5);
    assert.deepEqual(levelProgress(150), { level: 2, current: 50, needed: 200 });
    assert.equal(titleForLevel(1), 'Couch Potato');
    assert.equal(titleForLevel(12), 'Athlete');
  });

  test('stats follow workout kinds, "other" spreads evenly', () => {
    assert.deepEqual(statsFromXp({ strength: 300, other: 600 }), { STR: 4, END: 2, FLX: 2, AGI: 2 });
  });

  test('mood decays with time off', () => {
    assert.equal(moodFor(null).label, 'Unhatched');
    assert.equal(moodFor(0).label, 'Pumped');
    assert.equal(moodFor(8).label, 'Sad');
  });
});

describe('history', () => {
  const dates = new Set(['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-02', '2026-10-03']);

  test('streaks', () => {
    assert.equal(currentStreak(dates, '2026-10-03'), 2);
    assert.equal(currentStreak(dates, '2026-10-04'), 2); // today not logged yet, streak still alive
    assert.equal(currentStreak(dates, '2026-10-05'), 0);
    assert.equal(longestStreak(dates), 3);
    assert.equal(bestWeek(dates), 5);
  });

  test('heatmap has a row per weekday and a column per week', () => {
    const map = renderHeatmap(new Map([['2026-09-28', 20], ['2026-09-29', 45], ['2026-09-30', 90]]), '2026-10-01', 2);
    assert.deepEqual(map.split('\n'), ['⬛🟨', '⬛🟩', '⬛🔥', '⬛⬛', '⬛➖', '⬛➖', '⬛➖']);
  });
});

describe('check-ins', () => {
  test('second check-in on the same day earns half XP and does not count as a new day', () => {
    const store = new Store();
    const first = log(store, 'a', '2026-09-28');
    const second = log(store, 'a', '2026-09-28');
    assert.equal(second.xp, first.xp / 2);
    assert.equal(second.weekDays, 1);
  });

  test('reports level-ups', () => {
    const store = new Store();
    const result = log(store, 'a', '2026-09-28', 60);
    assert.equal(result.levelBefore, 1);
    assert.equal(result.levelAfter, 2);
  });

  test('cannot log into a week that has been settled', () => {
    const store = new Store();
    store.updateGuild(G, { last_settled_week: '2026-09-21' });
    assert.throws(() => log(store, 'a', '2026-09-27'), CheckinError);
    assert.doesNotThrow(() => log(store, 'a', '2026-09-28'));
    assert.equal(isOpenDate(store.getGuild(G), '2026-09-28'), true);
  });

  test('undo only within 24h', () => {
    const store = new Store();
    log(store, 'a', '2026-09-28');
    const guild = store.getGuild(G);
    assert.ok(undoableCheckin(store, guild, 'a'));
    assert.throws(() => undoableCheckin(store, guild, 'a', new Date(Date.now() + 25 * 3600e3)), CheckinError);
    assert.throws(() => undoableCheckin(store, guild, 'nobody'), CheckinError);
  });
});

describe('servers are isolated', () => {
  test('data from one guild never shows up in another', () => {
    const store = new Store();
    log(store, 'a', '2026-09-28');
    store.pairBuddies(G, 'a', 'b');
    assert.equal(store.totals('guild-2', 'a').workouts, 0);
    assert.equal(store.getBuddy('guild-2', 'a'), null);
    assert.equal(store.getBuddy(G, 'b'), 'a');
  });
});

describe('pledges and settling', () => {
  function setup() {
    const store = new Store();
    store.setPledge({ guildId: G, userId: 'a', effectiveWeek: '2026-09-28', target: 3, stake: 'Buy coffee', recipientId: 'b' });
    store.setPledge({ guildId: G, userId: 'b', effectiveWeek: '2026-09-28', target: 2, stake: '$5 to charity' });
    return store;
  }

  test('missed pledges become debts, hit pledges do not, settling twice is harmless', () => {
    const store = setup();
    log(store, 'a', '2026-09-28');
    log(store, 'a', '2026-09-28'); // same day doesn't count twice
    log(store, 'b', '2026-09-29');
    log(store, 'b', '2026-10-01');

    const { results } = settleWeek(store, G, '2026-09-28');
    const a = results.find((r) => r.userId === 'a');
    const b = results.find((r) => r.userId === 'b');
    assert.equal(a.met, false);
    assert.equal(a.done, 1);
    assert.ok(a.debtId);
    assert.equal(b.met, true);

    settleWeek(store, G, '2026-09-28');
    assert.equal(store.unpaidDebts(G, 'a').length, 1);
    assert.equal(store.unpaidDebts(G, 'b').length, 1); // b is owed the coffee
  });

  test('pledge changes take effect from their effective week', () => {
    const store = setup();
    store.setPledge({ guildId: G, userId: 'a', effectiveWeek: '2026-10-05', target: 0 });
    assert.equal(store.pledgeFor(G, 'a', '2026-09-28').target, 3);
    assert.equal(store.pledgeFor(G, 'a', '2026-10-05'), null);
    assert.equal(store.pledgeFor(G, 'a', '2026-09-21'), null);
  });

  test('reminders flag people who can no longer afford a rest day', () => {
    const store = setup();
    log(store, 'a', '2026-09-28');
    // Friday: a needs 2 more with 3 days left -> fine. Saturday: 2 needed, 2 left -> at risk.
    assert.equal(remindersFor(store, G, '2026-10-02').atRisk.some((r) => r.userId === 'a'), false);
    const saturday = remindersFor(store, G, '2026-10-03').atRisk.find((r) => r.userId === 'a');
    assert.deepEqual({ needed: saturday.needed, daysLeft: saturday.daysLeft, impossible: saturday.impossible }, {
      needed: 2,
      daysLeft: 2,
      impossible: false,
    });
    // Sunday: 2 needed, 1 left -> impossible.
    assert.equal(remindersFor(store, G, '2026-10-04').atRisk.find((r) => r.userId === 'a').impossible, true);
  });

  test('buddies get nudged every 3 idle days', () => {
    const store = new Store();
    store.pairBuddies(G, 'a', 'b');
    log(store, 'a', '2026-09-28');
    assert.equal(remindersFor(store, G, '2026-09-30').idle.length, 0);
    assert.deepEqual(remindersFor(store, G, '2026-10-01').idle, [{ userId: 'a', buddyId: 'b', daysSince: 3 }]);
    assert.equal(remindersFor(store, G, '2026-10-02').idle.length, 0);
  });
});

describe('scheduler', () => {
  const guild = { reminder_hour: 19, last_reminder_date: null, last_settled_week: null };

  test('a new server starts from the current week without settling the past', () => {
    const local = DateTime.fromISO('2026-10-02T10:00', { zone: 'UTC' });
    assert.deepEqual(dueWork(guild, local), {
      today: '2026-10-02',
      weeksToSettle: [],
      settledThrough: '2026-09-21',
      remind: false,
    });
  });

  test('catches up on every missed week and reminds once at the reminder hour', () => {
    const local = DateTime.fromISO('2026-10-13T19:05', { zone: 'UTC' });
    const work = dueWork({ ...guild, last_settled_week: '2026-09-21' }, local);
    assert.deepEqual(work.weeksToSettle, ['2026-09-28', '2026-10-05']);
    assert.equal(work.settledThrough, '2026-10-05');
    assert.equal(work.remind, true);
    assert.equal(dueWork({ ...guild, last_reminder_date: '2026-10-13' }, local).remind, false);
  });
});
