const { test } = require("node:test");
const assert = require("node:assert/strict");
const { Collection, ComponentType, MessageFlags, ModalSubmitFields, PermissionsBitField, PermissionFlagsBits } = require("discord.js");
const config = require("../config");
const command = require("../Commands/equipe/equipe");
const { TEAM_IDS, buildTeamModal } = require("../utils/team-components");
const { handleTeamInteraction, validateTeamChange } = require("../utils/team-manager");
const { resolveTeamRoles } = require("../utils/team-roles");

function fakeRole(id, position) {
  return { id, name: "Ajudante", position, managed: false, comparePositionTo(other) { return position - other.position; } };
}

function fixture(type = "entrar") {
  const mutations = [];
  const replies = [];
  const posts = [];
  const role = fakeRole("role", 5);
  const baseRole = { ...fakeRole("base", 1), name: "Team" };
  const guildRoles = new Collection([[role.id, role], [baseRole.id, baseRole]]);
  function person(id, position) {
    return { id, user: { bot: false }, permissions: new PermissionsBitField(PermissionFlagsBits.ManageRoles),
      roles: { highest: fakeRole(`${id}-highest`, position), cache: new Collection() } };
  }
  const actor = person("actor", 20);
  const bot = person("bot", 30);
  const member = person("member", 1);
  if (type === "remover") {
    member.roles.cache.set(role.id, role);
    member.roles.cache.set(baseRole.id, baseRole);
  }
  member.roles.set = async (ids) => {
    mutations.push(["set", ids]);
    member.roles.cache = new Collection(ids.map((id) => [id, guildRoles.get(id)]));
  };
  const channel = { id: "channel", guildId: "guild", isTextBased: () => true,
    permissionsFor: () => new PermissionsBitField(PermissionFlagsBits.Administrator),
    send: async (payload) => { posts.push(payload); return { url: "https://discord.com/channels/guild/channel/message" }; } };
  const guild = { id: "guild", ownerId: "owner",
    members: { fetch: async ({ user }) => user === actor.id ? actor : member, fetchMe: async () => bot },
    roles: { cache: guildRoles, fetch: async () => guildRoles },
    channels: { cache: new Collection([[channel.id, channel]]), fetch: async () => channel } };
  const photo = { url: "https://cdn.discordapp.com/attachments/test/photo.png", contentType: "image/png", size: 10, width: 10, height: 10 };
  const fields = new ModalSubmitFields([
    { component: { type: ComponentType.UserSelect, customId: TEAM_IDS.member, users: new Collection([[member.id, member.user]]) } },
    { component: { type: ComponentType.StringSelect, customId: TEAM_IDS.role, values: [role.id] } },
    { component: { type: ComponentType.FileUpload, customId: TEAM_IDS.photo, attachments: new Collection([["photo", photo]]) } },
  ]);
  const interaction = { id: "interaction", user: { id: actor.id }, guild, guildId: guild.id, channelId: channel.id,
    customId: `${TEAM_IDS.modalPrefix}${type}`, fields, attachmentSizeLimit: 1000,
    isModalSubmit: () => true, inGuild: () => true,
    deferReply: async (payload) => { interaction.deferred = true; assert.equal(payload.flags, MessageFlags.Ephemeral); },
    editReply: async (payload) => replies.push(payload) };
  return { guild, guildRoles, baseRole, actor, bot, member, role, type, photo, interaction, channel, mutations, replies, posts };
}

test("equipe command and modal expose both operations, two required selects and one photo", () => {
  const data = command.data.toJSON();
  assert.deepEqual(data.options[0].choices.map((choice) => choice.value), ["entrar", "remover"]);
  assert.equal(data.default_member_permissions, String(PermissionFlagsBits.ManageRoles));
  for (const type of ["entrar", "remover"]) {
    const modal = buildTeamModal(type, resolveTeamRoles(fixture().guildRoles).ranks).toJSON();
    assert.deepEqual(modal.components.map((label) => label.component.type), [ComponentType.UserSelect, ComponentType.StringSelect, ComponentType.FileUpload]);
    assert(modal.components.every((label) => label.component.required && label.component.max_values === 1));
  }
  assert.throws(() => buildTeamModal("invalid"));
});

test("validates permissions, hierarchy, protected roles and membership state", () => {
  const scenarios = [
    (f) => { f.actor.permissions = new PermissionsBitField(); },
    (f) => { f.bot.permissions = new PermissionsBitField(); },
    (f) => { f.role.managed = true; },
    (f) => { f.role.id = f.guild.id; },
    (f) => { f.role = null; },
    (f) => { f.role.position = 20; },
    (f) => { f.role.position = 30; },
    (f) => { f.member.roles.highest.position = 20; },
    (f) => { f.member.roles.highest.position = 30; },
    (f) => { f.member.id = f.guild.ownerId; },
    (f) => { f.member = null; },
    (f) => { f.member.user.bot = true; },
    (f) => { f.member.roles.cache.set(f.role.id, f.role); },
    (f) => { f.type = "remover"; },
  ];
  assert.equal(validateTeamChange(fixture()), null);
  for (const change of scenarios) {
    const f = fixture();
    change(f);
    assert.equal(typeof validateTeamChange(f), "string");
  }
  const owner = fixture();
  owner.actor.id = owner.guild.ownerId;
  owner.role.position = 25;
  assert.equal(validateTeamChange(owner), null);
});

