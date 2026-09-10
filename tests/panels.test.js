const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs").promises;
const os = require("node:os");
const path = require("node:path");
const { Collection, PermissionsBitField, PermissionFlagsBits } = require("discord.js");
const { readPanelState, upsertPanelMessage } = require("../utils/panel-message");
const { buildLinkPanelComponents, LINK_PANEL_CUSTOM_IDS } = require("../utils/link-panel");
const { buildStatusComponents, STATUS_PLAYERS_CUSTOM_ID } = require("../utils/status-panel");
const { buildSupportPanelComponents, TICKET_CUSTOM_IDS } = require("../utils/ticket-components");
const { buildSuggestionPanelComponents, SUGGESTION_CUSTOM_IDS } = require("../utils/suggestion-components");

async function fixture(t, components = buildLinkPanelComponents(), customId = LINK_PANEL_CUSTOM_IDS.connectButton) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "rede-lhama-panel-test-"));
  const stateFilePath = path.join(directory, "state.json");
  t.after(async () => {
    for (const file of [stateFilePath, `${stateFilePath}.tmp`]) {
      await fs.unlink(file).catch((error) => { if (error.code !== "ENOENT") throw error; });
    }
    await fs.rmdir(directory);
  });
  const messages = new Collection();
  const sent = [];
  const edits = [];
  const fetches = [];
  const client = { user: { id: "bot" } };
  const channel = {
    id: "channel",
    permissionsFor: () => new PermissionsBitField([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory]),
    messages: { fetch: async (query) => {
      fetches.push(query);
      if (typeof query === "string") {
        if (!messages.has(query)) throw Object.assign(new Error("Unknown Message"), { code: 10008 });
        return messages.get(query);
      }
      const entries = [...messages.entries()];
      const start = query.before ? entries.findIndex(([id]) => id === query.before) + 1 : 0;
      return new Collection(entries.slice(start, start + query.limit));
    } },
    send: async (payload) => {
      sent.push(payload);
      const message = makeMessage(`sent-${sent.length}`, payload.components);
      messages.set(message.id, message);
      return message;
    },
  };
  function makeMessage(id, data = components, authorId = client.user.id) {
    return { id, author: { id: authorId }, components: data.map((component) => ({ toJSON: () => component })),
      edit: async (payload) => { edits.push({ id, payload }); } };
  }
  const options = { client, channel, components, customId, stateFilePath };
  return { options, messages, sent, edits, fetches, makeMessage };
}

const panels = [
  ["link", buildLinkPanelComponents, LINK_PANEL_CUSTOM_IDS.connectButton],
  ["status", () => buildStatusComponents({ online: false }), STATUS_PLAYERS_CUSTOM_ID],
  ["tickets", () => buildSupportPanelComponents({ openTicketCount: 0 }), TICKET_CUSTOM_IDS.panelSelect],
  ["suggestions", buildSuggestionPanelComponents, SUGGESTION_CUSTOM_IDS.openButton],
];

for (const [name, build, customId] of panels) {
  test(`${name}: restart reuses the original panel even when deployment removes its state file`, async (t) => {
    const f = await fixture(t, build(), customId);
    const first = await upsertPanelMessage(f.options);
    await fs.unlink(f.options.stateFilePath);
    const recovered = await upsertPanelMessage(f.options);
    assert.equal(recovered.id, first.id);
    assert.equal(f.sent.length, 1);
    assert.equal(f.edits.length, 1);
    assert.equal((await readPanelState(f.options.stateFilePath)).messageId, first.id);
    await upsertPanelMessage(f.options);
    assert.equal(f.sent.length, 1);
    assert.equal(f.fetches.at(-1), first.id);
  });
}

test("recovers an older panel across history pages and ignores other authors and panel types", async (t) => {
  const f = await fixture(t);
  for (let index = 0; index < 100; index++) {
    f.messages.set(`noise-${index}`, f.makeMessage(`noise-${index}`, f.options.components, "someone-else"));
  }
  f.messages.set("other-panel", f.makeMessage("other-panel", buildSuggestionPanelComponents()));
  f.messages.set("original", f.makeMessage("original"));
  assert.equal((await upsertPanelMessage(f.options)).id, "original");
  assert.equal(f.sent.length, 0);
  assert.equal(f.fetches[1].before, "noise-99");
});

