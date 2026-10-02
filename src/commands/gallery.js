import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { KINDS } from '../rpg.js';
import { formatDate } from '../time.js';
import { COLOR, memberName } from './shared.js';

export const data = new SlashCommandBuilder()
  .setName('gallery')
  .setDescription('Recent proof photos')
  .setContexts(InteractionContextType.Guild)
  .addUserOption((o) => o.setName('user').setDescription('Whose gallery (default: yours)'))
  .addIntegerOption((o) => o.setName('count').setDescription('How many (default 6)').setMinValue(1).setMaxValue(10));

export async function execute(interaction, store) {
  const user = interaction.options.getUser('user') ?? interaction.user;
  const member = interaction.options.getMember('user') ?? (user.id === interaction.user.id ? interaction.member : null);
  const count = interaction.options.getInteger('count') ?? 6;
  await interaction.deferReply();

  // Discord attachment links expire, so fetch each check-in message for a fresh one.
  const checkins = store.checkinsWithProof(interaction.guildId, user.id, count);
  const embeds = [];
  for (const checkin of checkins) {
    const channel = await interaction.client.channels.fetch(checkin.channel_id).catch(() => null);
    const message = await channel?.messages.fetch(checkin.message_id).catch(() => null);
    const file = message?.attachments.first();
    if (!file) continue;
    const { emoji, label } = KINDS[checkin.kind];
    const isImage = file.contentType?.startsWith('image/');
    embeds.push({
      color: COLOR.good,
      title: `${emoji} ${checkin.minutes} min of ${label} · ${formatDate(checkin.local_date)}`,
      url: message.url,
      description: [checkin.note && `> ${checkin.note}`, !isImage && `🎥 [Watch the video](${message.url})`]
        .filter(Boolean)
        .join('\n') || undefined,
      image: isImage ? { url: file.url } : undefined,
    });
  }

  if (embeds.length === 0) {
    return interaction.editReply(`${memberName(member, user)} has no proof photos yet.`);
  }
  return interaction.editReply({ content: `📸 **${memberName(member, user)}'s proof gallery**`, embeds });
}
