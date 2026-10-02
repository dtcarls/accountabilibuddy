import { Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import { commands } from './commands/index.js';
import { startScheduler } from './scheduler.js';
import { Store } from './store.js';

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('Set DISCORD_TOKEN (see .env.example).');
  process.exit(1);
}

const store = new Store(process.env.DATABASE_PATH || './data/accountabilibuddy.db');
const byName = new Map(commands.map((c) => [c.data.name, c]));

// Only the Guilds intent: the bot never reads chat messages.
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once(Events.ClientReady, (c) => {
  console.log(`Logged in as ${c.user.tag} in ${c.guilds.cache.size} server(s)`);
  startScheduler(c, store);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.inGuild()) return;
  try {
    if (interaction.isChatInputCommand()) {
      await byName.get(interaction.commandName)?.execute(interaction, store);
    } else if (interaction.isAutocomplete()) {
      await byName.get(interaction.commandName)?.autocomplete?.(interaction, store);
    } else if (interaction.isButton()) {
      // Button ids start with the name of the command that owns them, e.g. "buddy:accept:...".
      await byName.get(interaction.customId.split(':')[0])?.onButton?.(interaction, store);
    }
  } catch (err) {
    console.error(`Error handling ${interaction.commandName ?? interaction.customId}`, err);
    if (!interaction.isRepliable()) return;
    const reply = { content: 'Something went wrong on my end. Try again in a moment.', flags: MessageFlags.Ephemeral };
    await (interaction.deferred || interaction.replied ? interaction.followUp(reply) : interaction.reply(reply)).catch(
      () => {},
    );
  }
});

client.login(token);
