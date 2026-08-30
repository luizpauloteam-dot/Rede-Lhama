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

function parseNonNegativeInteger(value, fallback) {
  const parsedValue = Number.parseInt(String(value || ""), 10);

  if (Number.isFinite(parsedValue) && parsedValue >= 0) {
    return parsedValue;
  }

  return fallback;
}

function parseBoolean(value, fallback = false) {
  const normalizedValue = String(value ?? "").trim().toLowerCase();

  if (["1", "true", "yes", "sim", "on"].includes(normalizedValue)) {
    return true;
  }

  if (["0", "false", "no", "nao", "off"].includes(normalizedValue)) {
    return false;
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
const ticketDataDir = resolveLocalPath(process.env.TICKET_DATA_DIR, path.join(process.cwd(), "data", "tickets"));
const suggestionDataDir = path.join(process.cwd(), "data", "suggestions");

function buildDescriptionModalFields() {
  return [
    { id: "description", label: "Descricao", style: "paragraph", minLength: 10, maxLength: 900, required: true },
  ];
}

const ticketModalFields = {
  doubts: buildDescriptionModalFields(),
  bugs: buildDescriptionModalFields(),
  report: buildDescriptionModalFields(),
  appeal: buildDescriptionModalFields(),
  password: buildDescriptionModalFields(),
  donation: buildDescriptionModalFields(),
  coordination: buildDescriptionModalFields(),
  other: buildDescriptionModalFields(),
};

const config = {
  mongodb: {
    uri: String(process.env.MONGODB_URI || "").trim(),
    dnsServers: parseList(process.env.MONGODB_DNS_SERVERS),
  },
  discord: {
    token: process.env.DISCORD_BOT_TOKEN,
    clientId: String(process.env.DISCORD_CLIENT_ID || "").trim(),
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
    panelChannelId: String(process.env.DISCORD_LINK_PANEL_CHANNEL_ID || "1541586289281859654").trim(),
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
  suggestions: {
    enabled: true,
    dataDir: suggestionDataDir,
    panelMessageFilePath: path.join(suggestionDataDir, "panel-message.json"),
    storeFilePath: path.join(suggestionDataDir, "suggestions.json"),
    panelChannelId: "",
    channelId: "",
    approvedChannelId: "1541872816788349038",
    bannerUrl: "https://i.imgur.com/QVwKl06.jpeg",
    accentColor: parseHexColorInt("", "00D1B2"),
  },
  tickets: {
    enabled: parseBoolean(process.env.TICKETS_ENABLED, true),
    guildId: String(process.env.DISCORD_TICKET_GUILD_ID || "1541296952514187397").trim(),
    dataDir: ticketDataDir,
    panelMessageFilePath: resolveLocalPath(
      process.env.TICKET_PANEL_MESSAGE_FILE,
      path.join(ticketDataDir, "panel-message.json"),
    ),
    panelChannelId: String(process.env.DISCORD_TICKET_PANEL_CHANNEL_ID || "").trim(),
    staffForumChannelId: String(process.env.DISCORD_TICKET_STAFF_FORUM_CHANNEL_ID || "").trim(),
    logChannelId: String(process.env.DISCORD_TICKET_LOG_CHANNEL_ID || process.env.DISCORD_LOG_CHANNEL_ID || "").trim(),
    transcriptChannelId: String(process.env.DISCORD_TICKET_TRANSCRIPT_CHANNEL_ID || "").trim(),
    reviewChannelId: String(process.env.DISCORD_TICKET_REVIEW_CHANNEL_ID || "").trim(),
    maxActiveTicketsPerUser: parsePositiveInteger(process.env.TICKET_MAX_ACTIVE_TICKETS_PER_USER, 1, 1),
    showStaffIdentity: parseBoolean(process.env.TICKET_SHOW_STAFF_IDENTITY, false),
    openCooldownSeconds: parseNonNegativeInteger(process.env.TICKET_OPEN_COOLDOWN_SECONDS, 30),
    callCooldownMs: parsePositiveInteger(process.env.TICKET_CALL_COOLDOWN_MS, 300000, 60000),
    supportRoles: parseList(process.env.DISCORD_TICKET_SUPPORT_ROLE_IDS),
    coordinationRoles: parseList(process.env.DISCORD_TICKET_COORDINATION_ROLE_IDS),
    administratorRoles: parseList(process.env.DISCORD_TICKET_ADMINISTRATOR_ROLE_IDS),
    bannerUrl: String(process.env.TICKET_PANEL_BANNER_URL || "https://i.imgur.com/QVwKl06.jpeg").trim(),
    closedBannerUrl: String(process.env.TICKET_CLOSED_BANNER_URL || "https://i.imgur.com/QVwKl06.jpeg").trim(),
    accentColor: parseHexColorInt(process.env.TICKET_ACCENT_COLOR, "00D1B2"),
    waitThresholds: {
      lowMax: parseNonNegativeInteger(process.env.TICKET_WAIT_LOW_MAX, 5),
      moderateMax: parseNonNegativeInteger(process.env.TICKET_WAIT_MODERATE_MAX, 20),
      highMax: parseNonNegativeInteger(process.env.TICKET_WAIT_HIGH_MAX, 40),
    },
    categories: {
      doubts: {
        name: "Tirar duvidas",
        threadPrefix: "duvida",
        emoji: "❔",
        description: "Obter esclarecimento sobre duvidas.",
        order: 1,
        modalTitle: "Tirar duvidas",
        modalFields: ticketModalFields.doubts,
      },
      bugs: {
        name: "Reportar erros",
        threadPrefix: "erro",
        emoji: "🛠️",
        description: "Reportar um erro ou bug encontrado.",
        order: 2,
        modalTitle: "Reportar erros",
        modalFields: ticketModalFields.bugs,
      },
      report: {
        name: "Denunciar",
        threadPrefix: "denuncia",
        emoji: "📢",
        description: "Reportar um jogador.",
        order: 3,
        modalTitle: "Denunciar jogador",
        modalFields: ticketModalFields.report,
      },
      appeal: {
        name: "Apelar punicao",
        threadPrefix: "apelacao",
        emoji: "⚖️",
        description: "Solicitar revisao de punicao.",
        order: 4,
        modalTitle: "Apelar punicao",
        modalFields: ticketModalFields.appeal,
      },
      password: {
        name: "Esqueci a minha senha",
        threadPrefix: "senha",
        emoji: "🔐",
        description: "Recuperar senha da conta.",
        order: 5,
        modalTitle: "Recuperacao de senha",
        modalFields: ticketModalFields.password,
      },
      donation: {
        name: "Problemas com doacoes em nosso site",
        threadPrefix: "doacao",
        emoji: "🛒",
        description: "Relatar problemas com doacoes.",
        order: 6,
        modalTitle: "Problemas com doacoes",
        modalFields: ticketModalFields.donation,
      },
      coordination: {
        name: "Falar apenas com a Coordenacao",
        threadPrefix: "coordenacao",
        emoji: "👑",
        description: "Falar diretamente com a coordenacao.",
        order: 7,
        modalTitle: "Falar com a Coordenacao",
        modalFields: ticketModalFields.coordination,
      },
      other: {
        name: "Outro assunto nao listado",
        threadPrefix: "outro",
        emoji: "🔎",
        description: "Abrir um ticket para outro assunto.",
        order: 8,
        modalTitle: "Outro assunto",
        modalFields: ticketModalFields.other,
      },
    },
  },
};

module.exports = config;
