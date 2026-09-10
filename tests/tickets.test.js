const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Collection, ChannelType, PermissionsBitField } = require("discord.js");
const config = require("../config");
const { Ticket, TicketCategory, TicketCounter, TicketLog, TicketReview, TicketBlacklist, TicketMessage } = require("../utils/ticket-models");
const { buildTicketOverwrites, isTicketSupport } = require("../utils/ticket-permissions");
const { cleanupTicketCategory, resolveTicketCategory, withCategoryLock } = require("../utils/ticket-categories");
const components = require("../utils/ticket-components");
const { buildTicketChannelName } = require("../utils/ticket-common");
const { renderTranscriptHtml } = require("../utils/ticket-transcript");
const { handleTicketInteraction } = require("../utils/ticket-manager");

const guildId = config.tickets.guildId;
const ownerId = "111111111111111111";
const staffId = "222222222222222222";
const botId = "333333333333333333";
const ticket = { ticketId: "abc123", ticketNumber: 1, guildId, channelId: "444444444444444444",
  ownerId, categoryType: "doubts", minecraftNick: "Lhama", status: "open", createdAt: new Date(), formData: { description: "Preciso de ajuda" } };

function fakeGuild() {
  const channels = new Collection();
  let nextId = 10;
  const mutations = [];
  const guild = { id: guildId, members: { me: { id: botId } }, channels: {
    fetch: async () => channels,
    create: async (payload) => {
      const channel = { ...payload, id: String(nextId++), guildId, guild,
        setPosition: async (position) => mutations.push(["position", channel.id, position]),
        delete: async () => { mutations.push(["delete", channel.id]); channels.delete(channel.id); } };
      channels.set(channel.id, channel); mutations.push(["create", payload]); return channel;
    },
  } };
  channels.set(config.tickets.anchorCategoryId, { id: config.tickets.anchorCategoryId, type: ChannelType.GuildCategory, position: 5 });
  return { guild, channels, mutations };
}

function mockCategories(t, records = []) {
  t.mock.method(TicketCategory, "find", (query) => {
    const result = records.filter((r) => Object.entries(query).every(([key, value]) => r[key] === value));
    const promise = Promise.resolve(result);
    promise.sort = () => Promise.resolve(result.sort((a, b) => a.instance - b.instance));
    return promise;
  });
  t.mock.method(TicketCategory, "findOne", async (query) => records.find((r) => Object.entries(query).every(([key, value]) => r[key] === value)));
  t.mock.method(TicketCategory, "create", async (record) => { records.push({ ...record, _id: record.discordCategoryId }); return record; });
  t.mock.method(TicketCategory, "deleteOne", async ({ _id }) => { const i = records.findIndex((r) => r._id === _id); if (i >= 0) records.splice(i, 1); });
  t.mock.method(Ticket, "exists", async () => false);
  return records;
}

test("private overwrites grant owner/bot/staff access and exclude ordinary staff from coordination", (t) => {
  t.mock.property(config.tickets, "supportRoles", [staffId]);
  t.mock.property(config.tickets, "coordinationRoles", ["555555555555555555"]);
  t.mock.property(config.tickets, "administratorRoles", []);
  const { guild } = fakeGuild();
  const normal = buildTicketOverwrites(guild, "doubts", ownerId);
  assert(normal.find((o) => o.id === guildId).deny.includes(PermissionsBitField.Flags.ViewChannel));
  assert(normal.find((o) => o.id === ownerId).allow.includes(PermissionsBitField.Flags.AttachFiles));
  assert(normal.some((o) => o.id === staffId));
  const restricted = buildTicketOverwrites(guild, "coordination", ownerId);
  assert(!restricted.some((o) => o.id === staffId));
  assert(restricted.some((o) => o.id === ownerId));
  assert(restricted.some((o) => o.id === botId));
  assert.equal(isTicketSupport({ roles: { cache: new Collection([[staffId, {}]]) }, permissions: new PermissionsBitField() }, "coordination"), false);
});

