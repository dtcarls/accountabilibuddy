import { REST, Routes } from 'discord.js';
import { commands } from './commands/index.js';

const { DISCORD_TOKEN, DISCORD_CLIENT_ID, DEV_GUILD_ID } = process.env;
if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID) {
  console.error('Set DISCORD_TOKEN and DISCORD_CLIENT_ID (see .env.example).');
  process.exit(1);
}

const body = commands.map((c) => c.data.toJSON());
const rest = new REST().setToken(DISCORD_TOKEN);

// Registering to one server is instant, which is handy while testing. Global
// commands work in every server the bot joins but can take a while to appear.
const route = DEV_GUILD_ID
  ? Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DEV_GUILD_ID)
  : Routes.applicationCommands(DISCORD_CLIENT_ID);

await rest.put(route, { body });
console.log(`Registered ${body.length} commands ${DEV_GUILD_ID ? `to server ${DEV_GUILD_ID}` : 'globally'}.`);
