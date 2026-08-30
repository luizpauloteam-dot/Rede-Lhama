const { AttachmentBuilder } = require("discord.js");

const config = require("../config");
const { createLogger } = require("./logger");
const { TicketMessage } = require("./ticket-models");
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
    log.warn(`Canal de transcricao invalido ou inacessivel: ${config.tickets.transcriptChannelId}`);
    return null;
  }

  return channel;
}

function renderAttachment(attachment) {
  const url = escapeHtml(attachment.url);
  const name = escapeHtml(attachment.name || "anexo");
  const isImage = String(attachment.contentType || "").startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(url);

  if (isImage) {
    return `<a href="${url}" target="_blank" rel="noreferrer"><img class="attachment-image" src="${url}" alt="${name}"></a>`;
  }

  return `<a class="attachment-file" href="${url}" target="_blank" rel="noreferrer">${name}</a>`;
}

function getDirectionLabel(direction) {
  if (direction === "user_to_staff") {
    return "Jogador para staff";
  }

  if (direction === "staff_to_user") {
    return "Staff para jogador";
  }

  return "Sistema";
}

function renderMessage(entry) {
  const content = escapeHtml(entry.content || "").replace(/\n/g, "<br>");
  const attachments = (entry.attachments || []).map(renderAttachment).join("");

  return [
    `<article class="message ${escapeHtml(entry.direction)}">`,
    '<div class="message-body">',
    "<header>",
    `<strong>${escapeHtml(entry.authorTag || entry.authorId || "Sistema")}</strong>`,
    `<span>${escapeHtml(getDirectionLabel(entry.direction))}</span>`,
    `<time>${escapeHtml(formatDateTime(entry.createdAt))}</time>`,
    "</header>",
    content ? `<div class="content">${content}</div>` : "",
    attachments ? `<div class="attachments">${attachments}</div>` : "",
    "</div>",
    "</article>",
  ].join("");
}

function renderTranscriptHtml({ ticket, messages }) {
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
    "h1{font-size:26px;margin:0 0 12px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px}",
    ".item{background:#17211e;border:1px solid #2f3d39;border-radius:6px;padding:10px}.label{color:#aab8b3;font-size:12px;text-transform:uppercase;letter-spacing:.04em}",
    ".message{border-bottom:1px solid #24312d;padding:14px 0}.message-body{min-width:0}",
    "header{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}header span,header time{color:#9fb0aa;font-size:13px}",
    ".content{white-space:normal;line-height:1.45;margin-top:5px;word-break:break-word}.attachments{display:flex;flex-direction:column;gap:8px;margin-top:8px}",
    ".attachment-image{max-width:min(520px,100%);border-radius:6px;border:1px solid #33423e}.attachment-file{color:#73d7ff;text-decoration:none}",
    "</style>",
    "</head>",
    "<body>",
    '<main class="wrap">',
    '<section class="summary">',
    `<h1>${escapeHtml(title)}</h1>`,
    '<div class="grid">',
    `<div class="item"><div class="label">Categoria</div>${escapeHtml(categoryConfig.name || ticket.categoryType)}</div>`,
    `<div class="item"><div class="label">Jogador</div>${escapeHtml(ticket.userId || "Nao informado")}</div>`,
    `<div class="item"><div class="label">Atendente</div>${escapeHtml(ticket.assignedStaffId || "Nao informado")}</div>`,
    `<div class="item"><div class="label">Status</div>${escapeHtml(ticket.status)}</div>`,
    `<div class="item"><div class="label">Thread staff</div>${escapeHtml(ticket.staffThreadId || "Nao informado")}</div>`,
    `<div class="item"><div class="label">Aberto em</div>${escapeHtml(formatDateTime(ticket.createdAt))}</div>`,
    `<div class="item"><div class="label">Fechado em</div>${escapeHtml(ticket.closedAt ? formatDateTime(ticket.closedAt) : "Nao informado")}</div>`,
    `<div class="item"><div class="label">Motivo</div>${escapeHtml(ticket.closeReason || "Nao informado")}</div>`,
    "</div>",
    "</section>",
    messages.length ? messages.map(renderMessage).join("") : '<p class="empty">Nenhuma mensagem registrada.</p>',
    "</main>",
    "</body>",
    "</html>",
  ].join("");
}

async function generateAndSendTranscript(client, ticket) {
  const transcriptChannel = await fetchTranscriptChannel(client);
  const messages = await TicketMessage.find({ ticketId: ticket.ticketId }).sort({ createdAt: 1 });
  const html = renderTranscriptHtml({
    ticket,
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
      content: `Transcricao do ticket #${formatTicketNumber(ticket.ticketNumber)}.`,
      files: [attachment],
      allowedMentions: SAFE_ALLOWED_MENTIONS,
    })
    .catch((error) => {
      log.warn(`Nao foi possivel enviar transcricao do ticket ${ticket.ticketId}.`, error);
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
