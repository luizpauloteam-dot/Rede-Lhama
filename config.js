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

const ticketModalFields = {
  doubts: [
    { id: "minecraftNick", label: "Nick no Minecraft", style: "short", minLength: 3, maxLength: 32, required: true },
    { id: "question", label: "Sua duvida", style: "paragraph", minLength: 5, maxLength: 700, required: true },
    { id: "details", label: "Detalhes", style: "paragraph", maxLength: 900, required: false },
  ],
  bugs: [
    { id: "minecraftNick", label: "Nick", style: "short", minLength: 3, maxLength: 32, required: true },
    { id: "bug", label: "Bug encontrado", style: "paragraph", minLength: 5, maxLength: 700, required: true },
    { id: "howItHappened", label: "Como ocorreu", style: "paragraph", minLength: 5, maxLength: 700, required: true },
    { id: "reproduce", label: "Como reproduzir", style: "paragraph", maxLength: 900, required: false },
    { id: "serverVersion", label: "Versao/servidor", style: "short", maxLength: 80, required: false },
  ],
  report: [
    { id: "minecraftNick", label: "Seu nick", style: "short", minLength: 3, maxLength: 32, required: true },
    { id: "reportedNick", label: "Nick denunciado", style: "short", minLength: 3, maxLength: 32, required: true },
    { id: "reason", label: "Motivo", style: "short", minLength: 3, maxLength: 120, required: true },
    { id: "description", label: "Descricao", style: "paragraph", minLength: 10, maxLength: 900, required: true },
    { id: "proof", label: "Provas", style: "paragraph", maxLength: 900, required: false },
  ],
  appeal: [
    { id: "minecraftNick", label: "Nick", style: "short", minLength: 3, maxLength: 32, required: true },
    { id: "punishment", label: "Punicao", style: "short", minLength: 3, maxLength: 120, required: true },
    { id: "reason", label: "Motivo da apelacao", style: "paragraph", minLength: 10, maxLength: 900, required: true },
    { id: "proof", label: "Provas", style: "paragraph", maxLength: 900, required: false },
  ],
  password: [
    { id: "minecraftNick", label: "Nick", style: "short", minLength: 3, maxLength: 32, required: true },
    { id: "accountInfo", label: "Informacoes necessarias", style: "paragraph", minLength: 10, maxLength: 900, required: true },
    { id: "description", label: "Descricao do problema", style: "paragraph", minLength: 10, maxLength: 900, required: true },
  ],
  donation: [
    { id: "minecraftNick", label: "Nick", style: "short", minLength: 3, maxLength: 32, required: true },
    { id: "product", label: "Produto", style: "short", minLength: 2, maxLength: 120, required: true },
    { id: "date", label: "Data", style: "short", maxLength: 80, required: true },
    { id: "paymentMethod", label: "Forma de pagamento", style: "short", maxLength: 120, required: true },
    { id: "problem", label: "Problema", style: "paragraph", minLength: 10, maxLength: 900, required: true },
  ],
  coordination: [
    { id: "minecraftNick", label: "Nick", style: "short", minLength: 3, maxLength: 32, required: true },
    { id: "subject", label: "Assunto", style: "short", minLength: 3, maxLength: 120, required: true },
    { id: "description", label: "Descricao", style: "paragraph", minLength: 10, maxLength: 900, required: true },
  ],
  other: [
    { id: "minecraftNick", label: "Nick", style: "short", minLength: 3, maxLength: 32, required: true },
    { id: "subject", label: "Assunto", style: "short", minLength: 3, maxLength: 120, required: true },
    { id: "description", label: "Descricao", style: "paragraph", minLength: 10, maxLength: 900, required: true },
  ],
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
  tickets: {
    enabled: parseBoolean(process.env.TICKETS_ENABLED, true),
    dataDir: ticketDataDir,
    panelMessageFilePath: resolveLocalPath(
      process.env.TICKET_PANEL_MESSAGE_FILE,
      path.join(ticketDataDir, "panel-message.json"),
    ),
    panelChannelId: String(process.env.DISCORD_TICKET_PANEL_CHANNEL_ID || "").trim(),
    categoryAnchorId: "1541597285115371570",
    closedCategoryId: "1541646616778514512",
    maxTicketsPerUser: parsePositiveInteger(process.env.TICKET_MAX_TICKETS_PER_USER, 1, 1),
    openCooldownSeconds: parseNonNegativeInteger(process.env.TICKET_OPEN_COOLDOWN_SECONDS, 30),
    callCooldownMs: parsePositiveInteger(process.env.TICKET_CALL_COOLDOWN_MS, 300000, 60000),
    maxChannelsPerCategory: parsePositiveInteger(process.env.TICKET_MAX_CHANNELS_PER_CATEGORY, 50, 1),
    autoCreateCategories: parseBoolean(process.env.TICKET_AUTO_CREATE_CATEGORIES, true),
    autoDeleteEmptyCategories: parseBoolean(process.env.TICKET_AUTO_DELETE_EMPTY_CATEGORIES, true),
    supportRoles: parseList(process.env.DISCORD_TICKET_SUPPORT_ROLE_IDS),
    coordinationRoles: parseList(process.env.DISCORD_TICKET_COORDINATION_ROLE_IDS),
    administratorRoles: parseList(process.env.DISCORD_TICKET_ADMINISTRATOR_ROLE_IDS),
    logChannelId: String(process.env.DISCORD_TICKET_LOG_CHANNEL_ID || process.env.DISCORD_LOG_CHANNEL_ID || "").trim(),
    transcriptChannelId: String(process.env.DISCORD_TICKET_TRANSCRIPT_CHANNEL_ID || "").trim(),
    reviewChannelId: String(process.env.DISCORD_TICKET_REVIEW_CHANNEL_ID || "").trim(),
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
        name: "Tirar dúvidas",
        discordCategoryName: "📂・DÚVIDAS",
        emoji: "🤔",
        description: "Obter esclarecimento sobre quaisquer dúvidas.",
        order: 1,
        modalTitle: "Tirar dúvidas",
        modalFields: ticketModalFields.doubts,
      },
      bugs: {
        name: "Reportar erros",
        discordCategoryName: "📂・REPORTAR-ERROS",
        emoji: "🛠️",
        description: "Reportar um erro/bug encontrado.",
        order: 2,
        modalTitle: "Reportar erros",
        modalFields: ticketModalFields.bugs,
      },
      report: {
        name: "Denunciar",
        discordCategoryName: "📂・DENÚNCIAS",
        emoji: "📢",
        description: "Reportar um(a) jogador(a).",
        order: 3,
        modalTitle: "Denunciar jogador",
        modalFields: ticketModalFields.report,
      },
      appeal: {
        name: "Apelar punição",
        discordCategoryName: "📂・APELAÇÕES",
        emoji: "⚖️",
        description: "Apele uma punição.",
        order: 4,
        modalTitle: "Apelar punição",
        modalFields: ticketModalFields.appeal,
      },
      password: {
        name: "Esqueci a minha senha",
        discordCategoryName: "📂・RECUPERAÇÃO",
        emoji: "🔐",
        description: "Recuperar senha da conta.",
        order: 5,
        modalTitle: "Recuperação de senha",
        modalFields: ticketModalFields.password,
      },
      donation: {
        name: "Problemas com doações em nosso site",
        discordCategoryName: "📂・DOAÇÕES",
        emoji: "🛒",
        description: "Relatar problemas com doações.",
        order: 6,
        modalTitle: "Problemas com doações",
        modalFields: ticketModalFields.donation,
      },
      coordination: {
        name: "Falar apenas com a Coordenação",
        discordCategoryName: "📂・COORDENAÇÃO",
        emoji: "👑",
        description: "Falar diretamente com a coordenação do servidor.",
        order: 7,
        modalTitle: "Falar com a Coordenação",
        modalFields: ticketModalFields.coordination,
      },
      other: {
        name: "Outro assunto não listado",
        discordCategoryName: "📂・OUTROS",
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