for (const type of ["entrar", "remover"]) {
  test(`${type} changes the role once and publishes the uploaded photo`, async () => {
    const f = fixture(type);
    await handleTeamInteraction(f.interaction);
    assert.deepEqual(f.mutations, [["set", type === "entrar" ? [f.role.id, f.baseRole.id] : []]]);
    assert.equal(f.posts.length, 1);
    assert.equal(f.posts[0].files[0].attachment, f.photo.url);
    assert.equal(f.posts[0].flags, MessageFlags.IsComponentsV2);
    assert.deepEqual(f.posts[0].allowedMentions, { parse: [], users: [f.member.id], roles: [f.role.id] });
    const container = f.posts[0].components[0];
    const section = container.components[0];
    assert.equal(container.accent_color, Number.parseInt(config.team.color, 16));
    assert.equal(section.type, ComponentType.Section);
    assert.equal(section.accessory.type, ComponentType.Thumbnail);
    assert.equal(section.accessory.media.url, "attachment://equipe.png");
    assert.match(section.components[0].content, /• Alteração na Equipe/);
    assert.equal(section.components[1].content, type === "entrar"
      ? "<@member> agora exerce o cargo de <@&role> na equipe."
      : "<@member> deixou de exercer o cargo de <@&role> na equipe.");
    assert.match(f.replies[0], /registro publicado/);
    await handleTeamInteraction(f.interaction);
    assert.equal(f.mutations.length, 1);
    assert.equal(f.posts.length, 1);
  });
}

test("rechecks permissions on submit and rejects invalid images before any mutation", async () => {
  for (const change of [
    (f) => { f.actor.permissions = new PermissionsBitField(); },
    (f) => { f.photo.contentType = "application/pdf"; },
    (f) => { f.photo.size = 2000; },
    (f) => { f.channel.permissionsFor = () => new PermissionsBitField(); },
    (f) => { f.channel.permissionsFor = () => new PermissionsBitField([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]); },
  ]) {
    const f = fixture();
    change(f);
    await handleTeamInteraction(f.interaction);
    assert.equal(f.mutations.length, 0);
    assert.equal(f.posts.length, 0);
    assert.equal(f.replies.length, 1);
  }
});

test("uses configured log channel when present", async (t) => {
  t.mock.property(config.team, "logChannelId", "logs");
  const f = fixture();
  f.guild.channels.fetch = async (id) => { assert.equal(id, "logs"); return f.channel; };
  await handleTeamInteraction(f.interaction);
  assert.equal(f.posts.length, 1);
});

test("reports partial success honestly when publishing fails", async (t) => {
  t.mock.method(console, "error", () => {});
  const f = fixture();
  f.channel.send = async () => { throw new Error("Upload failed"); };
  await handleTeamInteraction(f.interaction);
  assert.equal(f.mutations.length, 1);
  assert.match(f.replies[0], /cargo foi alterado, mas não consegui publicar/);
});

test("does not publish a successful record if the role mutation fails", async (t) => {
  t.mock.method(console, "error", () => {});
  const f = fixture();
  f.member.roles.set = async () => { throw new Error("Missing permissions"); };
  await handleTeamInteraction(f.interaction);
  assert.equal(f.posts.length, 0);
  assert.match(f.replies[0], /Não consegui concluir/);
  f.member.roles.set = async (ids) => f.mutations.push(["set", ids]);
  await handleTeamInteraction(f.interaction);
  assert.equal(f.posts.length, 1, "the operation lock must be released after failure");
});

test("blocks simultaneous changes for the same member and role", async () => {
  const f = fixture();
  let release;
  let started;
  const ready = new Promise((resolve) => { started = resolve; });
  f.member.roles.set = async (ids) => {
    f.mutations.push(["set", ids]);
    started();
    await new Promise((resolve) => { release = resolve; });
  };
  const first = handleTeamInteraction(f.interaction);
  await ready;
  try {
    await handleTeamInteraction(f.interaction);
    assert.match(f.replies[0], /alteração em andamento/);
  } finally {
    release();
    await first;
  }
  assert.equal(f.mutations.length, 1);
  assert.equal(f.posts.length, 1);
});