test("all eight categories and modal/panel payloads serialize with Components V2", () => {
  for (const type of Object.keys(config.tickets.categories)) {
    const modal = components.buildCategoryModal(type).toJSON();
    assert.equal(modal.components.length, 2);
    assert.equal(modal.components[0].type, 18);
    const panel = components.buildStaffChannelComponents({ ...ticket, categoryType: type });
    assert.equal(panel[0].type, 17);
  }
  const panel = JSON.stringify(components.buildSupportPanelComponents({ openTicketCount: 0 }));
  assert(panel.includes("Selecione o tipo de atendimento!"));
  assert(!panel.includes("DM"));
  assert.equal(buildTicketChannelName(ticket, { username: "Jogador" }), "duvidas-jogador");
  assert.equal(buildTicketChannelName({ ...ticket, categoryType: "report" }, { username: "João" }), "denuncias-joao");
  for (const build of [components.buildTicketManageComponents, components.buildTicketArchivedComponents, components.buildTicketClosedComponents]) assert(build(ticket).length);
});

test("creates and registers categories below anchor; reuses capacity before overflow", async (t) => {
  const records = mockCategories(t);
  const { guild, channels, mutations } = fakeGuild();
  const category = await resolveTicketCategory(guild, "doubts");
  assert.equal(category.name, "📁・DÚVIDAS");
  assert.equal(records.length, 1);
  assert.equal((await resolveTicketCategory(guild, "doubts")).id, category.id);
  for (let i = 0; i < 50; i++) channels.set(`child${i}`, { parentId: category.id });
  const overflow = await resolveTicketCategory(guild, "doubts");
  assert.equal(overflow.name, "📁・DÚVIDAS-2");
  channels.delete("child0");
  assert.equal((await resolveTicketCategory(guild, "doubts")).id, category.id);
  assert(!mutations.some((m) => m[1] === config.tickets.anchorCategoryId));
});

test("never deletes anchor, protected, ordinary or foreign categories", async (t) => {
  mockCategories(t);
  const { guild, mutations } = fakeGuild();
  t.mock.property(config.tickets, "protectedCategoryIds", ["protected"]);
  for (const id of [config.tickets.anchorCategoryId, config.tickets.closedCategoryId, "protected", "ordinary"]) assert.equal(await cleanupTicketCategory(guild, id), false);
  assert.equal(await cleanupTicketCategory({ ...guild, id: "foreign" }, "category"), false);
  assert.deepEqual(mutations, []);
});

test("cleanup retains categories with any child or active ticket, removes only fully empty tracked category", async (t) => {
  const records = mockCategories(t);
  const { guild, channels, mutations } = fakeGuild();
  const category = await resolveTicketCategory(guild, "report");
  channels.set("unrelated-voice", { parentId: category.id, type: ChannelType.GuildVoice });
  assert.equal(await cleanupTicketCategory(guild, category.id), false);
  channels.delete("unrelated-voice");
  t.mock.method(Ticket, "exists", async () => true);
  assert.equal(await cleanupTicketCategory(guild, category.id), false);
  t.mock.method(Ticket, "exists", async () => false);
  assert.equal(await cleanupTicketCategory(guild, category.id), true);
  assert.equal(records.length, 0);
  assert.equal(mutations.filter((m) => m[0] === "delete").length, 1);
});

test("creation and cleanup are serialized and the queue recovers after failure", async () => {
  const calls = [];
  const first = withCategoryLock(async () => { calls.push("start"); await Promise.resolve(); calls.push("end"); throw new Error("expected"); });
  const second = withCategoryLock(async () => calls.push("second"));
  await assert.rejects(first, /expected/); await second;
  assert.deepEqual(calls, ["start", "end", "second"]);
});

test("transcript escapes HTML and blocks unsafe attachment URLs while including metadata/avatar", () => {
  const html = renderTranscriptHtml({ ticket: { ...ticket, closedBy: staffId, closeReason: "<script>" }, messages: [
    { authorId: ownerId, authorTag: "<name>", avatarUrl: "https://example.com/avatar.png", createdAt: new Date(),
      content: "<script>alert(1)</script>", attachments: [{ url: "javascript:alert(1)", name: "bad" }, { url: "https://example.com/image.png", contentType: "image/png" }] },
  ] });
  assert(!html.includes("<script>")); assert(!html.includes("javascript:"));
  for (const value of ["&lt;script&gt;", "avatar.png", "image.png", staffId, "Lhama"]) assert(html.includes(value));
});

