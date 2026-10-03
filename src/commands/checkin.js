import { extname } from 'node:path';
import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { CheckinError, recordCheckin, undoableCheckin } from '../checkins.js';
import { KINDS, titleForLevel } from '../rpg.js';
import { addDays, formatDate } from '../time.js';
import { COLOR, bar, describeStake, ephemeral, guildContext, memberName, plural } from './shared.js';

// Bots can upload up to 10 MiB to servers without boosts.
const MAX_PROOF_BYTES = 10 * 1024 * 1024;

export const data = new SlashCommandBuilder()
  .setName('checkin')
  .setDescription('Log a workout, with proof')
  .setContexts(InteractionContextType.Guild)
  .addStringOption((o) =>
    o
      .setName('kind')
      .setDescription('What kind of workout')
      .setRequired(true)
      .addChoices(...Object.entries(KINDS).map(([value, k]) => ({ name: `${k.emoji} ${k.label}`, value }))),
  )
  .addIntegerOption((o) =>
    o.setName('minutes').setDescription('How long it took').setRequired(true).setMinValue(1).setMaxValue(600),
  )
  .addAttachmentOption((o) =>
    o.setName('proof').setDescription('A photo, screenshot or video of the workout').setRequired(true),
  )
  .addStringOption((o) => o.setName('note').setDescription('Anything to brag about?').setMaxLength(200))
  .addStringOption((o) =>
    o
      .setName('day')
      .setDescription('Forgot to post? You can log yesterday')
      .addChoices({ name: 'Today', value: 'today' }, { name: 'Yesterday', value: 'yesterday' }),
  );

export async function execute(interaction, store) {
  const proof = interaction.options.getAttachment('proof', true);
  const isImage = proof.contentType?.startsWith('image/');
  if (!isImage && !proof.contentType?.startsWith('video/')) {
    return interaction.reply(ephemeral('Proof has to be a photo, screenshot or video.'));
  }
  if (proof.size > MAX_PROOF_BYTES) {
    return interaction.reply(ephemeral('That file is over 10 MB. Try a screenshot or a shorter clip.'));
  }

  const { guild, today } = guildContext(store, interaction.guildId);
  const kind = interaction.options.getString('kind', true);
  const minutes = interaction.options.getInteger('minutes', true);
  const note = interaction.options.getString('note');
  const date = interaction.options.getString('day') === 'yesterday' ? addDays(today, -1) : today;

  let result;
  try {
    result = recordCheckin(store, guild, { userId: interaction.user.id, date, kind, minutes, note });
  } catch (err) {
    if (err instanceof CheckinError) return interaction.reply(ephemeral(err.message));
    throw err;
  }

  await interaction.deferReply();
  // Re-upload the proof as part of our reply so it lives in the channel
  // permanently; the original attachment link expires.
  const fileName = `proof${extname(proof.name).toLowerCase() || `.${proof.contentType.split('/')[1]}`}`;
  try {
    const message = await interaction.editReply({
      embeds: [checkinEmbed(interaction, { result, kind, minutes, note, date, today, image: isImage && fileName })],
      files: [{ attachment: proof.url, name: fileName }],
    });
    store.setCheckinMessage(result.id, message.channelId, message.id);
  } catch (err) {
    store.deleteCheckin(result.id);
    console.error('Failed to post check-in', err);
    await interaction.editReply("I couldn't upload your proof, so the check-in wasn't saved. Please try again.");
  }
}

function checkinEmbed(interaction, { result, kind, minutes, note, date, today, image }) {
  const { emoji, label } = KINDS[kind];
  const lines = [];
  if (note) lines.push(`> ${note}`);
  if (result.levelAfter > result.levelBefore) {
    lines.push(`🎉 **Level up!** Now level ${result.levelAfter}: *${titleForLevel(result.levelAfter)}*`);
  }

  const week = result.pledge
    ? `${bar(result.weekDays, result.pledge.target, 7)} ${result.weekDays}/${result.pledge.target} days` +
      (result.weekDays === result.pledge.target ? ' ✅ pledge kept!' : '')
    : plural(result.weekDays, 'day');

  return {
    color: COLOR.good,
    author: { name: memberName(interaction.member, interaction.user), icon_url: interaction.user.displayAvatarURL() },
    title: `${emoji} ${minutes} min of ${label}`,
    description: lines.join('\n') || undefined,
    fields: [
      { name: 'XP', value: `+${result.xp}`, inline: true },
      { name: 'Streak', value: `🔥 ${plural(result.streak, 'day')}`, inline: true },
      { name: 'This week', value: week, inline: true },
      ...(result.pledge ? [{ name: 'On the line', value: describeStake(result.pledge) }] : []),
    ],
    image: image ? { url: `attachment://${image}` } : undefined,
    footer: date === today ? undefined : { text: `Logged for ${formatDate(date)}` },
  };
}

export const undo = {
  data: new SlashCommandBuilder()
    .setName('undo')
    .setDescription('Remove your most recent check-in (within 24 hours)')
    .setContexts(InteractionContextType.Guild),

  async execute(interaction, store) {
    const { guild } = guildContext(store, interaction.guildId);
    let checkin;
    try {
      checkin = undoableCheckin(store, guild, interaction.user.id);
    } catch (err) {
      if (err instanceof CheckinError) return interaction.reply(ephemeral(err.message));
      throw err;
    }
    store.deleteCheckin(checkin.id);
    if (checkin.message_id) {
      const channel = await interaction.client.channels.fetch(checkin.channel_id).catch(() => null);
      await channel?.messages.delete(checkin.message_id).catch(() => {});
    }
    return interaction.reply(
      ephemeral(`Removed your ${checkin.minutes}-minute check-in from ${formatDate(checkin.local_date)} (−${checkin.xp} XP).`),
    );
  },
};
