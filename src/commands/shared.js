import { MessageFlags, userMention } from 'discord.js';
import { localNow } from '../time.js';

export const COLOR = {
  good: 0x57f287,
  warn: 0xfee75c,
  bad: 0xed4245,
  info: 0x5865f2,
  gold: 0xf1c40f,
};

/** The server's settings plus "now" and "today" in its timezone. */
export function guildContext(store, guildId, now = new Date()) {
  const guild = store.getGuild(guildId);
  const local = localNow(guild.timezone, now);
  return { guild, local, today: local.toISODate() };
}

export function ephemeral(content) {
  return { content, flags: MessageFlags.Ephemeral };
}

/** Mentions render as names but don't notify anyone unless listed here. */
export function pinging(...userIds) {
  return { allowedMentions: { users: userIds.filter(Boolean) } };
}

/** Mentions inside embeds never notify anyone, so whoever needs a ping goes in the message text. */
export function pingLine(...userIds) {
  const ids = [...new Set(userIds.filter(Boolean))];
  return { content: ids.map(userMention).join(' ') || undefined, allowedMentions: { users: ids } };
}

export const NO_PINGS = { allowedMentions: { parse: [] } };

export function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function bar(current, total, width = 10) {
  const filled = total > 0 ? Math.min(width, Math.round((current / total) * width)) : 0;
  return '▰'.repeat(filled) + '▱'.repeat(width - filled);
}

export function describeStake(pledge) {
  if (!pledge.stake) return 'nothing at stake';
  return pledge.recipient_id ? `${pledge.stake} → ${userMention(pledge.recipient_id)}` : pledge.stake;
}

export function memberName(member, user) {
  return member?.displayName ?? user.displayName ?? user.username;
}
