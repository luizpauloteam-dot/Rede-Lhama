const config = require("../config");

const STAFF_CHANNEL_NAME_PREFIX = "📒・";
const MAX_DISCORD_CHANNEL_NAME_LENGTH = 100;

function escapeDiscordText(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/([`*_~|>])/g, "\\$1")
    .trim();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatTicketNumber(ticketNumber) {
  return String(ticketNumber || 0).padStart(4, "0");
}

function formatDateTime(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(date);
}

function getTicketCategoryConfig(categoryType) {
  return config.tickets.categories[categoryType] || null;
}

function listTicketCategoryEntries() {
  return Object.entries(config.tickets.categories)
    .map(([type, category]) => ({
      type,
      ...category,
    }))
    .sort((left, right) => left.order - right.order);
}

function resolveWaitLevel(openTicketCount) {
  const count = Number(openTicketCount || 0);
  const thresholds = config.tickets.waitThresholds;

  if (count <= thresholds.lowMax) {
    return "baixo";
  }

  if (count <= thresholds.moderateMax) {
    return "moderado";
  }

  if (count <= thresholds.highMax) {
    return "alto";
  }

  return "muito alto";
}

function normalizeDiscordName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 90);
}

function fitStaffChannelName(categoryName, userName) {
  const baseName = `${STAFF_CHANNEL_NAME_PREFIX}${categoryName || "ticket"}-`;
  const maxUserNameLength = Math.max(1, MAX_DISCORD_CHANNEL_NAME_LENGTH - baseName.length);
  const fittedUserName = String(userName || "usuario").slice(0, maxUserNameLength).replace(/-+$/g, "");

  return `${baseName}${fittedUserName || "usuario"}`;
}

function buildStaffChannelName(ticket, user = null) {
  const categoryConfig = getTicketCategoryConfig(ticket.categoryType) || {};
  const categoryName = normalizeDiscordName(categoryConfig.staffChannelPrefix || categoryConfig.name || ticket.categoryType);
  const userName = normalizeDiscordName(user?.username || user?.globalName || ticket.userId || "usuario");

  return fitStaffChannelName(categoryName, userName);
}

module.exports = {
  buildStaffChannelName,
  escapeDiscordText,
  escapeHtml,
  formatDateTime,
  formatTicketNumber,
  getTicketCategoryConfig,
  listTicketCategoryEntries,
  normalizeDiscordName,
  resolveWaitLevel,
};
