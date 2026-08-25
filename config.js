require("dotenv").config();

const path = require("path");

function parseList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeColor(value, fallback = "00FF7F") {
  return String(value || fallback)
    .replace("#", "")
    .trim();
}

function parseHexColorInt(value, fallback = "FF6600") {
  const normalizedColor = normalizeColor(value, fallback);

  if (/^[0-9a-fA-F]{6}$/.test(normalizedColor)) {
    return Number.parseInt(normalizedColor, 16);
  }

  return Number.parseInt(normalizeColor(fallback), 16);
}

function parsePositiveInteger(value, fallback, minimum = 1) {
  const parsedValue = Number.parseInt(String(value || ""), 10);

  if (Number.isFinite(parsedValue) && parsedValue >= minimum) {
    return parsedValue;
  }

  return fallback;
}

function resolveLocalPath(value, fallback) {
  return path.resolve(String(value || fallback).trim());
}

function parseRoleMap(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce((roles, entry) => {
      const [key, roleId] = entry.split(":").map((part) => String(part || "").trim());
      if (key && roleId) {
        roles[key.toLowerCase()] = roleId;
      }
      return roles;
    }, {});
}

const linkDataDir = resolveLocalPath(process.env.LINK_DATA_DIR, path.join(process.cwd(), "data", "link"));
const linkPendingCodesFilePath = resolveLocalPath(
  process.env.LINK_PENDING_CODES_FILE,
  path.join(linkDataDir, "pending-codes.txt"),
);
const linkedAccountsFilePath = resolveLocalPath(
  process.env.LINKED_ACCOUNTS_FILE,
  path.join(linkDataDir, "linked-accounts.txt"),
);
const linkPanelMessageFilePath = resolveLocalPath(
  process.env.LINK_PANEL_MESSAGE_FILE,
  path.join(linkDataDir, "panel-message.json"),
);
const defaultMinecraftStatusFilePath = path.join(path.dirname(linkPendingCodesFilePath), "server-status.json");
const defaultStatusImages = {
  on: "https://i.imgur.com/sCfPQoR.jpeg",
  manutencao: "https://i.imgur.com/IsFEUw1.png",
};

const config = {
  discord: {
    token: process.env.DISCORD_BOT_TOKEN,
    color: normalizeColor(process.env.DISCORD_EMBED_COLOR),
    commandScope: String(process.env.DISCORD_COMMAND_SCOPE || "guild").trim().toLowerCase(),
    guildIds: parseList(process.env.DISCORD_GUILD_IDS),
    logChannelId: String(process.env.DISCORD_LOG_CHANNEL_ID || "").trim(),
    presence: {
      activityName: String(process.env.BOT_ACTIVITY_NAME || "Rede Lhama").trim(),
      activityType: String(process.env.BOT_ACTIVITY_TYPE || "Watching").trim(),
      status: String(process.env.BOT_STATUS || "online").trim(),
    },
  },
  link: {
    dataDir: linkDataDir,
    pendingCodesFilePath: linkPendingCodesFilePath,
    linkedAccountsFilePath,
    panelMessageFilePath: linkPanelMessageFilePath,
    memberRoleId: String(process.env.DISCORD_MEMBER_ROLE_ID || "").trim(),
    panelChannelId: String("1541586289281859654").trim(),
    vipRoleMap: parseRoleMap(process.env.DISCORD_VIP_ROLE_MAP),
  },
  status: {
    channelId: String(process.env.DISCORD_STATUS_CHANNEL_ID || "1495458159848980520").trim(),
    filePath: resolveLocalPath(
      process.env.MINECRAFT_STATUS_FILE || process.env.STATUS_FILE_PATH,
      defaultMinecraftStatusFilePath,
    ),
    panelMessageFilePath: resolveLocalPath(process.env.STATUS_PANEL_MESSAGE_FILE, path.join(linkDataDir, "status-panel.json")),
    displayAddress: String(process.env.STATUS_DISPLAY_ADDRESS || "localhost:25565").trim(),
    refreshIntervalMs: parsePositiveInteger(process.env.STATUS_REFRESH_INTERVAL_MS, 60000, 30000),
    staleAfterMs: parsePositiveInteger(process.env.STATUS_STALE_AFTER_MS, 120000, 30000),
    title: String(process.env.STATUS_PANEL_TITLE || "Em breve").trim(),
    players: String(process.env.STATUS_PLAYERS || "0/0").trim(),
    accentColor: parseHexColorInt(process.env.STATUS_ACCENT_COLOR),
    images: {
      on: String(process.env.STATUS_IMAGE_ON || defaultStatusImages.on).trim(),
      manutencao: String(
        process.env.STATUS_IMAGE_MANUTENCAO ||
          process.env.STATUS_IMAGE_MAINTENANCE ||
          defaultStatusImages.manutencao,
      ).trim(),
    },
  },
};

module.exports = config;
