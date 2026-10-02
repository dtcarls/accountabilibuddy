# accountabilibuddy

A Discord bot that keeps your server honest about working out.

- **Proof check-ins.** `/checkin` needs a photo, screenshot or video. The bot reposts it, so it stays in the channel.
- **Buddies.** Pair up with `/buddy request`. If your buddy goes quiet for 3 days, or is about to miss their pledge, you get pinged.
- **Stakes.** `/pledge set days:3 stake:"Buy Sam a coffee" owed_to:@Sam`. Miss your target and the bot announces what you owe on Monday and tracks it until it's paid.
- **RPG character.** Workouts earn XP, level you up and raise stats (STR, END, FLX, AGI) depending on the kind of workout. Skip workouts and your character gets visibly sad.
- **Proof gallery.** `/profile` shows streaks, records and a GitHub-style heatmap of the last 12 weeks. `/gallery` shows recent proof photos.

Each Discord server's data is completely separate. If other people install the bot in their servers, they never see your members, buddies, pledges or history, and you never see theirs.

## Commands

| Command | What it does |
| --- | --- |
| `/checkin kind minutes proof [note] [day]` | Log a workout. `day: Yesterday` covers forgotten posts. |
| `/undo` | Remove your latest check-in (within 24h). |
| `/buddy request @user` · `status` · `remove` | Manage your accountability buddy. |
| `/pledge set` · `clear` · `status` · `ledger` · `paid id` | Weekly workout pledge with a stake. |
| `/profile [@user]` | Character card, stats, streaks, heatmap. |
| `/gallery [@user] [count]` | Recent proof photos. |
| `/leaderboard [week]` | This week's (or last week's) rankings. |
| `/setup channel [timezone] [reminder_hour]` | Admins only. Where and when the bot posts. |
| `/help` | Quick overview. |

### Rules

- Weeks run Monday through Sunday in the server's timezone.
- Pledges count **workout days**: three check-ins on one day still count as one day. Extra check-ins on the same day earn half XP.
- Pledge changes always start the following Monday, so nobody can lower the bar mid-week.
- On Monday at noon the previous week is settled. Missed pledges become stakes on the ledger, and the results are posted. Until then you can still log Sunday's workout as "yesterday".
- At the daily reminder hour the bot pings anyone who now needs to work out every remaining day to keep their pledge (plus their buddy), and the buddy of anyone who has gone 3, 6, 9… days without a workout.
- The person who is owed a stake marks it paid. For stakes with nobody to collect (like "$10 to charity"), the person who owes marks it themselves. Server admins can mark any stake paid.

## Running it

You need Node.js 22.13 or newer. There is no native build step: storage uses Node's built-in SQLite.

1. **Create the bot.** Go to <https://discord.com/developers/applications>, click **New Application**, open **Bot** and copy the token (**Reset Token**). The bot needs no privileged intents.
2. **Invite it to your server.** Replace `YOUR_CLIENT_ID` (the Application ID on the **General Information** page) in this link:
   ```
   https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&scope=bot+applications.commands&permissions=117760
   ```
   That grants View Channel, Send Messages, Embed Links, Attach Files and Read Message History, and nothing else.
3. **Configure and start it.**
   ```sh
   npm install
   cp .env.example .env        # fill in DISCORD_TOKEN and DISCORD_CLIENT_ID
   npm run deploy-commands     # registers the slash commands
   npm start
   ```
   While testing, set `DEV_GUILD_ID` to your server's ID so commands show up instantly. Without it they're registered globally, which can take a while to appear but works in every server the bot joins.
4. **In Discord:** run `/setup channel:#fitness timezone:America/Chicago`.

The bot has to keep running for reminders and weekly results, so host it somewhere that stays on (a small VPS, a Raspberry Pi, Railway, Fly.io…) and keep `DATABASE_PATH` on persistent storage.

## Development

```sh
npm test
```

The core logic (`src/time.js`, `rpg.js`, `history.js`, `store.js`, `accountability.js`, `checkins.js`) has no Discord dependency and is unit tested. `test/commands.test.js` runs every slash command against fake interactions.
