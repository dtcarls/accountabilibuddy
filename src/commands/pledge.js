import {
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  userMention,
} from 'discord.js';
import { addDays, formatDate, weekEndOf, weekStartOf } from '../time.js';
import { COLOR, bar, describeStake, ephemeral, guildContext, NO_PINGS, pingLine, pinging, plural } from './shared.js';

export const data = new SlashCommandBuilder()
  .setName('pledge')
  .setDescription('Put something on the line for hitting your weekly workouts')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) =>
    s
      .setName('set')
      .setDescription('Commit to a number of workout days per week, starting next Monday')
      .addIntegerOption((o) =>
        o.setName('days').setDescription('Workout days per week').setRequired(true).setMinValue(1).setMaxValue(7),
      )
      .addStringOption((o) =>
        o
          .setName('stake')
          .setDescription('What you owe if you miss, e.g. "Buy Sam a coffee" or "$10 to charity"')
          .setRequired(true)
          .setMaxLength(100),
      )
      .addUserOption((o) => o.setName('owed_to').setDescription('Who collects if you miss (optional)')),
  )
  .addSubcommand((s) => s.setName('clear').setDescription('Stop pledging after this week'))
  .addSubcommand((s) => s.setName('status').setDescription("Your pledge and this week's progress"))
  .addSubcommand((s) => s.setName('ledger').setDescription('Unpaid stakes you owe or are owed'))
  .addSubcommand((s) =>
    s
      .setName('paid')
      .setDescription('Mark a stake as paid (by whoever is owed it)')
      .addIntegerOption((o) => o.setName('id').setDescription('The number from /pledge ledger').setRequired(true)),
  );

export async function execute(interaction, store) {
  const sub = interaction.options.getSubcommand();
  const ctx = guildContext(store, interaction.guildId);
  const nextWeek = addDays(weekStartOf(ctx.today), 7);
  if (sub === 'set') return set(interaction, store, nextWeek);
  if (sub === 'clear') return clear(interaction, store, ctx.today, nextWeek);
  if (sub === 'status') return status(interaction, store, ctx.today, nextWeek);
  if (sub === 'ledger') return ledger(interaction, store);
  if (sub === 'paid') return paid(interaction, store);
}

async function set(interaction, store, nextWeek) {
  const target = interaction.options.getInteger('days', true);
  const stake = interaction.options.getString('stake', true);
  const owedTo = interaction.options.getUser('owed_to');
  if (owedTo?.id === interaction.user.id) return interaction.reply(ephemeral("You can't owe yourself."));
  if (owedTo?.bot) return interaction.reply(ephemeral("Bots don't accept coffee."));

  const pledge = {
    guildId: interaction.guildId,
    userId: interaction.user.id,
    effectiveWeek: nextWeek,
    target,
    stake,
    recipientId: owedTo?.id ?? null,
  };
  store.setPledge(pledge);

  return interaction.reply({
    embeds: [
      {
        color: COLOR.gold,
        title: '📜 A pledge has been made',
        description:
          `${userMention(interaction.user.id)} will work out **${plural(target, 'day')} a week**, ` +
          `starting ${formatDate(nextWeek)}.\n\n` +
          `If they miss, they owe: **${describeStake({ stake, recipient_id: pledge.recipientId })}**`,
        footer: { text: 'Pledges can only change starting the following week. No wriggling out mid-week.' },
      },
    ],
    ...pingLine(owedTo?.id),
  });
}

async function clear(interaction, store, today, nextWeek) {
  if (!store.pledgeFor(interaction.guildId, interaction.user.id, nextWeek)) {
    return interaction.reply(ephemeral("You don't have a pledge for next week."));
  }
  store.setPledge({ guildId: interaction.guildId, userId: interaction.user.id, effectiveWeek: nextWeek, target: 0 });
  const thisWeek = store.pledgeFor(interaction.guildId, interaction.user.id, weekStartOf(today));
  return interaction.reply({
    content:
      `${userMention(interaction.user.id)} is ending their pledge` +
      (thisWeek ? ` after this week. This week's still counts: ${thisWeek.target} days.` : '.'),
    ...NO_PINGS,
  });
}

async function status(interaction, store, today, nextWeek) {
  const { guildId } = interaction;
  const userId = interaction.user.id;
  const week = weekStartOf(today);
  const current = store.pledgeFor(guildId, userId, week);
  const upcoming = store.pledgeFor(guildId, userId, nextWeek);
  const done = store.workoutDays(guildId, userId, week, weekEndOf(today));

  const lines = [];
  if (current) {
    lines.push(`**This week:** ${bar(done, current.target, 7)} ${done}/${current.target} days`);
    lines.push(`On the line: ${describeStake(current)}`);
  } else {
    lines.push(`**This week:** no pledge (${plural(done, 'workout day')} so far)`);
  }
  const changed =
    current?.target !== upcoming?.target ||
    current?.stake !== upcoming?.stake ||
    current?.recipient_id !== upcoming?.recipient_id;
  if (changed) {
    lines.push(
      upcoming
        ? `**From ${formatDate(nextWeek)}:** ${upcoming.target} days, stake: ${describeStake(upcoming)}`
        : `**From ${formatDate(nextWeek)}:** no pledge`,
    );
  }
  return interaction.reply({
    embeds: [{ color: COLOR.gold, title: '📜 Your pledge', description: lines.join('\n') }],
    flags: MessageFlags.Ephemeral,
  });
}

async function ledger(interaction, store) {
  const userId = interaction.user.id;
  const debts = store.unpaidDebts(interaction.guildId, userId);
  if (debts.length === 0) return interaction.reply(ephemeral('All square. Nobody owes anybody anything. 🎉'));

  const line = (d) => `\`#${d.id}\` week of ${formatDate(d.week_start)} (${d.done}/${d.target}): **${d.stake}**`;
  const owe = debts.filter((d) => d.user_id === userId);
  const owed = debts.filter((d) => d.recipient_id === userId);
  const fields = [];
  if (owe.length) {
    fields.push({
      name: 'You owe',
      value: owe.map((d) => line(d) + (d.recipient_id ? ` → ${userMention(d.recipient_id)}` : '')).join('\n'),
    });
  }
  if (owed.length) {
    fields.push({ name: "You're owed", value: owed.map((d) => `${line(d)} from ${userMention(d.user_id)}`).join('\n') });
  }
  return interaction.reply({
    embeds: [
      {
        color: COLOR.warn,
        title: '💸 Ledger',
        fields,
        footer: { text: 'Once a stake is paid, the person owed it runs /pledge paid <id>.' },
      },
    ],
    flags: MessageFlags.Ephemeral,
  });
}

async function paid(interaction, store) {
  const debt = store.getDebt(interaction.guildId, interaction.options.getInteger('id', true));
  if (!debt || debt.paid_at) return interaction.reply(ephemeral("I can't find an unpaid stake with that number."));

  // Whoever is owed confirms payment. Charity-style stakes have nobody to
  // confirm, so the person who owes marks those themselves.
  const confirmer = debt.recipient_id ?? debt.user_id;
  const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
  if (interaction.user.id !== confirmer && !isAdmin) {
    return interaction.reply(ephemeral(`Only ${userMention(confirmer)} can mark this one as paid.`));
  }

  store.markDebtPaid(debt.id);
  return interaction.reply({
    content: `✅ Stake #${debt.id} settled: ${userMention(debt.user_id)} paid up (**${debt.stake}**).`,
    ...pinging(debt.user_id),
  });
}