function interaction(action, member = null) {
  const replies = [];
  const i = { customId: `ticket:${action}:${ticket.ticketId}`, guildId, user: { id: staffId },
    guild: { members: { fetch: async () => member } }, client: { channels: { cache: new Collection(), fetch: async () => null } },
    isStringSelectMenu: () => false, isButton: () => true, isUserSelectMenu: () => false, isModalSubmit: () => false,
    reply: async (payload) => { replies.push(payload); i.replied = true; },
    showModal: async (modal) => replies.push(modal.toJSON()),
  };
  return { i, replies };
}

test("unauthorized users cannot claim tickets even with a forged button", async (t) => {
  t.mock.method(Ticket, "findOne", async () => ticket);
  const update = t.mock.method(Ticket, "findOneAndUpdate", async () => { throw new Error("must not mutate"); });
  const { i, replies } = interaction("claim", { roles: { cache: new Collection() }, permissions: new PermissionsBitField() });
  await handleTicketInteraction(i);
  assert.equal(update.mock.callCount(), 0);
  assert(replies[0].content.includes("permissao"));
});

test("ordinary staff cannot add users to coordination through forged controls", async (t) => {
  t.mock.property(config.tickets, "supportRoles", [staffId]);
  t.mock.method(Ticket, "findOne", async () => ({ ...ticket, categoryType: "coordination" }));
  const { i, replies } = interaction("add-user", { roles: { cache: new Collection([[staffId, {}]]) }, permissions: new PermissionsBitField() });
  await handleTicketInteraction(i);
  assert(replies[0].content.includes("permissao"));
});

test("rating ownership and closed status are enforced before database writes", async (t) => {
  t.mock.method(Ticket, "findOne", async () => ({ ...ticket, status: "closed" }));
  const create = t.mock.method(TicketReview, "create", async () => {});
  const { i, replies } = interaction("review-modal");
  i.customId += ":5"; i.isButton = () => false; i.isModalSubmit = () => true;
  await handleTicketInteraction(i);
  assert.equal(create.mock.callCount(), 0);
  assert(replies[0].content.includes("Somente"));
});

test("schema preserves atomic counter key and version-scoped unique active ownership", () => {
  assert(TicketCounter.schema.indexes().some(([keys, options]) => keys.guildId === 1 && options.unique));
  const active = Ticket.schema.indexes().find(([, options]) => options.name === "private_ticket_owner_active");
  assert.equal(active[1].unique, true);
  assert.equal(active[1].partialFilterExpression.systemVersion, "private-channels-v1");
});

test("transfer opens a modal with User Select and validates the submitted member", async (t) => {
  t.mock.property(config.tickets, "supportRoles", [staffId]);
  t.mock.method(Ticket, "findOne", async () => ticket);
  const staff = { roles: { cache: new Collection([[staffId, {}]]) }, permissions: new PermissionsBitField() };
  const { i, replies } = interaction("manage-select", staff);
  i.values = ["transfer"];
  i.isButton = () => false;
  i.isStringSelectMenu = () => true;
  i.client.channels.cache.set(ticket.channelId, {
    guildId, isTextBased: () => true, send: async () => {},
    permissionsFor: () => new PermissionsBitField(PermissionsBitField.Flags.ViewChannel),
  });
  await handleTicketInteraction(i);
  const modal = replies[0];
  assert.equal(modal.custom_id, `ticket:transfer-select-modal:${ticket.ticketId}`);
  assert.equal(modal.components[0].type, 18);
  assert.equal(modal.components[0].component.type, 5);
  assert.equal(modal.components[0].component.custom_id, "target-user");

  i.customId = modal.custom_id;
  i.isStringSelectMenu = () => false;
  i.isModalSubmit = () => true;
  i.fields = { getSelectedUsers: () => new Collection([[ownerId, { id: ownerId }]]) };
  i.guild.members.fetch = async (target) => typeof target === "object" ? staff
    : { roles: { cache: new Collection() }, permissions: new PermissionsBitField() };
  i.deferReply = async () => { i.deferred = true; };
  i.editReply = async (payload) => replies.push(payload);
  await handleTicketInteraction(i);
  assert(replies.at(-1).content.includes("Selecione um membro da equipe"));
  assert.equal(ticket.assignedStaffId, undefined);
});