test("menu contains only team ranks in the configured order; Team is a separate base role", () => {
  const roles = new Collection(config.team.rankNames.map((name, index) => {
    const role = { ...fakeRole(`rank-${index}`, 20 - index), name };
    return [role.id, role];
  }));
  roles.set("base", { ...fakeRole("base", 1), name: "Team" });
  roles.set("vip", { ...fakeRole("vip", 2), name: "VIP" });
  const { ranks, baseRole } = resolveTeamRoles(roles);
  const options = buildTeamModal("entrar", ranks).toJSON().components[1].component.options;
  assert.deepEqual(options.map((option) => option.label), config.team.rankNames);
  assert.equal(baseRole.id, "base");
  assert(!options.some((option) => ["base", "vip"].includes(option.value)));
});

for (const [name, changeType] of [["Aprendiz", "promoção"], ["Moderador", "rebaixamento"]]) {
  test(`announces ${changeType}, swaps the old rank and preserves Team and unrelated roles`, async () => {
    const f = fixture();
    // Comparison follows the configured team order, independently of Discord role positions.
    const previous = { ...fakeRole("previous", 4), name };
    const vip = { ...fakeRole("vip", 2), name: "VIP" };
    f.guildRoles.set(previous.id, previous).set(vip.id, vip);
    f.member.roles.cache.set(previous.id, previous).set(f.baseRole.id, f.baseRole).set(vip.id, vip);
    await handleTeamInteraction(f.interaction);
    assert.equal(f.mutations.length, 1);
    assert.deepEqual(new Set(f.mutations[0][1]), new Set([f.role.id, f.baseRole.id, vip.id]));
    const post = f.posts[0];
    assert.equal(post.components[0].components[0].components[1].content, changeType === "promoção"
      ? "<@member> recebeu uma **promoção** de <@&previous> para <@&role> na equipe."
      : "<@member> recebeu um **rebaixamento** de <@&previous> para <@&role> na equipe.");
    assert.deepEqual(post.allowedMentions, { parse: [], users: [f.member.id], roles: [previous.id, f.role.id] });
  });
}

test("uses the highest existing team rank for classification and removes obsolete team ranks", async () => {
  const f = fixture();
  for (const [id, name] of [["moderator", "Moderador"], ["apprentice", "Aprendiz"]]) {
    const role = { ...fakeRole(id, 4), name };
    f.guildRoles.set(id, role);
    f.member.roles.cache.set(id, role);
  }
  await handleTeamInteraction(f.interaction);
  assert.deepEqual(new Set(f.mutations[0][1]), new Set([f.role.id, f.baseRole.id]));
  assert.match(f.posts[0].components[0].components[0].components[1].content, /rebaixamento.*<@&moderator>/);
});

test("removing one of multiple team ranks preserves Team and unrelated roles", async () => {
  const f = fixture("remover");
  for (const [id, name] of [["apprentice", "Aprendiz"], ["vip", "VIP"]]) {
    const role = { ...fakeRole(id, 2), name };
    f.guildRoles.set(id, role);
    f.member.roles.cache.set(id, role);
  }
  await handleTeamInteraction(f.interaction);
  assert.deepEqual(new Set(f.mutations[0][1]), new Set([f.baseRole.id, "apprentice", "vip"]));
});

test("rejects forged non-team choices, duplicate names, and missing or unmanageable base role before mutation", async () => {
  for (const change of [
    (f) => { f.role.name = "VIP"; },
    (f) => { f.guildRoles.set("duplicate", fakeRole("duplicate", 5)); },
    (f) => { f.guildRoles.delete(f.baseRole.id); },
    (f) => { f.baseRole.position = 40; },
    (f) => { f.baseRole.managed = true; },
  ]) {
    const f = fixture();
    change(f);
    await handleTeamInteraction(f.interaction);
    assert.equal(f.mutations.length, 0);
    assert.equal(f.posts.length, 0);
    assert.equal(f.replies.length, 1);
  }
});

test("explicit role IDs support renamed or duplicated names", (t) => {
  const f = fixture();
  t.mock.property(config.team, "roleIds", { ajudante: f.role.id, team: f.baseRole.id });
  f.role.name = "Ajudante da Rede";
  f.guildRoles.set("duplicate", { ...fakeRole("duplicate", 2), name: "Team" });
  const resolved = resolveTeamRoles(f.guildRoles);
  assert.equal(resolved.ranks[0].role.id, f.role.id);
  assert.equal(resolved.baseRole.id, f.baseRole.id);
});

test("serializes changes to different ranks for the same member", async () => {
  const f = fixture();
  let release;
  let started;
  const ready = new Promise((resolve) => { started = resolve; });
  f.member.roles.set = async (ids) => {
    f.mutations.push(["set", ids]);
    started();
    await new Promise((resolve) => { release = resolve; });
  };
  const first = handleTeamInteraction(f.interaction);
  await ready;
  try {
    f.interaction.fields.getField(TEAM_IDS.role).values = ["another-rank"];
    await handleTeamInteraction(f.interaction);
    assert.match(f.replies[0], /alteração em andamento/);
  } finally {
    release();
    await first;
  }
  assert.equal(f.mutations.length, 1);
});
