const fs = require("fs").promises;
const path = require("path");

const {
  Events,
  MessageFlags,
} = require("discord.js");

const config = require("../config");
const { buildStatusComponents } = require("../utils/status-panel");
const { createLogger } = require("../utils/logger");

const log = createLogger("status-panel");
const SAFE_ALLOWED_MENTIONS = {
  parse: [],
  repliedUser: false,
};

let refreshTimer = null;
let isRefreshing = false;
let lastStatusSignature = "";
let lastStatusFileErrorMessage = "";

async function ensureParentDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function readStatusState() {
  try {
    const content = await fs.readFile(config.status.panelMessageFilePath, "utf8");
    return JSON.parse(content);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }

    log.warn("Nao foi possivel ler o estado do painel de status.", error);
    return null;
  }
}

async function writeStatusState(state) {
  await ensureParentDir(config.status.panelMessageFilePath);
  await fs.writeFile(config.status.panelMessageFilePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

async function resolveStatusChannel(client) {
  if (!config.status.channelId) {
    log.warn("DISCORD_STATUS_CHANNEL_ID nao configurado.");
    return null;
  }

  const channel =
    client.channels.cache.get(config.status.channelId) ||
    (await client.channels.fetch(config.status.channelId).catch(() => null));

  if (!channel?.isTextBased?.() || typeof channel.send !== "function") {
    log.warn(`Canal de status invalido ou inacessivel: ${config.status.channelId}`);
    return null;
  }

  return channel;
}

async function fetchStoredStatusMessage(channel, client) {
  const state = await readStatusState();
  if (!state?.messageId || state.channelId !== channel.id) {
    return null;
  }

  const message = await channel.messages.fetch(state.messageId).catch(() => null);
  if (!message || message.author?.id !== client.user.id) {
    return null;
  }

  return message;
}

function formatErrorMessage(error) {
  return error instanceof Error ? error.message : String(error || "erro desconhecido");
}

function buildOfflineStatus(error) {
  return {
    online: false,
    connectAddress: config.status.displayAddress,
    players: 0,
    maxPlayers: 0,
    error: formatErrorMessage(error),
    stale: false,
    queriedAt: new Date().toISOString(),
  };
}

function toNonNegativeInteger(value) {
  const parsedValue = Number.parseInt(String(value || ""), 10);

  if (Number.isFinite(parsedValue) && parsedValue >= 0) {
    return parsedValue;
  }

  return 0;
}

function resolveUpdatedAtMillis(statusData) {
  const directValue = Number.parseInt(String(statusData.updatedAtMillis || ""), 10);
  if (Number.isFinite(directValue) && directValue > 0) {
    return directValue;
  }

  const isoValue = Date.parse(String(statusData.updatedAt || ""));
  if (Number.isFinite(isoValue)) {
    return isoValue;
  }

  return 0;
}

function normalizeMinecraftStatus(statusData) {
  const updatedAtMillis = resolveUpdatedAtMillis(statusData);
  const isFresh =
    updatedAtMillis > 0 &&
    Date.now() - updatedAtMillis <= config.status.staleAfterMs;
  const online = Boolean(statusData.online) && isFresh;

  return {
    online,
    name: String(statusData.serverName || statusData.name || config.status.title).trim(),
    connectAddress: String(statusData.displayAddress || statusData.address || config.status.displayAddress).trim(),
    players: online ? toNonNegativeInteger(statusData.players) : 0,
    maxPlayers: toNonNegativeInteger(statusData.maxPlayers ?? statusData.max_players),
    version: String(statusData.version || "").trim(),
    motd: String(statusData.motd || "").trim(),
    stale: !isFresh,
    queriedAt: new Date().toISOString(),
    updatedAtMillis,
  };
}

async function readMinecraftStatusFile() {
  const content = await fs.readFile(config.status.filePath, "utf8");
  return JSON.parse(content);
}

async function fetchServerStatus() {
  try {
    const serverStatus = normalizeMinecraftStatus(await readMinecraftStatusFile());

    if (lastStatusFileErrorMessage) {
      log.info("Arquivo local de status voltou a responder.");
      lastStatusFileErrorMessage = "";
    }

    return serverStatus;
  } catch (error) {
    const message =
      error.code === "ENOENT"
        ? `Arquivo local de status nao encontrado: ${config.status.filePath}`
        : `Nao foi possivel ler o status local do Minecraft: ${formatErrorMessage(error)}`;

    if (message !== lastStatusFileErrorMessage) {
      log.warn(message);
      lastStatusFileErrorMessage = message;
    }

    return buildOfflineStatus(error);
  }
}

function getStatusSignature(serverStatus) {
  return [
    serverStatus.online ? "online" : "offline",
    serverStatus.players,
    serverStatus.maxPlayers,
    serverStatus.name || "",
    serverStatus.motd || "",
    serverStatus.version || "",
    serverStatus.stale ? "stale" : "fresh",
  ].join(":");
}

function logStatusChange(serverStatus) {
  const signature = getStatusSignature(serverStatus);

  if (signature === lastStatusSignature) {
    return;
  }

  lastStatusSignature = signature;

  if (!serverStatus.online) {
    log.info("Status automatico atualizado: servidor offline ou em manutencao.");
    return;
  }

  log.info(`Status automatico atualizado: ${serverStatus.players}/${serverStatus.maxPlayers} jogadores online.`);
}

async function sendStatusMessage(channel, components) {
  return channel.send({
    flags: MessageFlags.IsComponentsV2,
    components,
    allowedMentions: SAFE_ALLOWED_MENTIONS,
  });
}

async function upsertStatusPanel(client) {
  if (isRefreshing) {
    return;
  }

  isRefreshing = true;
  try {
    const channel = await resolveStatusChannel(client);
    if (!channel) {
      return;
    }

    const serverStatus = await fetchServerStatus();
    const components = buildStatusComponents(serverStatus);
    const existingMessage = await fetchStoredStatusMessage(channel, client);

    if (existingMessage) {
      await existingMessage
        .edit({
          components,
          allowedMentions: SAFE_ALLOWED_MENTIONS,
        })
        .catch(async (error) => {
          log.warn("Nao foi possivel atualizar o painel de status salvo. Vou enviar um novo.", error);
          const message = await sendStatusMessage(channel, components);
          await writeStatusState({ channelId: channel.id, messageId: message.id });
        });
    } else {
      const message = await sendStatusMessage(channel, components);
      await writeStatusState({ channelId: channel.id, messageId: message.id });
      log.info(`Painel de status enviado em ${channel.id}.`);
    }

    logStatusChange(serverStatus);
  } finally {
    isRefreshing = false;
  }
}

async function startStatusPanel(client) {
  if (refreshTimer) {
    clearInterval(refreshTimer);
  }

  await upsertStatusPanel(client);

  refreshTimer = setInterval(() => {
    upsertStatusPanel(client).catch((error) => {
      log.error("Falha ao atualizar o painel de status.", error);
    });
  }, config.status.refreshIntervalMs);
  refreshTimer.unref?.();

  log.info(`Atualizador automatico de status iniciado a cada ${Math.round(config.status.refreshIntervalMs / 1000)}s.`);
}

module.exports = {
  name: Events.ClientReady,
  once: true,
  execute: startStatusPanel,
};