test("opening uses atomic numbering; closing archives with preserved permissions and sends review by DM", async (t) => {
  const fs = require("fs").promises;
  const writes = [];
  t.mock.method(fs, "mkdir", async () => {});
  t.mock.method(fs, "writeFile", async (path, content) => writes.push({ path, content }));
  t.mock.method(fs, "readFile", async () => "{}");
  t.mock.property(config.tickets, "panelChannelId", "");
  t.mock.property(config.tickets, "transcriptChannelId", "");
  t.mock.property(config.tickets, "logChannelId", "");
  t.mock.property(config.tickets, "supportRoles", [staffId]);
  mockCategories(t);
  t.mock.method(TicketBlacklist, "findOne", async () => null);
  t.mock.method(TicketLog, "exists", async () => false);
  t.mock.method(TicketLog, "create", async () => ({}));
  t.mock.method(TicketMessage, "create", async () => ({}));
  t.mock.method(TicketMessage, "find", () => ({ sort: async () => [] }));
  t.mock.method(Ticket, "countDocuments", async () => 0);
  let stored;
  t.mock.method(Ticket, "create", async (value) => {
    stored = { ...value, ticketId: "abcdef123456", createdAt: new Date(), save: async () => stored };
    return stored;
  });
  const increment = t.mock.method(TicketCounter, "findOneAndUpdate", async (query, update, options) => {
    assert.equal(query.guildId, guildId); assert.deepEqual(update, { $inc: { seq: 1 } });
    assert.equal(options.upsert, true); return { seq: 52 };
  });
  const { guild, channels } = fakeGuild();
  channels.set(config.tickets.closedCategoryId, { id: config.tickets.closedCategoryId, type: ChannelType.GuildCategory });
  const sent = []; const permissionEdits = []; const directMessages = []; const countdownEdits = [];
  const createChannel = guild.channels.create;
  guild.channels.create = async (payload) => {
    const channel = await createChannel(payload);
    if (payload.type === ChannelType.GuildText) {
      channel.parentId = payload.parent;
      channel.edit = async (options) => {
        assert.equal(options.lockPermissions, false);
        channel.parentId = options.parent; channel.name = options.name;
        return channel;
      };
      channel.send = async (message) => {
        sent.push(message);
        return { id: "999999999999999999", edit: async (payload) => countdownEdits.push(payload.content) };
      };
      channel.isTextBased = () => true;
      channel.permissionsFor = () => new PermissionsBitField(PermissionsBitField.Flags.ViewChannel);
      channel.permissionOverwrites = { edit: async (...args) => permissionEdits.push(args) };
      channel.messages = { fetch: async (query) => typeof query === "string" ? { edit: async () => {} } : new Collection() };
    }
    return channel;
  };
  const client = { user: { id: botId }, guilds: { cache: new Collection([[guildId, guild]]) },
    users: { fetch: async (id) => {
      assert.equal(id, ownerId);
      return { username: "Jogador", send: async (payload) => { directMessages.push(payload); return { id: "dm-review" }; } };
    } },
    channels: { cache: channels, fetch: async (id) => channels.get(id) || null } };
  const replies = [];
  const opening = { customId: "ticket:category-modal:doubts", guildId, guild, client,
    user: { id: ownerId, username: "Jogador", send: () => { throw new Error("Must never contact DM"); } },
    fields: { getTextInputValue: (key) => key === "minecraftNick" ? "Lhama" : "Preciso de ajuda no servidor" },
    isStringSelectMenu: () => false, isButton: () => false, isUserSelectMenu: () => false, isModalSubmit: () => true,
    deferReply: async () => { opening.deferred = true; }, editReply: async (payload) => replies.push(payload),
  };
  await handleTicketInteraction(opening);
  assert.equal(increment.mock.callCount(), 1);
  assert.equal(stored.ownerId, ownerId);
  assert.equal(channels.get(stored.channelId).name, "duvidas-jogador");
  assert(stored.categoryId);
  assert(replies.at(-1).content.includes(`<#${stored.channelId}>`));
  assert.equal(directMessages.length, 0);
  const userOverwrite = channels.get(stored.channelId).permissionOverwrites;
  assert(userOverwrite);

  t.mock.method(Ticket, "findOne", async () => stored);
  t.mock.method(Ticket, "findOneAndUpdate", async (query, update) => { Object.assign(stored, update.$set); return stored; });
  const delay = t.mock.method(require("node:timers/promises"), "setTimeout", async (milliseconds) => {
    assert.equal(milliseconds, 1000);
    assert.equal(stored.status, "open");
    assert(sent.some((payload) => payload.content === "## Este suporte será fechado em **10** segundos..."));
  });
  guild.members.fetch = async () => ({ roles: { cache: new Collection([[staffId, {}]]) }, permissions: new PermissionsBitField() });
  const closing = { ...opening, customId: `ticket:close-confirm:${stored.ticketId}`, user: { id: staffId },
    isModalSubmit: () => false, isButton: () => true, deferUpdate: async () => {} };
  await handleTicketInteraction(closing);
  assert.equal(delay.mock.callCount(), 10);
  assert.deepEqual(countdownEdits, [
    ...Array.from({ length: 9 }, (_, index) => {
      const seconds = 9 - index;
      return `## Este suporte será fechado em **${seconds}** ${seconds === 1 ? "segundo" : "segundos"}...`;
    }),
    "## Fechando este suporte...",
  ]);
  assert.equal(stored.status, "closed"); assert.equal(stored.closeReason, "Fechamento confirmado pela equipe.");
  assert.equal(stored.closedBy, staffId); assert(stored.finalizedAt);
  assert(writes.some(({ content }) => content.includes("<!doctype html>") && content.includes("Fechamento confirmado pela equipe.")));
  assert(permissionEdits.some(([id, permissions]) => id === ownerId && permissions.SendMessages === false));
  assert(!sent.some((payload) => JSON.stringify(payload).includes("ticket:review:")));
  assert(directMessages.some((payload) => JSON.stringify(payload).includes("ticket:review:")));
  assert.equal(channels.get(stored.channelId).name, "closed-jogador");
  assert.equal(stored.categoryId, config.tickets.closedCategoryId);
  assert(channels.has(config.tickets.closedCategoryId));
});

