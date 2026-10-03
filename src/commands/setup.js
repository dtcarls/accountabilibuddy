import {
  ChannelType,
  InteractionContextType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  channelMention,
} from 'discord.js';
import { isValidTimezone, lastSettleableWeek, localNow } from '../time.js';
import { COLOR, ephemeral } from './shared.js';

const REQUIRED_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.ReadMessageHistory,
];

const TIMEZONES = Intl.supportedValuesOf('timeZone');

export const data = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Configure Accountabilibuddy for this server')
  .setContexts(InteractionContextType.Guild)
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addChannelOption((o) =>
    o
      .setName('channel')
      .setDescription('Where daily reminders and weekly results get posted')
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(true),
  )
  .addStringOption((o) =>
    o.setName('timezone').setDescription('Your timezone, e.g. America/Chicago (default: UTC)').setAutocomplete(true),
  )
  .addIntegerOption((o) =>
    o
      .setName('reminder_hour')
      .setDescription('Hour of the day (0-23) to post reminders, in that timezone (default: 19)')
      .setMinValue(0)
      .setMaxValue(23),
  );

export async function execute(interaction, store) {
  const channel = interaction.options.getChannel('channel', true);
  const current = store.getGuild(interaction.guildId);
  const timezone = interaction.options.getString('timezone') ?? current.timezone;
  const reminderHour = interaction.options.getInteger('reminder_hour') ?? current.reminder_hour;

  if (!isValidTimezone(timezone)) {
    return interaction.reply(ephemeral(`\`${timezone}\` isn't a timezone I recognize. Try one like \`America/New_York\`.`));
  }
  const missing = channel.permissionsFor(interaction.client.user)?.missing(REQUIRED_PERMISSIONS) ?? ['ViewChannel'];
  if (missing.length > 0) {
    return interaction.reply(ephemeral(`I need these permissions in ${channelMention(channel.id)} first: ${missing.join(', ')}.`));
  }

  store.updateGuild(interaction.guildId, {
    channel_id: channel.id,
    timezone,
    reminder_hour: reminderHour,
    // Start keeping score from this week; earlier weeks are never judged.
    last_settled_week: current.last_settled_week ?? lastSettleableWeek(localNow(timezone)),
  });

  return interaction.reply({
    embeds: [
      {
        color: COLOR.good,
        title: '⚙️ Accountabilibuddy is set up',
        description: [
          `Reminders and weekly results go to ${channelMention(channel.id)}.`,
          `Timezone: **${timezone}**. Daily reminders at **${String(reminderHour).padStart(2, '0')}:00**.`,
          'Weeks run Monday to Sunday and are settled Monday at noon.',
          '',
          'Tell everyone to start with `/checkin`, `/buddy request` and `/pledge set`.',
        ].join('\n'),
      },
    ],
  });
}

export async function autocomplete(interaction) {
  const query = interaction.options.getFocused().toLowerCase();
  const matches = TIMEZONES.filter((tz) => tz.toLowerCase().includes(query)).slice(0, 25);
  await interaction.respond(matches.map((tz) => ({ name: tz, value: tz })));
}
