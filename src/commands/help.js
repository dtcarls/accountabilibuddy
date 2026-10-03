import { InteractionContextType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { COLOR } from './shared.js';

export const data = new SlashCommandBuilder()
  .setName('help')
  .setDescription('How Accountabilibuddy works')
  .setContexts(InteractionContextType.Guild);

export async function execute(interaction) {
  return interaction.reply({
    embeds: [
      {
        color: COLOR.info,
        title: '💪 Accountabilibuddy',
        fields: [
          {
            name: 'Log workouts',
            value:
              '`/checkin` with a photo or video as proof. Earn XP, level up, build streaks.\n' +
              '`/undo` removes your last check-in if you made a mistake.',
          },
          {
            name: 'Get a buddy',
            value:
              '`/buddy request @someone`. Buddies get pinged when their partner goes quiet ' +
              'or is about to miss their pledge.',
          },
          {
            name: 'Put something on the line',
            value:
              '`/pledge set` commits you to X workout days a week, starting next Monday. ' +
              'Miss it and you owe your stake. Check `/pledge ledger`, settle with `/pledge paid`.',
          },
          {
            name: 'Show off',
            value:
              "`/profile` shows your character, stats, streaks and heatmap. " +
              '`/gallery` shows your proof photos. `/leaderboard` ranks the week.',
          },
          {
            name: 'Rules',
            value:
              'Weeks run Monday to Sunday. Multiple check-ins on one day count as one workout day. ' +
              'Weeks are settled Monday at noon, so you can still log Sunday as "yesterday" Monday morning.',
          },
        ],
      },
    ],
    flags: MessageFlags.Ephemeral,
  });
}
