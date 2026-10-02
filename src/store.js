import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Every row is scoped by guild_id, so each Discord server that installs the
// bot has completely separate members, buddies, pledges and history.

const SCHEMA = `
CREATE TABLE IF NOT EXISTS guilds (
  guild_id TEXT PRIMARY KEY,
  channel_id TEXT,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  reminder_hour INTEGER NOT NULL DEFAULT 19,
  last_reminder_date TEXT,
  last_settled_week TEXT
);

CREATE TABLE IF NOT EXISTS checkins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  local_date TEXT NOT NULL,
  created_at TEXT NOT NULL,
  kind TEXT NOT NULL,
  minutes INTEGER NOT NULL,
  note TEXT,
  xp INTEGER NOT NULL,
  channel_id TEXT,
  message_id TEXT
);
CREATE INDEX IF NOT EXISTS checkins_by_user ON checkins (guild_id, user_id, local_date);

CREATE TABLE IF NOT EXISTS buddies (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  buddy_id TEXT NOT NULL,
  PRIMARY KEY (guild_id, user_id)
);

-- A pledge applies from effective_week onward, until a newer row replaces it.
-- Changes always start next week so nobody can lower the bar mid-week.
CREATE TABLE IF NOT EXISTS pledges (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  effective_week TEXT NOT NULL,
  target INTEGER NOT NULL,
  stake TEXT,
  recipient_id TEXT,
  PRIMARY KEY (guild_id, user_id, effective_week)
);

CREATE TABLE IF NOT EXISTS debts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  recipient_id TEXT,
  stake TEXT NOT NULL,
  week_start TEXT NOT NULL,
  target INTEGER NOT NULL,
  done INTEGER NOT NULL,
  paid_at TEXT,
  UNIQUE (guild_id, user_id, week_start)
);
`;