test("a stale message ID or corrupt state recovers a matching existing panel", async (t) => {
  t.mock.method(console, "warn", () => {});
  const f = await fixture(t);
  f.messages.set("original", f.makeMessage("original"));
  await fs.writeFile(f.options.stateFilePath, JSON.stringify({ channelId: "channel", messageId: "deleted" }));
  await upsertPanelMessage(f.options);
  await fs.writeFile(f.options.stateFilePath, "{invalid json");
  await upsertPanelMessage(f.options);
  assert.equal(f.sent.length, 0);
  assert.equal(f.edits.length, 2);
});

test("missing history permission or API failures never trigger a duplicate publication", async (t) => {
  const f = await fixture(t);
  f.messages.set("original", f.makeMessage("original"));
  await upsertPanelMessage(f.options);
  const permissionsFor = f.options.channel.permissionsFor;
  f.options.channel.permissionsFor = () => new PermissionsBitField(PermissionFlagsBits.ViewChannel);
  await assert.rejects(upsertPanelMessage(f.options), /Ler histórico/);
  f.options.channel.permissionsFor = permissionsFor;
  const fetch = f.options.channel.messages.fetch;
  f.options.channel.messages.fetch = async () => { throw Object.assign(new Error("Missing access"), { code: 50001 }); };
  await assert.rejects(upsertPanelMessage(f.options), /Missing access/);
  f.options.channel.messages.fetch = fetch;
  f.messages.get("original").edit = async () => { throw new Error("Network failure"); };
  await assert.rejects(upsertPanelMessage(f.options), /Network failure/);
  assert.equal(f.sent.length, 0);
});

test("a deleted panel is recreated once, including deletion between fetch and edit", async (t) => {
  const f = await fixture(t);
  const original = f.makeMessage("original");
  f.messages.set(original.id, original);
  original.edit = async () => {
    f.messages.delete(original.id);
    throw Object.assign(new Error("Unknown Message"), { code: 10008 });
  };
  const recreated = await upsertPanelMessage(f.options);
  assert.equal(f.sent.length, 1);
  await upsertPanelMessage(f.options);
  assert.equal(f.sent.length, 1);
  assert.equal((await readPanelState(f.options.stateFilePath)).messageId, recreated.id);
});

test("simultaneous startup and refresh create just one message", async (t) => {
  const f = await fixture(t);
  const results = await Promise.all(Array.from({ length: 5 }, () => upsertPanelMessage(f.options)));
  assert.equal(new Set(results.map((message) => message.id)).size, 1);
  assert.equal(f.sent.length, 1);
  assert.equal(f.edits.length, 4);
});

test("recovers a successful send whose state could not be saved without sending again", async (t) => {
  const f = await fixture(t);
  const originalWrite = fs.writeFile.bind(fs);
  const write = t.mock.method(fs, "writeFile", async (file, ...args) => {
    if (file === `${f.options.stateFilePath}.tmp`) throw new Error("Disk full");
    return originalWrite(file, ...args);
  });
  await assert.rejects(upsertPanelMessage(f.options), /Disk full/);
  assert.equal(f.sent.length, 1);
  write.mock.restore();
  await upsertPanelMessage(f.options);
  assert.equal(f.sent.length, 1);
  assert.equal(f.edits.length, 1);
});

test("preserves suggestion destination metadata when recovering panel state", async (t) => {
  const f = await fixture(t, buildSuggestionPanelComponents(), SUGGESTION_CUSTOM_IDS.openButton);
  await upsertPanelMessage({ ...f.options, extraState: { suggestionChannelId: "suggestions" } });
  await upsertPanelMessage(f.options);
  assert.equal((await readPanelState(f.options.stateFilePath)).suggestionChannelId, "suggestions");
});
