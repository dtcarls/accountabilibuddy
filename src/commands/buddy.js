import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
  userMention,
} from 'discord.js';
import { daysSinceLast } from '../history.js';
import { weekEndOf, weekStartOf } from '../time.js';
import { COLOR, ephemeral, guildContext, NO_PINGS, pinging, plural } from './shared.js';

export const data = new SlashCommandBuilder()
  .setName('buddy')
  .setDescription('Pair up with an accountability buddy')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) =>
    s
      .setName('request')
      .setDescription('Ask someone to be your buddy')
      .addUserOption((o) => o.setName('user').setDescription('Who you want as your buddy').setRequired(true)),
  )
  .addSubcommand((s) => s.setName('status').setDescription("See how you and your buddy are doing"))
  .addSubcommand((s) => s.setName('remove').setDescription('End your buddy pairing'));

export async function execute(interaction, store) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'request') return request(interaction, store);
  if (sub === 'status') return status(interaction, store);
  if (sub === 'remove') return remove(interaction, store);
}

async function request(interaction, store) {
  const from = interaction.user;
  const to = interaction.options.getUser('user', true);
  const error = pairingProblem(store, interaction.guildId, from.id, to);
  if (error) return interaction.reply(ephemeral(error));

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`buddy:accept:${from.id}:${to.id}`).setLabel('Accept').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`buddy:decline:${from.id}:${to.id}`).setLabel('Decline').setStyle(ButtonStyle.Secondary),
  );
  return interaction.reply({
    content:
      `${userMention(to.id)}, ${userMention(from.id)} wants you as their accountability buddy 🤝\n` +
      "Buddies get pinged when the other one is slacking. You'll keep each other honest.",
    components: [buttons],
    ...pinging(to.id),
  });
}

function pairingProblem(store, guildId, fromId, to) {
  if (to.id === fromId) return "You can't be your own buddy (nice try).";
  if (to.bot) return "Bots don't work out.";
  if (store.getBuddy(guildId, fromId)) return 'You already have a buddy. Use `/buddy remove` first.';
  if (store.getBuddy(guildId, to.id)) return `${userMention(to.id)} already has a buddy.`;
  return null;
}

export async function onButton(interaction, store) {
  const [, action, fromId, toId] = interaction.customId.split(':');
  const clicker = interaction.user.id;

  if (action === 'decline') {
    if (clicker !== toId && clicker !== fromId) return interaction.reply(ephemeral("This request isn't for you."));
    const text = clicker === toId ? 'declined' : 'was cancelled';
    return interaction.update({ content: `Buddy request from ${userMention(fromId)} ${text}.`, components: [], ...NO_PINGS });
  }

  if (clicker !== toId) return interaction.reply(ephemeral("This request isn't for you."));
  const error = pairingProblem(store, interaction.guildId, fromId, interaction.user);
  if (error) return interaction.update({ content: `Couldn't pair up: ${error}`, components: [], ...NO_PINGS });

  store.pairBuddies(interaction.guildId, fromId, toId);
  return interaction.update({
    content: `🤝 ${userMention(fromId)} and ${userMention(toId)} are now accountability buddies!`,
    components: [],
    ...pinging(fromId),
  });
}

async function status(interaction, store) {
  const buddyId = store.getBuddy(interaction.guildId, interaction.user.id);
  if (!buddyId) return interaction.reply(ephemeral("You don't have a buddy yet. Try `/buddy request`."));

  const { today } = guildContext(store, interaction.guildId);
  const line = (userId) => {
    const dates = new Set(store.minutesByDate(interaction.guildId, userId).keys());
    const days = store.workoutDays(interaction.guildId, userId, weekStartOf(today), weekEndOf(today));
    const pledge = store.pledgeFor(interaction.guildId, userId, weekStartOf(today));
    const since = daysSinceLast(dates, today);
    const last = since === null ? 'no workouts yet' : since === 0 ? 'worked out today' : `last workout ${since}d ago`;
    const progress = pledge ? `**${days}/${pledge.target}** days` : `**${plural(days, 'day')}**`;
    return `${userMention(userId)}: ${progress} this week · ${last}`;
  };

  return interaction.reply({
    embeds: [{ color: COLOR.info, title: '🤝 Buddy check', description: [line(interaction.user.id), line(buddyId)].join('\n') }],
    flags: MessageFlags.Ephemeral,
  });
}

async function remove(interaction, store) {
  const buddyId = store.unpairBuddy(interaction.guildId, interaction.user.id);
  if (!buddyId) return interaction.reply(ephemeral("You don't have a buddy."));
  return interaction.reply(ephemeral(`You and ${userMention(buddyId)} are no longer buddies.`));
}
