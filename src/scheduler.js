import { userMention } from 'discord.js';
import { dueWork, remindersFor, settleWeek } from './accountability.js';
import { leaderboardLines } from './commands/leaderboard.js';
import { COLOR, pingLine, plural } from './commands/shared.js';
import { formatDate, localNow } from './time.js';

const TICK_MS = 60 * 1000;

export function startScheduler(client, store) {
  const tick = async () => {
    for (const discordGuild of client.guilds.cache.values()) {
      try {
        await runGuild(client, store, discordGuild.id);
      } catch (err) {
        console.error(`Scheduler failed for guild ${discordGuild.id}`, err);
      }
    }
  };
  tick();
  return setInterval(tick, TICK_MS);
}

async function runGuild(client, store, guildId) {
  const guild = store.getGuild(guildId);
  const work = dueWork(guild, localNow(guild.timezone));
  const channel = guild.channel_id ? await client.channels.fetch(guild.channel_id).catch(() => null) : null;

  for (const week of work.weeksToSettle) {
    const summary = settleWeek(store, guildId, week);
    // Record progress per week so a crash mid-catch-up doesn't re-announce.
    store.updateGuild(guildId, { last_settled_week: week });
    const message = weeklyMessage(summary);
    if (channel && message) await channel.send(message);
  }
  if (!guild.last_settled_week) store.updateGuild(guildId, { last_settled_week: work.settledThrough });

  if (work.remind) {
    store.updateGuild(guildId, { last_reminder_date: work.today });
    const message = reminderMessage(remindersFor(store, guildId, work.today));
    if (channel && message) await channel.send(message);
  }
}

export function weeklyMessage({ weekStart, results, leaderboard }) {
  if (results.length === 0 && leaderboard.length === 0) return null;
  const kept = results.filter((r) => r.met);
  const missed = results.filter((r) => !r.met);
  const fields = [];
  if (kept.length) {
    fields.push({
      name: '✅ Pledges kept',
      value: kept.map((r) => `${userMention(r.userId)} (${r.done}/${r.target})`).join(', '),
    });
  }
  if (missed.length) {
    fields.push({
      name: '💸 Pledges missed',
      value: missed
        .map(
          (r) =>
            `${userMention(r.userId)} did ${r.done}/${r.target} and owes **${r.stake}**` +
            (r.recipientId ? ` to ${userMention(r.recipientId)}` : '') +
            (r.debtId ? ` (stake #${r.debtId})` : ''),
        )
        .join('\n'),
    });
  }
  if (leaderboard.length) {
    fields.push({ name: '🏆 Top of the week', value: leaderboardLines(leaderboard.slice(0, 3)).join('\n') });
  }
  return {
    embeds: [
      {
        color: missed.length ? COLOR.warn : COLOR.good,
        title: `📅 Week of ${formatDate(weekStart)}: results`,
        fields,
        footer: missed.length ? { text: 'Pay up, then whoever is owed runs /pledge paid <stake #>.' } : undefined,
      },
    ],
    ...pingLine(...missed.flatMap((r) => [r.userId, r.recipientId])),
  };
}

export function reminderMessage({ atRisk, idle }) {
  if (atRisk.length === 0 && idle.length === 0) return null;
  const lines = ['⏰ **Daily accountability check**'];
  for (const r of atRisk) {
    const buddy = r.buddyId ? ` ${userMention(r.buddyId)}, go get them!` : '';
    lines.push(
      r.impossible
        ? `💸 ${userMention(r.userId)} can't make their pledge this week anymore (needs ${r.needed} in ${plural(r.daysLeft, 'day')}). Stake due Monday: **${r.stake}**.${buddy}`
        : `🚨 ${userMention(r.userId)} needs a workout **every remaining day** to keep their pledge (${r.needed} more in ${plural(r.daysLeft, 'day')}).${buddy}`,
    );
  }
  for (const m of idle) {
    lines.push(`👀 ${userMention(m.buddyId)}, your buddy ${userMention(m.userId)} hasn't worked out in ${m.daysSince} days. Give them a nudge.`);
  }
  return {
    embeds: [{ color: COLOR.bad, description: lines.join('\n') }],
    ...pingLine(...atRisk.flatMap((r) => [r.userId, r.buddyId]), ...idle.map((m) => m.buddyId)),
  };
}