test("review selection accepts the owner in DM and rejects another user", async (t) => {
  t.mock.method(Ticket, "findOne", async () => ({ ...ticket, status: "closed" }));
  t.mock.method(TicketReview, "exists", async () => false);
  const { i, replies } = interaction("review");
  i.guildId = null;
  i.user = { id: ownerId };
  i.isButton = () => false;
  i.isStringSelectMenu = () => true;
  i.values = ["5"];
  await handleTicketInteraction(i);
  assert.equal(replies[0].custom_id, `ticket:review-modal:${ticket.ticketId}:5`);
  i.user = { id: staffId };
  await handleTicketInteraction(i);
  assert(replies.at(-1).content.includes("Somente quem abriu"));
});

function callUserFixture(t) {
  t.mock.property(config.tickets, "supportRoles", [staffId]);
  t.mock.property(config.tickets, "logChannelId", "");
  const stored = { ...ticket, lastCallAt: null };
  const directMessages = [];
  const logs = [];
  t.mock.method(Ticket, "findOne", async () => ({ ...stored }));
  const reserve = t.mock.method(Ticket, "findOneAndUpdate", async (query, update) => {
    if (stored.lastCallAt && stored.lastCallAt > query.$or[2].lastCallAt.$lte) return null;
    Object.assign(stored, update.$set);
    return { ...stored };
  });
  const rollback = t.mock.method(Ticket, "updateOne", async (query, update) => {
    assert.equal(query.lastCallAt, stored.lastCallAt);
    Object.assign(stored, update.$set);
    return { modifiedCount: 1 };
  });
  t.mock.method(TicketLog, "create", async (payload) => logs.push(payload));
  const staff = { roles: { cache: new Collection([[staffId, {}]]) }, permissions: new PermissionsBitField() };
  const { i, replies } = interaction("call-user", staff);
  i.deferReply = async ({ flags }) => {
    assert.equal(flags, 64);
    i.deferred = true;
  };
  i.editReply = async (payload) => replies.push(payload);
  i.client.channels.cache.set(ticket.channelId, {
    guildId, isTextBased: () => true,
    permissionsFor: () => new PermissionsBitField(PermissionsBitField.Flags.ViewChannel),
    send: async () => assert.fail("The call notification must only be sent to the ticket owner's DM"),
  });
  const owner = { send: async (payload) => { directMessages.push(payload); return { id: "call-dm" }; } };
  const fetchOwner = t.mock.fn(async (id) => { assert.equal(id, ownerId); return owner; });
  i.client.users = { fetch: fetchOwner };
  return { i, replies, stored, directMessages, logs, reserve, rollback, owner, fetchOwner };
}

