# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Accountabilibuddy is a Discord bot (discord.js v14, plain JavaScript ESM, no build step) for workout accountability: proof check-ins, buddy pairs, weekly pledges with stakes, RPG-style XP/levels, and a streak heatmap. The owner self-hosts it with Docker Compose.

## Commands

```sh
npm test                                          # all tests (node:test)
npm test -- --test-name-pattern="streaks"         # tests whose name matches
node --disable-warning=ExperimentalWarning --test test/core.test.js   # one file
npm start                                         # run the bot (reads .env if present)
npm run deploy-commands                           # register slash commands with Discord
docker compose up -d --build                      # how it runs in production
```

There is no linter or formatter configured. Node ≥ 22.13 is required because storage uses the built-in `node:sqlite` (hence `--disable-warning=ExperimentalWarning` everywhere). Env vars are in `.env.example`; `DEV_GUILD_ID` makes `deploy-commands` register to one server (instant) instead of globally.

## Architecture

Two layers, deliberately separated:

- **Core logic** (`src/time.js`, `rpg.js`, `history.js`, `store.js`, `accountability.js`, `checkins.js`) never imports discord.js. It works on user/guild ID strings and plain data, and is what `test/core.test.js` covers. New rules belong here.
- **Discord layer** (`src/commands/*`, `scheduler.js`, `index.js`) turns interactions into core calls and core results into embeds. `test/commands.test.js` runs every handler against a hand-rolled fake interaction (no Discord connection); when a handler starts calling a new interaction/client method, the fake in that test needs it too.

### Command wiring

Each module in `src/commands/` exports `data` (a `SlashCommandBuilder`) and `execute(interaction, store)`, plus optional `autocomplete` and `onButton`. They are listed in `src/commands/index.js`, which both `index.js` (routing) and `deploy-commands.js` (registration) read. Buttons are routed by the first `:`-separated segment of `customId`, which must equal the owning command's name (e.g. `buddy:accept:<fromId>:<toId>`); button state lives in the customId rather than the database. `/undo` lives in `checkin.js` as the `undo` export.

### Multi-server isolation

Any server can install the bot, and servers must never see each other's data. Every table in `store.js` has a `guild_id` column and every query filters on it. Keep that true for new tables and queries. All commands are `setContexts(InteractionContextType.Guild)`.

### Time and weeks

All stored dates are local calendar dates (`YYYY-MM-DD`) in the server's configured timezone, which comes from `/setup` and lives on the `guilds` row. Use `guildContext(store, guildId)` from `commands/shared.js` to get "today" rather than reading the system clock. Weeks run Monday to Sunday (`weekStartOf`). Date math in `time.js` is done in UTC on date strings to avoid DST bugs.

### Weekly settling and reminders

`scheduler.js` ticks every minute for each guild the client is in. The pure function `dueWork(guild, localNow)` in `accountability.js` decides what to do; the scheduler then performs it and stores the bookkeeping columns `last_settled_week` / `last_reminder_date`.

- A week is settled on Monday after `WEEK_GRACE_HOURS` (noon), so Sunday workouts can still be logged as "yesterday". Missed weeks are caught up after downtime. `settleWeek` turns missed pledges into `debts` and is idempotent (unique `guild_id, user_id, week_start`).
- Once a week is settled it is closed: `isOpenDate` makes check-ins and undos into it fail.
- A new server starts with `last_settled_week` set to the last finished week, so earlier weeks are never judged.

### Rules encoded in the data model

- **Pledges are versioned rows** keyed by `effective_week`. `pledgeFor(week)` picks the latest row at or before that week, and `target = 0` means cleared. `/pledge set` and `clear` always write next Monday's row, so a pledge can't be changed mid-week.
- **Pledges count distinct workout days, not check-ins.** A second check-in on the same day earns half XP.
- **XP is stored per check-in.** Totals, level and stats are always derived by summing, so deleting a check-in (undo) reverts everything with no other bookkeeping.

### Discord gotchas already handled

- **Proof files:** check-in proof is re-uploaded as a file on the bot's reply, and the reply's channel/message ID is stored, because Discord attachment URLs expire. `/gallery` fetches those messages again to get fresh URLs.
- **Pings:** mentions inside embeds never notify anyone. Use `pingLine(...ids)` from `shared.js` to put the people who should be notified in the message content. `pinging()` and `NO_PINGS` control `allowedMentions` for mentions in the text.
- **Intents and permissions:** the client uses only the `Guilds` intent and never reads message content. The bot's channel permissions (checked in `/setup` and baked into the README invite link, `permissions=117760`) are View Channel, Send Messages, Embed Links, Attach Files and Read Message History.

## Deployment

The `Dockerfile` CMD runs `deploy-commands.js` and then `index.js` on every container start, so changes to commands go live with `docker compose up -d --build`. The SQLite database is in the `accountabilibuddy_data` named volume mounted at `/app/data`; `DATABASE_PATH` is pinned to it in `docker-compose.yml`. The container runs as the `node` user. `index.js` handles SIGTERM/SIGINT by destroying the client and closing the database.
