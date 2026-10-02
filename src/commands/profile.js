import { InteractionContextType, SlashCommandBuilder, userMention } from 'discord.js';
import { HEATMAP_LEGEND, bestWeek, currentStreak, daysSinceLast, longestStreak, renderHeatmap } from '../history.js';
import { KINDS, STATS, levelProgress, moodFor, statsFromXp, titleForLevel } from '../rpg.js';
import { formatDate, weekEndOf, weekStartOf } from '../time.js';
import { COLOR, bar, guildContext, memberName, NO_PINGS } from './shared.js';

const STAT_EMOJI = { STR: '💪', END: '🫁', FLX: '🤸', AGI: '⚡' };

export const data = new SlashCommandBuilder()
  .setName('profile')
  .setDescription('Your character, stats, streaks and workout heatmap')
  .setContexts(InteractionContextType.Guild)
  .addUserOption((o) => o.setName('user').setDescription('Look at someone else'));

export async function execute(interaction, store) {
  const user = interaction.options.getUser('user') ?? interaction.user;
  const member = interaction.options.getMember('user') ?? (user.id === interaction.user.id ? interaction.member : null);
  const { guildId } = interaction;
  const { today } = guildContext(store, guildId);

  const minutesByDate = store.minutesByDate(guildId, user.id);
  const dates = new Set(minutesByDate.keys());
  const totals = store.totals(guildId, user.id);
  const { level, current, needed } = levelProgress(totals.xp);
  const mood = moodFor(daysSinceLast(dates, today));
  const stats = statsFromXp(store.xpByKind(guildId, user.id));
  const longest = store.longestWorkout(guildId, user.id);
  const pledge = store.pledgeFor(guildId, user.id, weekStartOf(today));
  const weekDays = store.workoutDays(guildId, user.id, weekStartOf(today), weekEndOf(today));
  const buddyId = store.getBuddy(guildId, user.id);

  const statLine = Object.keys(STATS)
    .map((s) => `${STAT_EMOJI[s]} ${s} **${stats[s]}**`)
    .join('  ');

  return interaction.reply({
    embeds: [
      {
        color: COLOR.info,
        thumbnail: { url: user.displayAvatarURL() },
        title: `${mood.emoji} ${memberName(member, user)}: Level ${level} ${titleForLevel(level)}`,
        description: [
          `*${mood.label}. ${mood.line}*`,
          `${bar(current, needed)} ${current}/${needed} XP to level ${level + 1}`,
          '',
          statLine,
        ].join('\n'),
        fields: [
          {
            name: 'Streaks',
            value: `🔥 ${currentStreak(dates, today)} now · 🏆 ${longestStreak(dates)} best · 📅 ${bestWeek(dates)}/7 best week`,
          },
          {
            name: 'Totals',
            value:
              `${totals.workouts} workouts · ${(totals.minutes / 60).toFixed(1)} hours · ${totals.xp} XP` +
              (longest
                ? `\nLongest: ${longest.minutes} min ${KINDS[longest.kind].emoji} on ${formatDate(longest.local_date)}`
                : ''),
          },
          {
            name: 'This week',
            value:
              (pledge ? `${weekDays}/${pledge.target} pledged days` : `${weekDays} workout days`) +
              (buddyId ? ` · buddy: ${userMention(buddyId)}` : ''),
          },
          { name: 'Last 12 weeks', value: `${renderHeatmap(minutesByDate, today)}\n-# ${HEATMAP_LEGEND}` },
        ],
      },
    ],
    ...NO_PINGS,
  });
}
