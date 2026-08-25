const { AttachmentBuilder } = require("discord.js");

const config = require("../config");
const { createLogger } = require("./logger");
const {
  escapeHtml,
  formatDateTime,
  formatTicketNumber,
  getTicketCategoryConfig,
} = require("./ticket-common");

const log = createLogger("ticket-transcript");
const SAFE_ALLOWED_MENTIONS = {
  parse: [],
  repliedUser: false,
};

async function fetchTranscriptChannel(client) {
  if (!config.tickets.transcriptChannelId) {
    return null;
  }

  const channel =
    client.channels.cache.get(config.tickets.transcriptChannelId) ||
    (await client.channels.fetch(config.tickets.transcriptChannelId).catch(() => null));

  if (!channel?.isTextBased?.() || typeof channel.send !== "function") {
    log.warn(`Canal de transcript invalido ou inacessivel: ${config.tickets.transcriptChannelId}`);
    return null;
  }

  return channel;
}

async function fetchAllMessages(channel) {
  const messages = [];
  let before;

  for (;;) {
    const batch = await channel.messages
      .fetch({
        limit: 100,
        before,
      })
      .catch((error) => {
        log.warn(`Nao foi possivel buscar mensagens do canal ${channel.id}.`, error);
        return null;
      });

    if (!batch?.size) {
      break;
    }

    messages.push(...batch.values());
    before = batch.last().id;

    if (batch.size < 100) {
      break;
    }
  }

  return messages.sort((left, right) => left.createdTimestamp - right.createdTimestamp);
}

function isImageAttachment(attachment) {
  if (String(attachment.contentType || "").startsWith("image/")) {
    return true;
  }

  return /\.(png|jpe?g|gif|webp)$/i.test(String(attachment.url || ""));
}

function renderAttachment(attachment) {
  const url = escapeHtml(attachment.url);
  const name = escapeHtml(attachment.name || "anexo");

  if (isImageAttachment(attachment)) {
    return `<a href="${url}" target="_blank" rel="noreferrer"><img class="attachment-image" src="${url}" alt="${name}"></a>`;
  }

  return `<a class="attachment-file" href="${url}" target="_blank" rel="noreferrer">${name}</a>`;
}

function renderMessage(message) {
  const author = message.author;
  const avatarUrl = author.displayAvatarURL?.({ extension: "png", size: 64 }) || "";
  const content = escapeHtml(message.cleanContent || message.content || "").replace(/\n/g, "<br>");
  const attachments = [...message.attachments.values()].map(renderAttachment).join("");
  const reply = message.reference?.messageId
    ? `<div class="reply">Resposta para mensagem ${escapeHtml(message.reference.messageId)}</div>`
    : "";

  return [
    '<article class="message">',
    `<img class="avatar" src="${escapeHtml(avatarUrl)}" alt="">`,
    '<div class="message-body">',
    `<header><strong>${escapeHtml(author.tag || author.username)}</strong><span>${escapeHtml(formatDateTime(message.createdAt))}</span></header>`,
    reply,
    content ? `<div class="content">${content}</div>` : "",
    attachments ? `<div class="attachments">${attachments}</div>` : "",
    "</div>",
    "</article>",
  ].join("");
}

function renderTranscriptHtml({ ticket, channel, messages }) {
  const categoryConfig = getTicketCategoryConfig(ticket.categoryType) || {};
  const title = `Ticket #${formatTicketNumber(ticket.ticketNumber)}`;

  return [
    "<!doctype html>",
    '<html lang="pt-BR">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    "<style>",
    "body{margin:0;background:#111816;color:#ecf4f1;font-family:Inter,Segoe UI,Arial,sans-serif;}",
    ".wrap{max-width:980px;margin:0 auto;padding:32px 18px 56px;}",
    ".summary{border-left:5px solid #00d1b2;background:#1f2926;border-radius:8px;padding:18px;margin-bottom:18px;}",
    "h1{font-size:26px;margin:0 0 12px;} .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;}",
    ".item{background:#17211e;border:1px solid #2f3d39;border-radius:6px;padding:10px;} .label{color:#aab8b3;font-size:12px;text-transform:uppercase;letter-spacing:.04em;}",
    ".message{display:flex;gap:12px;border-bottom:1px solid #24312d;padding:14px 0;}",
    ".avatar{width:42px;height:42px;border-radius:50%;background:#2a3531;flex:0 0 auto;}",
    ".message-body{min-width:0;flex:1;} header{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;} header span{color:#9fb0aa;font-size:13px;}",
    ".content{white-space:normal;line-height:1.45;margin-top:5px;word-break:break-word;} .reply{color:#9fb0aa;font-size:13px;margin-top:4px;}",
    ".attachments{display:flex;flex-direction:column;gap:8px;margin-top:8px;} .attachment-image{max-width:min(520px,100%);border-radius:6px;border:1px solid #33423e;}",
    ".attachment-file{color:#73d7ff;text-decoration:none;}",
    "</style>",
    "</head>",
    "<body>",
    '<main class="wrap">',
    '<section class="summary">',
    `<h1>${escapeHtml(title)}</h1>`,
    '<div class="grid">',
    `<div class="item"><div class="label">Canal</div>${escapeHtml(channel.name)}</div>`,
    `<div class="item"><div class="label">Categoria</div>${escapeHtml(categoryConfig.name || ticket.categoryType)}</div>`,
    `<div class="item"><div class="label">Aberto por</div>${escapeHtml(ticket.ownerId)}</div>`,
    `<div class="item"><div class="label">Atendente</div>${escapeHtml(ticket.assignedStaffId || "Nao informado")}</div>`,
    `<div class="item"><div class="label">Aberto em</div>${escapeHtml(formatDateTime(ticket.createdAt))}</div>`,
    `<div class="item"><div class="label">Fechado em</div>${escapeHtml(ticket.closedAt ? formatDateTime(ticket.closedAt) : "Nao informado")}</div>`,
    `<div class="item"><div class="label">Fechado por</div>${escapeHtml(ticket.closedBy || "Nao informado")}</div>`,
    `<div class="item"><div class="label">Motivo</div>${escapeHtml(ticket.closeReason || "Nao informado")}</div>`,
    "</div>",
    "</section>",
    messages.map(renderMessage).join(""),
    "</main>",
    "</body>",
    "</html>",
  ].join("");
}

async function generateAndSendTranscript(client, channel, ticket) {
  const transcriptChannel = await fetchTranscriptChannel(client);
  const messages = await fetchAllMessages(channel);
  const html = renderTranscriptHtml({
    ticket,
    channel,
    messages,
  });
  const filename = `ticket-${formatTicketNumber(ticket.ticketNumber)}.html`;
  const attachment = new AttachmentBuilder(Buffer.from(html, "utf8"), {
    name: filename,
  });

  if (!transcriptChannel) {
    return {
      filename,
      messageId: "",
    };
  }

  const message = await transcriptChannel
    .send({
      content: `Transcript do ticket #${formatTicketNumber(ticket.ticketNumber)}.`,
      files: [attachment],
      allowedMentions: SAFE_ALLOWED_MENTIONS,
    })
    .catch((error) => {
      log.warn(`Nao foi possivel enviar transcript do ticket ${ticket.ticketId}.`, error);
      return null;
    });

  return {
    filename,
    messageId: message?.id || "",
  };
}

module.exports = {
  generateAndSendTranscript,
};
