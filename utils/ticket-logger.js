const config = require("../config");
const { createLogger } = require("./logger");
const { TicketLog } = require("./ticket-models");
const { formatTicketNumber } = require("./ticket-common");

const log = createLogger("ticket-log");
const SAFE_ALLOWED_MENTIONS = {
  parse: [],
  repliedUser: false,
};

function compactMetadata(metadata) {
  return Object.entries(metadata || {})
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .reduce((result, [key, value]) => {
      result[key] = value;
      return result;
    }, {});
}

function formatLogLine({ action, ticket, executorId, targetId, metadata }) {
  const parts = [`**${action}**`];

  if (ticket?.ticketNumber) {
    parts.push(`Ticket #${formatTicketNumber(ticket.ticketNumber)}`);
  }

  if (executorId) {
    parts.push(`Executor: <@${executorId}>`);
  }

  if (targetId) {
    parts.push(`Alvo: <@${targetId}>`);
  }

  const cleanMetadata = compactMetadata(metadata);
  const metadataText = Object.entries(cleanMetadata)
    .slice(0, 8)
    .map(([key, value]) => `${key}: ${String(value).slice(0, 300)}`)
    .join(" | ");

  if (metadataText) {
    parts.push(metadataText);
  }

  return parts.join("\n");
}

async function sendDiscordLog(client, guildId, payload) {
  const channelId = config.tickets.logChannelId;
  if (!client || !guildId || !channelId) {
    return;
  }

  const channel =
    client.channels.cache.get(channelId) ||
    (await client.channels.fetch(channelId).catch(() => null));

  if (!channel?.isTextBased?.() || typeof channel.send !== "function") {
    return;
  }

  await channel
    .send({
      content: formatLogLine(payload),
      allowedMentions: SAFE_ALLOWED_MENTIONS,
    })
    .catch((error) => {
      log.warn("Nao foi possivel enviar log de ticket no Discord.", error);
    });
}

async function logTicketAction(client, payload) {
  const metadata = compactMetadata(payload.metadata);

  await TicketLog.create({
    ticketId: payload.ticket?.ticketId || payload.ticketId || "",
    guildId: payload.guildId || payload.ticket?.guildId,
    action: payload.action,
    executorId: payload.executorId || "",
    targetId: payload.targetId || "",
    metadata,
  });

  await sendDiscordLog(client, payload.guildId || payload.ticket?.guildId, {
    ...payload,
    metadata,
  });
}

module.exports = {
  logTicketAction,
};
