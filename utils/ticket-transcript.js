const { AttachmentBuilder } = require("discord.js");
const fs = require("fs").promises;
const path = require("path");

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
  const url = escapeHtml(safeMediaUrl(attachment.url));
  if (!url) return "";
  const name = escapeHtml(attachment.name || "anexo");
  const isImage = String(attachment.contentType || "").startsWith("image/") || /\.(png|jpe?g|gif|webp)$/i.test(url);

  if (isImage) {
    return `<a href="${url}" target="_blank" rel="noreferrer"><img class="attachment-image" src="${url}" alt="${name}"></a>`;
  }

  return `<a class="attachment-file" href="${url}" target="_blank" rel="noreferrer">${name}</a>`;
}

function getDirectionLabel(direction) {
  return direction === "channel" ? "Canal do ticket" : "Sistema";
}

function safeMediaUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
  } catch { return ""; }
}

function renderMessage(entry) {
  const content = escapeHtml(entry.content || "").replace(/\n/g, "<br>");
  const attachments = (entry.attachments || []).map(renderAttachment).join("");

  return [
    `<article class="message ${escapeHtml(entry.direction)}">`,
    '<div class="message-body">',
    "<header>",
    entry.avatarUrl ? `<img width="32" height="32" alt="Avatar" src="${escapeHtml(safeMediaUrl(entry.avatarUrl))}">` : "",
    `<strong>${escapeHtml(entry.authorTag || entry.authorId || "Sistema")}</strong>`,
    `<span>${escapeHtml(entry.authorId)}</span>`,
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
    `<div class="item"><div class="label">Jogador</div>${escapeHtml(ticket.ownerId || "Nao informado")}</div>`,
    `<div class="item"><div class="label">Nick</div>${escapeHtml(ticket.minecraftNick || "Nao informado")}</div>`,
    `<div class="item"><div class="label">Atendente</div>${escapeHtml(ticket.assignedStaffId || "Nao informado")}</div>`,
    `<div class="item"><div class="label">Status</div>${escapeHtml(ticket.status)}</div>`,
    `<div class="item"><div class="label">Canal</div>${escapeHtml(ticket.channelId || "Nao informado")}</div>`,
    `<div class="item"><div class="label">Fechado por</div>${escapeHtml(ticket.closedBy || "Nao informado")}</div>`,
    `<div class="item"><div class="label">Aberto em</div>${escapeHtml(formatDateTime(ticket.createdAt))}</div>`,
    `<div class="item"><div class="label">Fechado em</div>${escapeHtml(ticket.closedAt ? formatDateTime(ticket.closedAt) : "Nao informado")}</div>`,
    `<div class="item"><div class="label">Motivo</div>${escapeHtml(ticket.closeReason || "Nao informado")}</div>`,
    "</div>",
    `<div class="content">${escapeHtml(JSON.stringify(Object.fromEntries(ticket.formData instanceof Map ? ticket.formData : Object.entries(ticket.formData || {})), null, 2)).replace(/\n/g, "<br>")}</div>`,
    "</section>",
    messages.length ? messages.map(renderMessage).join("") : '<p class="empty">Nenhuma mensagem registrada.</p>',
    "</main>",
    "</body>",
    "</html>",
  ].join("");
}

async function generateAndSendTranscript(client, ticket) {
  const transcriptChannel = ticket.categoryType === "coordination" ? null : await fetchTranscriptChannel(client);
  const channel = await client.channels.fetch(ticket.channelId);
  if (!channel?.messages || channel.guildId !== ticket.guildId) throw new Error("Canal do ticket indisponível para transcript.");
  const messages = [];
  let before;
  while (true) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (!batch.size) break;
    for (const message of batch.values()) {
      messages.push({
        direction: "channel", authorId: message.author.id, authorTag: message.author.tag,
        avatarUrl: message.author.displayAvatarURL({ size: 128 }), content: message.content,
        attachments: [...message.attachments.values()].map((attachment) => ({
          name: attachment.name, url: attachment.url, contentType: attachment.contentType,
        })), createdAt: message.createdAt, sourceMessageId: message.id,
      });
    }
    before = [...batch.keys()].reduce((a, b) => BigInt(a) < BigInt(b) ? a : b);
  }
  messages.push(...await TicketMessage.find({ ticketId: ticket.ticketId, direction: "system" }).sort({ createdAt: 1 }));
  messages.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const html = renderTranscriptHtml({
    ticket,
    messages,
  });
  const filename = `ticket-${formatTicketNumber(ticket.ticketNumber)}.html`;
  const directory = path.join(config.tickets.dataDir, "transcripts");
  await fs.mkdir(directory, { recursive: true });
  const filePath = path.join(directory, `${ticket.ticketId}.html`);
  await fs.writeFile(filePath, html, "utf8");
  ticket.transcriptPath = filePath;
  await ticket.save();
  const attachment = new AttachmentBuilder(Buffer.from(html, "utf8"), {
    name: filename,
  });

  if (!transcriptChannel) {
    return {
      filename,
      filePath,
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
    filePath,
    messageId: message?.id || "",
  };
}

module.exports = {
  generateAndSendTranscript,
  renderTranscriptHtml,
};
