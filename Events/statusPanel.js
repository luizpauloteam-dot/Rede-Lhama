const fs = require("fs").promises;

const {
  Events,
} = require("discord.js");

const config = require("../config");
const { buildStatusComponents, STATUS_PLAYERS_CUSTOM_ID } = require("../utils/status-panel");
const { createLogger } = require("../utils/logger");
const { upsertPanelMessage } = require("../utils/panel-message");

const log = createLogger("status-panel");

let refreshTimer = null;
let isRefreshing = false;
let lastStatusSignature = "";
let lastStatusFileErrorMessage = "";

async function resolveStatusChannel(client) {
  if (!config.status.channelId) {
    log.warn("DISCORD_STATUS_CHANNEL_ID não configurado.");
    return null;
  }

  const channel =
    client.channels.cache.get(config.status.channelId) ||
    (await client.channels.fetch(config.status.channelId).catch(() => null));

  if (!channel?.isTextBased?.() || typeof channel.send !== "function") {
    log.warn(`Canal de status inválido ou inacessível: ${config.status.channelId}`);
    return null;
  }

  return channel;
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
  const parsedValue = Number(value);

  if (Number.isSafeInteger(parsedValue) && parsedValue >= 0) {
    return parsedValue;
  }

  return 0;
}

function resolveUpdatedAtMillis(statusData) {
  const directValue = Number(statusData.updatedAtMillis);
  if (Number.isSafeInteger(directValue) && directValue > 0) {
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
  const statusAgeMs = Date.now() - updatedAtMillis;
  const isFresh = updatedAtMillis > 0 && statusAgeMs >= 0 && statusAgeMs <= config.status.staleAfterMs;
  const online = statusData.online === true && isFresh;

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
        ? `Arquivo local de status não encontrado: ${config.status.filePath}`
        : `Não foi possível ler o status local do Minecraft: ${formatErrorMessage(error)}`;

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
    log.info("Status automático atualizado: servidor offline ou em manutenção.");
    return;
  }

  log.info(`Status automático atualizado: ${serverStatus.players}/${serverStatus.maxPlayers} jogadores online.`);
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
    await upsertPanelMessage({ client, channel, components,
      customId: STATUS_PLAYERS_CUSTOM_ID, stateFilePath: config.status.panelMessageFilePath });

    logStatusChange(serverStatus);
  } finally {
    isRefreshing = false;
  }
}

async function startStatusPanel(client) {
  if (refreshTimer) {
    clearInterval(refreshTimer);
  }

  await upsertStatusPanel(client).catch((error) => log.error("Falha ao sincronizar painel de status.", error));

  refreshTimer = setInterval(() => {
    upsertStatusPanel(client).catch((error) => {
      log.error("Falha ao atualizar o painel de status.", error);
    });
  }, config.status.refreshIntervalMs);
  refreshTimer.unref?.();

  log.info(`Atualizador automático de status iniciado a cada ${Math.round(config.status.refreshIntervalMs / 1000)}s.`);
}

module.exports = {
  name: Events.ClientReady,
  once: true,
  execute: startStatusPanel,
};
