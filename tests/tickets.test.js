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
  assert.equal(buildTicketChannelName({ ticketNumber: 52 }), "ticket-0052");
  assert.equal(buildTicketChannelName({ ticketNumber: 12345 }), "ticket-12345");
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
  for (const id of [config.tickets.anchorCategoryId, "protected", "ordinary"]) assert.equal(await cleanupTicketCategory(guild, id), false);
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

test("opening uses atomic numbering without DM, then closing persists reason, transcript and channel review", async (t) => {
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
  const sent = []; const permissionEdits = [];
  const createChannel = guild.channels.create;
  guild.channels.create = async (payload) => {
    const channel = await createChannel(payload);
    if (payload.type === ChannelType.GuildText) {
      channel.parentId = payload.parent;
      channel.send = async (message) => { sent.push(message); return { id: "999999999999999999" }; };
      channel.isTextBased = () => true;
      channel.permissionsFor = () => new PermissionsBitField(PermissionsBitField.Flags.ViewChannel);
      channel.permissionOverwrites = { edit: async (...args) => permissionEdits.push(args) };
      channel.messages = { fetch: async (query) => typeof query === "string" ? { edit: async () => {} } : new Collection() };
    }
    return channel;
  };
  const client = { user: { id: botId }, guilds: { cache: new Collection([[guildId, guild]]) },
    channels: { cache: channels, fetch: async (id) => channels.get(id) || null } };
  const replies = [];
  const opening = { customId: "ticket:category-modal:doubts", guildId, guild, client,
    user: { id: ownerId, send: () => { throw new Error("Must never contact DM"); } },
    fields: { getTextInputValue: (key) => key === "minecraftNick" ? "Lhama" : "Preciso de ajuda no servidor" },
    isStringSelectMenu: () => false, isButton: () => false, isUserSelectMenu: () => false, isModalSubmit: () => true,
    deferReply: async () => { opening.deferred = true; }, editReply: async (payload) => replies.push(payload),
  };
  await handleTicketInteraction(opening);
  assert.equal(increment.mock.callCount(), 1);
  assert.equal(stored.ownerId, ownerId);
  assert.equal(channels.get(stored.channelId).name, "ticket-0052");
  assert(stored.categoryId);
  assert(replies.at(-1).content.includes(`<#${stored.channelId}>`));
  const userOverwrite = channels.get(stored.channelId).permissionOverwrites;
  assert(userOverwrite);

  t.mock.method(Ticket, "findOne", async () => stored);
  t.mock.method(Ticket, "findOneAndUpdate", async (query, update) => { Object.assign(stored, update.$set); return stored; });
  guild.members.fetch = async () => ({ roles: { cache: new Collection([[staffId, {}]]) }, permissions: new PermissionsBitField() });
  const closing = { ...opening, customId: `ticket:close-modal:${stored.ticketId}`, user: { id: staffId },
    fields: { getTextInputValue: () => "Dúvida esclarecida" } };
  await handleTicketInteraction(closing);
  assert.equal(stored.status, "closed"); assert.equal(stored.closeReason, "Dúvida esclarecida");
  assert.equal(stored.closedBy, staffId); assert(stored.finalizedAt);
  assert(writes.some(({ content }) => content.includes("<!doctype html>") && content.includes("Dúvida esclarecida")));
  assert(permissionEdits.some(([id, permissions]) => id === ownerId && permissions.SendMessages === false));
  assert(sent.some((payload) => JSON.stringify(payload).includes("ticket:review:")));
});
