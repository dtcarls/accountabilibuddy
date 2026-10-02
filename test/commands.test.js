import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Collection } from 'discord.js';
import { settleWeek } from '../src/accountability.js';
import * as buddy from '../src/commands/buddy.js';
import * as checkin from '../src/commands/checkin.js';
import * as gallery from '../src/commands/gallery.js';
import * as help from '../src/commands/help.js';
import * as leaderboard from '../src/commands/leaderboard.js';
import * as pledge from '../src/commands/pledge.js';
import * as profile from '../src/commands/profile.js';
import * as setup from '../src/commands/setup.js';
import { reminderMessage, weeklyMessage } from '../src/scheduler.js';
import { Store } from '../src/store.js';
import { addDays, localNow, weekStartOf } from '../src/time.js';

// Smoke tests: run each handler against a fake interaction to catch mistakes
// in the Discord layer without needing a real bot connection.

const G = 'guild-1';

function fakeUser(id) {
  return { id, username: id, displayName: id.toUpperCase(), bot: false, displayAvatarURL: () => 'https://x/avatar.png' };
}

const posted = new Map();
const channel = {
  messages: {
    fetch: async (id) => posted.get(id),
    delete: async (id) => posted.delete(id),
  },
};

function interact({ user = 'alice', sub, options = {}, customId } = {}) {
  const replies = [];
  const record = (r) => {
    replies.push(typeof r === 'string' ? { content: r } : r);
    return r;
  };
  return {
    guildId: G,
    customId,
    user: fakeUser(user),
    member: { displayName: user.toUpperCase() },
    memberPermissions: { has: () => false },
    client: { user: { id: 'bot' }, channels: { fetch: async () => channel } },
    options: {
      getSubcommand: () => sub,
      getString: (n) => options[n] ?? null,
      getInteger: (n) => options[n] ?? null,
      getUser: (n) => (options[n] ? fakeUser(options[n]) : null),
      getMember: () => null,
      getAttachment: (n) => options[n],
      getChannel: (n) => options[n],
      getFocused: () => options.focused ?? '',
    },
    reply: async (r) => record(r),
    update: async (r) => record(r),
    respond: async (r) => record({ choices: r }),
    deferReply: async () => {},
    editReply: async (r) => {
      record(r);
      if (!r.files) return {};
      const id = `msg-${posted.size + 1}`;
      const files = new Collection(r.files.map((f) => [f.name, { url: `https://cdn/${f.name}`, contentType: 'image/png' }]));
      posted.set(id, { id, channelId: 'chan', url: `https://discord/${id}`, attachments: files });
      return { id, channelId: 'chan' };
    },
    replies,
  };
}

const proof = { name: 'Lift.PNG', url: 'https://cdn/lift.png', contentType: 'image/png', size: 1000 };