export class Store {
  constructor(path = ':memory:') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec(SCHEMA);
  }

  transaction(fn) {
    this.db.exec('BEGIN');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  // --- servers ---

  getGuild(guildId) {
    this.db.prepare('INSERT OR IGNORE INTO guilds (guild_id) VALUES (?)').run(guildId);
    return this.db.prepare('SELECT * FROM guilds WHERE guild_id = ?').get(guildId);
  }

  updateGuild(guildId, fields) {
    this.getGuild(guildId);
    const columns = Object.keys(fields);
    if (columns.length === 0) return;
    const sets = columns.map((c) => `${c} = ?`).join(', ');
    this.db.prepare(`UPDATE guilds SET ${sets} WHERE guild_id = ?`).run(...Object.values(fields), guildId);
  }

  // --- check-ins ---

  addCheckin({ guildId, userId, localDate, kind, minutes, note, xp }) {
    const { lastInsertRowid } = this.db
      .prepare(
        `INSERT INTO checkins (guild_id, user_id, local_date, created_at, kind, minutes, note, xp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(guildId, userId, localDate, new Date().toISOString(), kind, minutes, note ?? null, xp);
    return Number(lastInsertRowid);
  }

  setCheckinMessage(id, channelId, messageId) {
    this.db.prepare('UPDATE checkins SET channel_id = ?, message_id = ? WHERE id = ?').run(channelId, messageId, id);
  }

  deleteCheckin(id) {
    this.db.prepare('DELETE FROM checkins WHERE id = ?').run(id);
  }

  latestCheckin(guildId, userId) {
    return this.db
      .prepare('SELECT * FROM checkins WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT 1')
      .get(guildId, userId);
  }

  /** Map of local date -> total minutes worked out that day. */
  minutesByDate(guildId, userId) {
    const rows = this.db
      .prepare(
        `SELECT local_date, SUM(minutes) AS minutes FROM checkins
         WHERE guild_id = ? AND user_id = ? GROUP BY local_date`,
      )
      .all(guildId, userId);
    return new Map(rows.map((r) => [r.local_date, r.minutes]));
  }

  /** Distinct days with at least one check-in between two dates (inclusive). */
  workoutDays(guildId, userId, from, to) {
    return this.db
      .prepare(
        `SELECT COUNT(DISTINCT local_date) AS n FROM checkins
         WHERE guild_id = ? AND user_id = ? AND local_date BETWEEN ? AND ?`,
      )
      .get(guildId, userId, from, to).n;
  }

  totals(guildId, userId) {
    return this.db
      .prepare(
        `SELECT COUNT(*) AS workouts, COALESCE(SUM(minutes), 0) AS minutes, COALESCE(SUM(xp), 0) AS xp
         FROM checkins WHERE guild_id = ? AND user_id = ?`,
      )
      .get(guildId, userId);
  }

  xpByKind(guildId, userId) {
    const rows = this.db
      .prepare('SELECT kind, SUM(xp) AS xp FROM checkins WHERE guild_id = ? AND user_id = ? GROUP BY kind')
      .all(guildId, userId);
    return Object.fromEntries(rows.map((r) => [r.kind, r.xp]));
  }

  longestWorkout(guildId, userId) {
    return this.db
      .prepare('SELECT * FROM checkins WHERE guild_id = ? AND user_id = ? ORDER BY minutes DESC, id LIMIT 1')
      .get(guildId, userId);
  }

  checkinsWithProof(guildId, userId, limit) {
    return this.db
      .prepare(
        `SELECT * FROM checkins WHERE guild_id = ? AND user_id = ? AND message_id IS NOT NULL
         ORDER BY id DESC LIMIT ?`,
      )
      .all(guildId, userId, limit);
  }

  leaderboard(guildId, from, to) {
    return this.db
      .prepare(
        `SELECT user_id, COUNT(DISTINCT local_date) AS days, SUM(minutes) AS minutes, SUM(xp) AS xp
         FROM checkins WHERE guild_id = ? AND local_date BETWEEN ? AND ?
         GROUP BY user_id ORDER BY xp DESC, days DESC LIMIT 10`,
      )
      .all(guildId, from, to);
  }

  /** Members who have a buddy and have checked in at least once. */
  buddiedMembers(guildId) {
    return this.db
      .prepare(
        `SELECT b.user_id, b.buddy_id, MAX(c.local_date) AS last_date
         FROM buddies b JOIN checkins c ON c.guild_id = b.guild_id AND c.user_id = b.user_id
         WHERE b.guild_id = ? GROUP BY b.user_id, b.buddy_id`,
      )
      .all(guildId);
  }

  // --- buddies ---

  getBuddy(guildId, userId) {
    return this.db.prepare('SELECT buddy_id FROM buddies WHERE guild_id = ? AND user_id = ?').get(guildId, userId)
      ?.buddy_id ?? null;
  }

  pairBuddies(guildId, a, b) {
    this.transaction(() => {
      const insert = this.db.prepare('INSERT INTO buddies (guild_id, user_id, buddy_id) VALUES (?, ?, ?)');
      insert.run(guildId, a, b);
      insert.run(guildId, b, a);
    });
  }

  /** Removes the pairing in both directions and returns the former buddy's id. */
  unpairBuddy(guildId, userId) {
    const buddyId = this.getBuddy(guildId, userId);
    if (!buddyId) return null;
    this.db
      .prepare('DELETE FROM buddies WHERE guild_id = ? AND user_id IN (?, ?)')
      .run(guildId, userId, buddyId);
    return buddyId;
  }

  // --- pledges ---

  setPledge({ guildId, userId, effectiveWeek, target, stake = null, recipientId = null }) {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO pledges (guild_id, user_id, effective_week, target, stake, recipient_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(guildId, userId, effectiveWeek, target, stake, recipientId);
  }

  /** The pledge in force for a given week, or null if none (target 0 means cleared). */
  pledgeFor(guildId, userId, week) {
    const row = this.db
      .prepare(
        `SELECT * FROM pledges WHERE guild_id = ? AND user_id = ? AND effective_week <= ?
         ORDER BY effective_week DESC LIMIT 1`,
      )
      .get(guildId, userId, week);
    return row && row.target > 0 ? row : null;
  }

  pledgeMembers(guildId) {
    return this.db
      .prepare('SELECT DISTINCT user_id FROM pledges WHERE guild_id = ?')
      .all(guildId)
      .map((r) => r.user_id);
  }

  // --- debts ---

  /** Records a missed pledge. Returns the new id, or null if that week was already recorded. */
  addDebt({ guildId, userId, recipientId, stake, weekStart, target, done }) {
    const { changes, lastInsertRowid } = this.db
      .prepare(
        `INSERT OR IGNORE INTO debts (guild_id, user_id, recipient_id, stake, week_start, target, done)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(guildId, userId, recipientId, stake, weekStart, target, done);
    return changes ? Number(lastInsertRowid) : null;
  }

  getDebt(guildId, id) {
    return this.db.prepare('SELECT * FROM debts WHERE guild_id = ? AND id = ?').get(guildId, id);
  }

  unpaidDebts(guildId, userId) {
    return this.db
      .prepare(
        `SELECT * FROM debts WHERE guild_id = ? AND paid_at IS NULL AND (user_id = ? OR recipient_id = ?)
         ORDER BY id`,
      )
      .all(guildId, userId, userId);
  }

  markDebtPaid(id) {
    this.db.prepare('UPDATE debts SET paid_at = ? WHERE id = ?').run(new Date().toISOString(), id);
  }
}
