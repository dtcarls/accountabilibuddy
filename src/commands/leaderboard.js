import { InteractionContextType, SlashCommandBuilder, userMention } from 'discord.js';
import { addDays, formatDate, weekStartOf } from '../time.js';
import { COLOR, guildContext, NO_PINGS, plural } from './shared.js';

const MEDALS = ['🥇', '🥈', '🥉'];

export function leaderboardLines(rows) {
  return rows.map(
    (r, i) => `${MEDALS[i] ?? `**${i + 1}.**`} ${userMention(r.user_id)}: ${plural(r.days, 'day')} · ${r.minutes} min · ${r.xp} XP`,
  );
}

export const data = new SlashCommandBuilder()
  .setName('leaderboard')
  .setDescription("Who's putting in the work")
  .setContexts(InteractionContextType.Guild)
  .addStringOption((o) =>
    o
      .setName('week')
      .setDescription('Which week (default: this one)')
      .addChoices({ name: 'This week', value: 'this' }, { name: 'Last week', value: 'last' }),
  );

export async function execute(interaction, store) {
  const { today } = guildContext(store, interaction.guildId);
  const start = addDays(weekStartOf(today), interaction.options.getString('week') === 'last' ? -7 : 0);
  const rows = store.leaderboard(interaction.guildId, start, addDays(start, 6));
  return interaction.reply({
    embeds: [
      {
        color: COLOR.gold,
        title: `🏆 Week of ${formatDate(start)}`,
        description: rows.length ? leaderboardLines(rows).join('\n') : 'Nobody has checked in yet. Be the first!',
      },
    ],
    ...NO_PINGS,
  });
}
