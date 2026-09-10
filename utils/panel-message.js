const fs = require("fs").promises;
const path = require("path");
const { MessageFlags, PermissionFlagsBits } = require("discord.js");
const { createLogger } = require("./logger");

const log = createLogger("panel-message");
const pendingPanels = new Map();
const HISTORY_PAGE_SIZE = 100;

async function readPanelState(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    if (error instanceof SyntaxError) {
      log.warn(`Estado do painel inválido em ${filePath}; o painel será recuperado pelo histórico.`);
      return null;
    }
    throw error;
  }
}

async function writePanelState(filePath, state) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await fs.rename(temporaryPath, filePath);
}

function hasComponentId(components, customId) {
  return components.some((component) => {
    const data = component.toJSON?.() || component;
    if ((data.custom_id || data.customId) === customId) return true;
    return hasComponentId([
      ...(data.components || []),
      ...(data.accessory ? [data.accessory] : []),
      ...(data.component ? [data.component] : []),
    ], customId);
  });
}

function isPanelMessage(message, client, customId) {
  return message?.author?.id === client.user.id && !message.webhookId &&
    hasComponentId(message.components || [], customId);
}

async function findPanelMessage({ channel, client, customId, state }) {
  const permissions = channel.permissionsFor(client.user);
  if (!permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory])) {
    throw new Error(`Preciso de Ver canal e Ler histórico de mensagens no canal ${channel.id} para reutilizar o painel sem duplicá-lo.`);
  }
  if (state?.channelId === channel.id && state.messageId) {
    try {
      const message = await channel.messages.fetch(state.messageId);
      if (isPanelMessage(message, client, customId)) return message;
    } catch (error) {
      if (error.code !== 10008) throw error;
    }
  }
  let before;
  for (;;) {
    const messages = await channel.messages.fetch({ limit: HISTORY_PAGE_SIZE, ...(before ? { before } : {}) });
    const existing = messages.find((message) => isPanelMessage(message, client, customId));
    if (existing) return existing;
    if (messages.size < HISTORY_PAGE_SIZE) return null;
    const nextBefore = messages.lastKey();
    if (!nextBefore || nextBefore === before) throw new Error(`Não foi possível avançar na leitura do histórico do canal ${channel.id}.`);
    before = nextBefore;
  }
}

async function upsertPanelMessage({ client, channel, customId, stateFilePath, components, extraState = {} }) {
  // One writer per panel type, including simultaneous startup, refresh and slash commands.
  const key = `${client.user.id}:${customId}`;
  const previous = pendingPanels.get(key) || Promise.resolve();
  const operation = previous.catch(() => {}).then(async () => {
    const state = await readPanelState(stateFilePath);
    let message = await findPanelMessage({ client, channel, customId, state });
    const payload = {
      flags: MessageFlags.IsComponentsV2,
      components,
      allowedMentions: { parse: [], repliedUser: false },
    };
    if (message) {
      try {
        await message.edit({ ...payload, content: null });
      } catch (error) {
        if (error.code !== 10008) throw error;
        // The saved message was deleted between fetch and edit; look for another existing panel.
        message = await findPanelMessage({ client, channel, customId, state: null });
        if (message) await message.edit({ ...payload, content: null });
      }
    }
    if (!message) message = await channel.send(payload);
    await writePanelState(stateFilePath, {
      ...state, ...extraState, channelId: channel.id, messageId: message.id,
    });
    return message;
  });
  pendingPanels.set(key, operation);
  try {
    return await operation;
  } finally {
    if (pendingPanels.get(key) === operation) pendingPanels.delete(key);
  }
}

module.exports = { readPanelState, upsertPanelMessage };
