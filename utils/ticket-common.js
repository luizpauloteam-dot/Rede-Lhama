const config = require("../config");

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



function buildTicketChannelName(ticket, user) {
  const category = getTicketCategoryConfig(ticket.categoryType);
  const type = normalizeDiscordName(category?.categoryName || ticket.categoryType) || "ticket";
  const username = normalizeDiscordName(user?.username) || ticket.ownerId;
  return `${type}-${username}`.slice(0, 100).replace(/-+$/g, "");
}

module.exports = {
  buildTicketChannelName,
  escapeDiscordText,
  escapeHtml,
  formatDateTime,
  formatTicketNumber,
  getTicketCategoryConfig,
  listTicketCategoryEntries,
  normalizeDiscordName,
  resolveWaitLevel,
};