test('a full week of using the bot', async () => {
  const store = new Store();

  let i = interact({ options: { channel: { id: 'chan', permissionsFor: () => ({ missing: () => [] }) }, timezone: 'America/Chicago' } });
  await setup.execute(i, store);
  assert.match(i.replies[0].embeds[0].title, /set up/);
  assert.ok(store.getGuild(G).last_settled_week);

  i = interact({ options: { focused: 'chicago' } });
  await setup.autocomplete(i);
  assert.deepEqual(i.replies[0].choices, [{ name: 'America/Chicago', value: 'America/Chicago' }]);

  i = interact({ options: { kind: 'strength', minutes: 45, proof, note: 'New PR!' } });
  await checkin.execute(i, store);
  const embed = i.replies[0].embeds[0];
  assert.equal(embed.title, '🏋️ 45 min of Strength');
  assert.equal(embed.image.url, 'attachment://proof.png');
  assert.equal(i.replies[0].files[0].name, 'proof.png');
  assert.ok(store.latestCheckin(G, 'alice').message_id);

  i = interact({ options: { kind: 'cardio', minutes: 20, proof: { ...proof, contentType: 'application/pdf' } } });
  await checkin.execute(i, store);
  assert.match(i.replies[0].content, /photo, screenshot or video/);

  i = interact({ sub: 'request', options: { user: 'bob' } });
  await buddy.execute(i, store);
  const customId = i.replies[0].components[0].components[0].data.custom_id;
  assert.equal(customId, 'buddy:accept:alice:bob');

  i = interact({ user: 'mallory', customId });
  await buddy.onButton(i, store);
  assert.match(i.replies[0].content, /isn't for you/);

  i = interact({ user: 'bob', customId });
  await buddy.onButton(i, store);
  assert.match(i.replies[0].content, /now accountability buddies/);
  assert.equal(store.getBuddy(G, 'alice'), 'bob');

  i = interact({ sub: 'status' });
  await buddy.execute(i, store);
  assert.match(i.replies[0].embeds[0].description, /<@alice>: \*\*1 day\*\* this week · worked out today/);

  i = interact({ sub: 'set', options: { days: 4, stake: 'Buy Bob a coffee', owed_to: 'bob' } });
  await pledge.execute(i, store);
  assert.match(i.replies[0].embeds[0].description, /4 days a week/);
  assert.equal(i.replies[0].content, '<@bob>');

  i = interact({ sub: 'status' });
  await pledge.execute(i, store);
  assert.match(i.replies[0].embeds[0].description, /no pledge/);
  assert.match(i.replies[0].embeds[0].description, /From .*4 days/);

  i = interact({ sub: 'set', options: { days: 3, stake: 'x', owed_to: 'alice' } });
  await pledge.execute(i, store);
  assert.match(i.replies[0].content, /can't owe yourself/);

  i = interact();
  await profile.execute(i, store);
  const card = i.replies[0].embeds[0];
  assert.match(card.title, /ALICE: Level 2 Couch Potato/);
  assert.equal(card.fields.at(-1).value.split('\n').length, 8);

  i = interact();
  await gallery.execute(i, store);
  assert.equal(i.replies[0].embeds.length, 1);
  assert.match(i.replies[0].embeds[0].image.url, /proof\.png/);

  i = interact({ options: {} });
  await leaderboard.execute(i, store);
  assert.match(i.replies[0].embeds[0].description, /🥇 <@alice>: 1 day · 45 min/);

  i = interact();
  await help.execute(i, store);
  assert.equal(i.replies[0].embeds[0].fields.length, 5);

  i = interact();
  await checkin.undo.execute(i, store);
  assert.match(i.replies[0].content, /Removed your 45-minute check-in/);
  assert.equal(store.totals(G, 'alice').workouts, 0);
  assert.equal(posted.size, 0);
});

test('missed pledges show up in the weekly post and the ledger', async () => {
  const store = new Store();
  const today = localNow('UTC').toISODate();
  const week = weekStartOf(today);
  store.setPledge({ guildId: G, userId: 'alice', effectiveWeek: week, target: 3, stake: 'Buy Bob a coffee', recipientId: 'bob' });
  store.addCheckin({ guildId: G, userId: 'alice', localDate: week, kind: 'cardio', minutes: 30, xp: 100 });

  const message = weeklyMessage(settleWeek(store, G, week));
  assert.equal(message.content, '<@alice> <@bob>');
  assert.match(message.embeds[0].fields[0].value, /did 1\/3 and owes \*\*Buy Bob a coffee\*\* to <@bob> \(stake #1\)/);

  let i = interact({ sub: 'ledger' });
  await pledge.execute(i, store);
  assert.match(i.replies[0].embeds[0].fields[0].value, /#1/);

  i = interact({ sub: 'paid', options: { id: 1 } });
  await pledge.execute(i, store);
  assert.match(i.replies[0].content, /Only <@bob>/);

  i = interact({ user: 'bob', sub: 'paid', options: { id: 1 } });
  await pledge.execute(i, store);
  assert.match(i.replies[0].content, /settled/);
  assert.equal(store.unpaidDebts(G, 'alice').length, 0);

  // Next week's pledge can be cleared.
  store.setPledge({ guildId: G, userId: 'alice', effectiveWeek: addDays(week, 7), target: 3, stake: 'x' });
  i = interact({ sub: 'clear' });
  await pledge.execute(i, store);
  assert.match(i.replies[0].content, /ending their pledge after this week/);
});

test('reminder message pings the slacker and their buddy', () => {
  const message = reminderMessage({
    atRisk: [{ userId: 'alice', buddyId: 'bob', needed: 2, daysLeft: 2, impossible: false, stake: 'x' }],
    idle: [{ userId: 'carol', buddyId: 'dave', daysSince: 3 }],
  });
  assert.equal(message.content, '<@alice> <@bob> <@dave>');
  assert.match(message.embeds[0].description, /every remaining day/);
  assert.equal(reminderMessage({ atRisk: [], idle: [] }), null);
});