test("calling the owner sends a DM panel with a direct ticket link and enforces cooldown", async (t) => {
  const f = callUserFixture(t);
  await handleTicketInteraction(f.i);
  assert.equal(f.directMessages.length, 1);
  const payload = f.directMessages[0];
  assert.equal(payload.flags, 32768);
  assert.deepEqual(payload.allowedMentions, { parse: [], users: [ownerId] });
  const container = payload.components[0];
  assert.equal(container.type, 17);
  assert.match(container.components[0].content, /A equipe aguarda seu retorno/);
  const button = container.components[2].components[0];
  assert.equal(button.style, 5);
  assert.equal(button.label, "Ir para o ticket");
  assert.equal(button.url, `https://discord.com/channels/${guildId}/${ticket.channelId}`);
  assert.match(f.replies[0].content, /Chamada enviada na DM/);
  assert.equal(f.logs[0].metadata.delivered, true);
  assert.equal(f.logs[0].metadata.destination, "dm");
  assert.equal(f.rollback.mock.callCount(), 0);
  await handleTicketInteraction(f.i);
  assert.equal(f.directMessages.length, 1);
  assert.match(f.replies.at(-1).content, /cooldown/);
});

test("a blocked DM informs staff, records failure and releases the cooldown for retry", async (t) => {
  t.mock.method(console, "warn", () => {});
  const f = callUserFixture(t);
  f.owner.send = async () => { throw Object.assign(new Error("Cannot send messages to this user"), { code: 50007 }); };
  await handleTicketInteraction(f.i);
  assert.equal(f.rollback.mock.callCount(), 1);
  assert.equal(f.stored.lastCallAt, null);
  assert.equal(f.logs[0].metadata.delivered, false);
  assert.equal(f.logs[0].metadata.errorCode, 50007);
  assert.match(f.replies[0].content, /DM do jogador está bloqueada/);
  f.owner.send = async (payload) => { f.directMessages.push(payload); return { id: "retry-dm" }; };
  await handleTicketInteraction(f.i);
  assert.equal(f.directMessages.length, 1);
  assert.match(f.replies.at(-1).content, /Chamada enviada na DM/);
});

test("closed tickets and unauthorized callers never send a DM or reserve cooldown", async (t) => {
  const f = callUserFixture(t);
  f.stored.status = "closed";
  await handleTicketInteraction(f.i);
  assert.match(f.replies.at(-1).content, /ticket está fechado/);
  f.stored.status = "open";
  f.i.guild.members.fetch = async () => ({ roles: { cache: new Collection() }, permissions: new PermissionsBitField() });
  await handleTicketInteraction(f.i);
  assert.match(f.replies.at(-1).content, /permissao/);
  assert.equal(f.reserve.mock.callCount(), 0);
  assert.equal(f.fetchOwner.mock.callCount(), 0);
});
