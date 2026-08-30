const fs = require("fs").promises;
const path = require("path");

const {
  ChannelType,
  MessageFlags,
  ThreadAutoArchiveDuration,
} = require("discord.js");

const config = require("../config");
const { createLogger } = require("./logger");
const {
  ACTIVE_TICKET_STATUSES,
  MODMAIL_SYSTEM_VERSION,
  Ticket,
  TicketBlacklist,
  TicketCounter,
  TicketLog,
  TicketMessage,
  TicketReview,
  ensureTicketIndexes,
} = require("./ticket-models");
const {
  TICKET_CUSTOM_IDS,
  buildCategoryModal,
  buildCloseConfirmComponents,
  buildDmWelcomeComponents,
  buildReviewModal,
  buildStaffThreadComponents,
  buildSupportPanelComponents,
  buildTicketArchivedComponents,
  buildTicketClosedComponents,
  buildTicketManageComponents,
  buildTicketReviewComponents,
  buildUserSelectRow,
  getStatusLabel,
} = require("./ticket-components");
const {
  buildTicketThreadName,
  escapeDiscordText,
  formatTicketNumber,
  getTicketCategoryConfig,
} = require("./ticket-common");
const { logTicketAction } = require("./ticket-logger");
const { generateAndSendTranscript } = require("./ticket-transcript");
const {
  isTicketAdministrator,
  isTicketSupport,
} = require("./ticket-permissions");

const log = createLogger("tickets");
const SAFE_ALLOWED_MENTIONS = {
  parse: [],
  repliedUser: false,
};
const MAX_RELAY_CONTENT_LENGTH = 1850;

async function ensureParentDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function readPanelState() {
  try {
    const content = await fs.readFile(config.tickets.panelMessageFilePath, "utf8");
    return JSON.parse(content);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }

    log.warn("Nao foi possivel ler o estado do painel de tickets.", error);
    return null;
  }
}

async function writePanelState(state) {
  await ensureParentDir(config.tickets.panelMessageFilePath);
  await fs.writeFile(config.tickets.panelMessageFilePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

async function replyEphemeral(interaction, content, extraPayload = {}) {
  const payload = {
    content,
    allowedMentions: SAFE_ALLOWED_MENTIONS,
    ...extraPayload,
  };

  if (interaction.guildId && payload.flags === undefined) {
    payload.flags = MessageFlags.Ephemeral;
  }

  if (interaction.deferred && !interaction.replied) {
    const { flags, ...editPayload } = payload;
    await interaction.editReply(editPayload).catch(() => null);
    return;
  }

  if (interaction.replied || interaction.deferred) {
    await interaction.followUp(payload).catch(() => null);
    return;
  }

  await interaction.reply(payload).catch(() => null);
}

async function replyComponentsV2Ephemeral(interaction, components) {
  await replyEphemeral(interaction, null, {
    flags: interaction.guildId
      ? MessageFlags.Ephemeral | MessageFlags.IsComponentsV2
      : MessageFlags.IsComponentsV2,
    components,
  });
}

function isDuplicateKeyError(error) {
  return error?.code === 11000;
}

function parseReviewRating(rating) {
  const value = Number.parseInt(rating, 10);
  return Number.isInteger(value) && value >= 1 && value <= 5 ? value : null;
}

function getTicketGuildId() {
  return config.tickets.guildId;
}

function buildTicketScopeQuery(extraQuery = {}) {
  return {
    guildId: getTicketGuildId(),
    systemVersion: MODMAIL_SYSTEM_VERSION,
    ...extraQuery,
  };
}

async function getOpenTicketCount() {
  return Ticket.countDocuments(
    buildTicketScopeQuery({
      status: {
        $in: ACTIVE_TICKET_STATUSES,
      },
    }),
  );
}

async function findActiveTicketByUser(userId) {
  return Ticket.findOne(
    buildTicketScopeQuery({
      userId,
      status: {
        $in: ACTIVE_TICKET_STATUSES,
      },
    }),
  ).sort({ createdAt: -1 });
}

async function findTicketByThread(threadId) {
  return Ticket.findOne(
    buildTicketScopeQuery({
      staffThreadId: threadId,
    }),
  ).sort({ createdAt: -1 });
}

async function isBlacklisted(userId) {
  const now = new Date();
  return TicketBlacklist.findOne({
    guildId: getTicketGuildId(),
    userId,
    $or: [
      { permanent: true },
      {
        expiresAt: {
          $gt: now,
        },
      },
    ],
  });
}

async function isOnOpenCooldown(userId) {
  if (!config.tickets.openCooldownSeconds) {
    return false;
  }

  const createdAfter = new Date(Date.now() - config.tickets.openCooldownSeconds * 1000);
  return TicketLog.exists({
    guildId: getTicketGuildId(),
    action: "TICKET_CREATE",
    executorId: userId,
    createdAt: {
      $gte: createdAfter,
    },
  });
}

async function nextTicketNumber() {
  const counter = await TicketCounter.findOneAndUpdate(
    { guildId: getTicketGuildId() },
    { $inc: { seq: 1 } },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    },
  );

  return counter.seq;
}

function extractFormData(interaction, categoryConfig) {
  const values = {};

  for (const field of categoryConfig.modalFields || []) {
    const value = String(interaction.fields.getTextInputValue(field.id) || "").trim();
    if (field.required && !value) {
      throw new Error(`O campo "${field.label}" e obrigatorio.`);
    }

    values[field.id] = value;
  }

  return values;
}

function formDataToText(ticket, categoryConfig) {
  const formData = ticket.formData || {};
  const getValue = (key) => (typeof formData.get === "function" ? formData.get(key) : formData[key]);

  return (categoryConfig.modalFields || [])
    .map((field) => {
      const value = String(getValue(field.id) || "").trim();
      return value ? `${field.label}: ${value}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

function isSendableTextChannel(channel) {
  return Boolean(channel?.isTextBased?.() && typeof channel.send === "function");
}

async function resolveStaffGuild(client) {
  const guildId = getTicketGuildId();
  const guild = client.guilds.cache.get(guildId) || (await client.guilds.fetch(guildId).catch(() => null));

  if (!guild) {
    const error = new Error(`Servidor de atendimento nao encontrado: ${guildId}`);
    error.code = "TICKET_GUILD_NOT_FOUND";
    throw error;
  }

  return guild;
}

async function resolveStaffForumChannel(client) {
  if (!config.tickets.staffForumChannelId) {
    const error = new Error("DISCORD_TICKET_STAFF_FORUM_CHANNEL_ID nao configurado.");
    error.code = "TICKET_FORUM_NOT_CONFIGURED";
    throw error;
  }

  const guild = await resolveStaffGuild(client);
  const channel =
    guild.channels.cache.get(config.tickets.staffForumChannelId) ||
    (await guild.channels.fetch(config.tickets.staffForumChannelId).catch(() => null));

  if (channel?.type !== ChannelType.GuildForum || channel.guildId !== guild.id) {
    const error = new Error(`Forum de atendimento invalido: ${config.tickets.staffForumChannelId}`);
    error.code = "TICKET_FORUM_INVALID";
    throw error;
  }

  return channel;
}

async function fetchTicketThread(client, ticket) {
  if (!ticket?.staffThreadId) {
    return null;
  }

  const channel =
    client.channels.cache.get(ticket.staffThreadId) ||
    (await client.channels.fetch(ticket.staffThreadId).catch(() => null));

  if (!channel?.isThread?.() || channel.guildId !== ticket.guildId) {
    return null;
  }

  return channel;
}

async function ensureThreadWritable(thread) {
  if (!thread?.isThread?.()) {
    return;
  }

  if (thread.archived) {
    await thread.setArchived(false, "Ticket ativo recebeu nova mensagem.").catch((error) => {
      log.warn(`Nao foi possivel desarquivar a thread ${thread.id}.`, error);
    });
  }

  if (thread.locked) {
    await thread.setLocked(false, "Ticket ativo recebeu nova mensagem.").catch((error) => {
      log.warn(`Nao foi possivel destrancar a thread ${thread.id}.`, error);
    });
  }
}

async function lockThread(thread, reason) {
  if (!thread?.isThread?.()) {
    return;
  }

  await thread.setLocked(true, reason).catch((error) => {
    log.warn(`Nao foi possivel trancar a thread ${thread.id}.`, error);
  });
}

async function refreshStaffThreadPanel(client, ticket) {
  const thread = await fetchTicketThread(client, ticket);
  if (!thread) {
    return null;
  }

  const components = ticket.status === "closed"
    ? buildTicketArchivedComponents(ticket)
    : buildStaffThreadComponents(ticket);

  if (ticket.staffControlMessageId) {
    const message = await thread.messages.fetch(ticket.staffControlMessageId).catch(() => null);
    if (message) {
      await message
        .edit({
          content: null,
          flags: MessageFlags.IsComponentsV2,
          components,
          allowedMentions: SAFE_ALLOWED_MENTIONS,
        })
        .catch((error) => {
          log.warn(`Nao foi possivel atualizar painel do ticket ${ticket.ticketId}.`, error);
        });
      return message;
    }
  }

  const message = await thread
    .send({
      flags: MessageFlags.IsComponentsV2,
      components,
      allowedMentions: SAFE_ALLOWED_MENTIONS,
    })
    .catch((error) => {
      log.warn(`Nao foi possivel recriar painel do ticket ${ticket.ticketId}.`, error);
      return null;
    });

  if (message) {
    ticket.staffControlMessageId = message.id;
    await ticket.save();
  }

  return message;
}

async function fetchPanelChannel(client, preferredChannel = null) {
  if (isSendableTextChannel(preferredChannel)) {
    return preferredChannel;
  }

  if (!config.tickets.panelChannelId) {
    return null;
  }

  const channel =
    client.channels.cache.get(config.tickets.panelChannelId) ||
    (await client.channels.fetch(config.tickets.panelChannelId).catch(() => null));

  if (!isSendableTextChannel(channel)) {
    log.warn(`Canal de painel de tickets invalido ou inacessivel: ${config.tickets.panelChannelId}`);
    return null;
  }

  return channel;
}

async function fetchStoredPanelMessage(channel, client) {
  const state = await readPanelState();
  if (!state?.messageId || state.channelId !== channel.id) {
    return null;
  }

  const message = await channel.messages.fetch(state.messageId).catch(() => null);
  if (!message || message.author?.id !== client.user.id) {
    return null;
  }

  return message;
}

async function upsertSupportPanel(client, preferredChannel = null) {
  if (!config.tickets.enabled) {
    return null;
  }

  const channel = await fetchPanelChannel(client, preferredChannel);
  if (!channel) {
    return null;
  }

  const openTicketCount = await getOpenTicketCount();
  const components = buildSupportPanelComponents({ openTicketCount });
  const existingMessage = await fetchStoredPanelMessage(channel, client);

  if (existingMessage) {
    await existingMessage
      .edit({
        content: null,
        flags: MessageFlags.IsComponentsV2,
        components,
        allowedMentions: SAFE_ALLOWED_MENTIONS,
      })
      .catch(async (error) => {
        log.warn("Nao foi possivel atualizar o painel de tickets salvo. Vou enviar um novo.", error);
        const message = await channel.send({
          flags: MessageFlags.IsComponentsV2,
          components,
          allowedMentions: SAFE_ALLOWED_MENTIONS,
        });
        await writePanelState({ channelId: channel.id, messageId: message.id });
      });

    return existingMessage;
  }

  const message = await channel.send({
    flags: MessageFlags.IsComponentsV2,
    components,
    allowedMentions: SAFE_ALLOWED_MENTIONS,
  });
  await writePanelState({ channelId: channel.id, messageId: message.id });
  log.info(`Painel de tickets enviado em ${channel.id}.`);
  return message;
}

async function refreshSupportPanel(client) {
  await upsertSupportPanel(client).catch((error) => {
    log.warn("Nao foi possivel atualizar painel principal de tickets.", error);
  });
}

async function resetSupportPanelSelect(interaction) {
  if (!interaction.message?.editable) {
    return;
  }

  const openTicketCount = await getOpenTicketCount();
  await interaction.message
    .edit({
      content: null,
      flags: MessageFlags.IsComponentsV2,
      components: buildSupportPanelComponents({ openTicketCount }),
      allowedMentions: SAFE_ALLOWED_MENTIONS,
    })
    .catch((error) => {
      log.warn("Nao foi possivel resetar o select do painel de tickets.", error);
    });
}

async function sendExistingTicketReply(interaction, ticket) {
  await replyEphemeral(
    interaction,
    `Voce ja possui o ticket #${formatTicketNumber(ticket.ticketNumber)} em aberto. Continue o atendimento pela DM do bot.`,
  );
}

async function validateBeforeOpening(interaction) {
  if (!interaction.guild) {
    await replyEphemeral(interaction, "Use este painel dentro do servidor do Discord.");
    return false;
  }

  const blacklistEntry = await isBlacklisted(interaction.user.id);
  if (blacklistEntry) {
    await replyEphemeral(interaction, "Voce nao possui permissao para abrir tickets.");
    return false;
  }

  const activeTicket = await findActiveTicketByUser(interaction.user.id);
  if (activeTicket) {
    await sendExistingTicketReply(interaction, activeTicket);
    return false;
  }

  if (await isOnOpenCooldown(interaction.user.id)) {
    await replyEphemeral(interaction, "Aguarde alguns segundos antes de abrir outro atendimento.");
    return false;
  }

  return true;
}

async function handlePanelSelect(interaction) {
  if (interaction.customId !== TICKET_CUSTOM_IDS.panelSelect) {
    return false;
  }

  const categoryType = interaction.values?.[0];
  if (!getTicketCategoryConfig(categoryType)) {
    await replyEphemeral(interaction, "Categoria de atendimento invalida.");
    await resetSupportPanelSelect(interaction);
    return true;
  }

  if (!(await validateBeforeOpening(interaction))) {
    await resetSupportPanelSelect(interaction);
    return true;
  }

  await interaction.showModal(buildCategoryModal(categoryType));
  await resetSupportPanelSelect(interaction);
  return true;
}

async function reserveTicket(interaction, categoryType, formData) {
  const activeTickets = await Ticket.countDocuments(
    buildTicketScopeQuery({
      userId: interaction.user.id,
      status: {
        $in: ACTIVE_TICKET_STATUSES,
      },
    }),
  );

  if (activeTickets >= config.tickets.maxActiveTicketsPerUser) {
    const activeTicket = await findActiveTicketByUser(interaction.user.id);
    const error = new Error("MAX_ACTIVE_TICKETS");
    error.activeTicket = activeTicket;
    throw error;
  }

  const ticketNumber = await nextTicketNumber();

  return Ticket.create({
    guildId: getTicketGuildId(),
    originGuildId: interaction.guildId || "",
    userId: interaction.user.id,
    categoryType,
    ticketNumber,
    minecraftNick: formData.minecraftNick || "",
    formData,
    status: "open",
    systemVersion: MODMAIL_SYSTEM_VERSION,
  });
}

async function createStaffThread(client, forumChannel, ticket, user) {
  const thread = await forumChannel.threads.create({
    name: buildTicketThreadName(ticket, user),
    autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
    message: {
      flags: MessageFlags.IsComponentsV2,
      components: buildStaffThreadComponents(ticket),
      allowedMentions: SAFE_ALLOWED_MENTIONS,
    },
    reason: `Ticket #${formatTicketNumber(ticket.ticketNumber)} aberto por ${user.tag || user.id}.`,
  });

  ticket.staffForumChannelId = forumChannel.id;
  ticket.staffThreadId = thread.id;
  ticket.staffControlMessageId = thread.id;
  await ticket.save();
  return thread;
}

async function sendTicketOpenedDm(user, ticket) {
  return user
    .send({
      flags: MessageFlags.IsComponentsV2,
      components: buildDmWelcomeComponents(ticket),
      allowedMentions: SAFE_ALLOWED_MENTIONS,
    })
    .catch((error) => {
      log.warn(`Nao foi possivel enviar DM de abertura do ticket ${ticket.ticketId}.`, error);
      return null;
    });
}

async function recordTicketMessage(ticket, payload) {
  return TicketMessage.create({
    ticketId: ticket.ticketId,
    guildId: ticket.guildId,
    direction: payload.direction,
    authorId: payload.authorId || "",
    authorTag: payload.authorTag || "",
    content: payload.content || "",
    attachments: payload.attachments || [],
    sourceMessageId: payload.sourceMessageId || "",
    sourceChannelId: payload.sourceChannelId || "",
    targetMessageId: payload.targetMessageId || "",
    targetChannelId: payload.targetChannelId || "",
    delivered: payload.delivered !== false,
    createdAt: payload.createdAt || new Date(),
  }).catch((error) => {
    if (!isDuplicateKeyError(error)) {
      throw error;
    }

    return null;
  });
}

async function recordSystemMessage(ticket, content, authorId = "") {
  return recordTicketMessage(ticket, {
    direction: "system",
    authorId,
    authorTag: "Sistema",
    content,
  });
}

async function closeTicketAfterDmFailure(client, ticket, thread) {
  ticket.status = "closed";
  ticket.closedAt = new Date();
  ticket.closedBy = client.user?.id || "";
  ticket.closeReason = "DM do usuario indisponivel na abertura do ticket.";
  await ticket.save();

  await recordSystemMessage(ticket, ticket.closeReason, client.user?.id || "");
  await thread
    ?.send({
      content: "Nao consegui enviar DM para o jogador. O ticket foi fechado para evitar atendimento inconsistente.",
      allowedMentions: SAFE_ALLOWED_MENTIONS,
    })
    .catch(() => null);
  await refreshStaffThreadPanel(client, ticket);
  await lockThread(thread, "Ticket fechado porque a DM do jogador esta indisponivel.");
  await logTicketAction(client, {
    ticket,
    action: "TICKET_CLOSE",
    executorId: client.user?.id || "",
    metadata: {
      reason: ticket.closeReason,
    },
  });
}

async function createTicketFromModal(interaction, categoryType) {
  const categoryConfig = getTicketCategoryConfig(categoryType);
  if (!categoryConfig) {
    await replyEphemeral(interaction, "Categoria de atendimento invalida.");
    return true;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  let ticket = null;
  let thread = null;

  try {
    const blacklistEntry = await isBlacklisted(interaction.user.id);
    if (blacklistEntry) {
      await replyEphemeral(interaction, "Voce nao possui permissao para abrir tickets.");
      return true;
    }

    if (await isOnOpenCooldown(interaction.user.id)) {
      await replyEphemeral(interaction, "Aguarde alguns segundos antes de abrir outro atendimento.");
      return true;
    }

    const forumChannel = await resolveStaffForumChannel(interaction.client);
    const formData = extractFormData(interaction, categoryConfig);
    ticket = await reserveTicket(interaction, categoryType, formData);
    thread = await createStaffThread(interaction.client, forumChannel, ticket, interaction.user);

    await recordSystemMessage(
      ticket,
      ["Ticket aberto pelo painel.", formDataToText(ticket, categoryConfig)].filter(Boolean).join("\n\n"),
      interaction.user.id,
    );

    const dmMessage = await sendTicketOpenedDm(interaction.user, ticket);
    if (!dmMessage) {
      await closeTicketAfterDmFailure(interaction.client, ticket, thread);
      await replyEphemeral(
        interaction,
        "Nao consegui abrir DM com voce. Ative mensagens privadas do servidor e tente novamente.",
      );
      await refreshSupportPanel(interaction.client);
      return true;
    }

    await logTicketAction(interaction.client, {
      ticket,
      action: "TICKET_CREATE",
      executorId: interaction.user.id,
      metadata: {
        staffForumChannelId: ticket.staffForumChannelId,
        staffThreadId: ticket.staffThreadId,
        categoryType,
      },
    });

    await replyEphemeral(interaction, "Seu atendimento foi aberto. Continue pela DM do bot.");
    await refreshSupportPanel(interaction.client);
    return true;
  } catch (error) {
    if (error.message === "MAX_ACTIVE_TICKETS" || isDuplicateKeyError(error)) {
      const activeTicket = error.activeTicket || (await findActiveTicketByUser(interaction.user.id));
      if (activeTicket) {
        await sendExistingTicketReply(interaction, activeTicket);
        return true;
      }
    }

    if (thread && ticket) {
      ticket.status = "closed";
      ticket.closedAt = new Date();
      ticket.closedBy = interaction.client.user?.id || "";
      ticket.closeReason = "Falha ao concluir abertura do ticket.";
      await ticket.save().catch(() => null);
      await lockThread(thread, ticket.closeReason);
    } else if (ticket) {
      await Ticket.deleteOne({ _id: ticket._id }).catch(() => null);
    }

    if (["TICKET_GUILD_NOT_FOUND", "TICKET_FORUM_NOT_CONFIGURED", "TICKET_FORUM_INVALID"].includes(error.code)) {
      log.warn(error.message);
      await replyEphemeral(interaction, "Area interna de atendimento nao configurada ou inacessivel.");
      return true;
    }

    log.error("Falha ao criar ticket.", error);
    await replyEphemeral(interaction, "Nao foi possivel abrir seu ticket agora. A equipe foi notificada.");
    return true;
  }
}

async function handleCategoryModalSubmit(interaction) {
  if (!interaction.customId?.startsWith(`${TICKET_CUSTOM_IDS.categoryModalPrefix}:`)) {
    return false;
  }

  const categoryType = interaction.customId.split(":")[2];
  await createTicketFromModal(interaction, categoryType);
  return true;
}

async function requireTicketForInteraction(interaction, ticketId, options = {}) {
  const ticket = await Ticket.findOne(
    buildTicketScopeQuery({
      ticketId,
    }),
  );

  if (
    !ticket ||
    (!options.allowDm && ticket.guildId !== interaction.guildId) ||
    (options.allowDm && interaction.guildId && ticket.guildId !== interaction.guildId)
  ) {
    await replyEphemeral(interaction, "Ticket nao encontrado.");
    return null;
  }

  return ticket;
}

async function fetchInteractionMember(interaction, ticket) {
  if (interaction.member?.roles?.cache) {
    return interaction.member;
  }

  const guild = interaction.guild || (await interaction.client.guilds.fetch(ticket.guildId).catch(() => null));
  return guild?.members.fetch(interaction.user.id).catch(() => null);
}

async function requireStaff(interaction, ticket) {
  if (interaction.guildId !== ticket.guildId) {
    await replyEphemeral(interaction, "Use esta acao no servidor interno de atendimento.");
    return false;
  }

  const member = await fetchInteractionMember(interaction, ticket);
  if (isTicketSupport(member, ticket.categoryType)) {
    return true;
  }

  await replyEphemeral(interaction, "Voce nao possui permissao para gerenciar este ticket.");
  return false;
}

async function findTicketForCurrentThread(interaction) {
  if (!interaction.guildId || interaction.guildId !== getTicketGuildId()) {
    await replyEphemeral(interaction, "Use este comando dentro da thread interna de atendimento.");
    return null;
  }

  const ticket = await findTicketByThread(interaction.channelId);
  if (!ticket) {
    await replyEphemeral(interaction, "Esta thread nao pertence a um ticket ModMail.");
    return null;
  }

  return ticket;
}

async function handleManage(interaction, ticketId) {
  const ticket = await requireTicketForInteraction(interaction, ticketId);
  if (!ticket || !(await requireStaff(interaction, ticket))) {
    return true;
  }

  await replyComponentsV2Ephemeral(interaction, buildTicketManageComponents(ticket));
  return true;
}

async function handleClaim(interaction, ticketId) {
  const ticket = await requireTicketForInteraction(interaction, ticketId);
  if (!ticket || !(await requireStaff(interaction, ticket))) {
    return true;
  }

  if (ticket.status === "paused") {
    await replyEphemeral(interaction, "Retome o ticket antes de assumir.");
    return true;
  }

  if (ticket.status === "claimed" && ticket.assignedStaffId === interaction.user.id) {
    const unclaimedTicket = await Ticket.findOneAndUpdate(
      buildTicketScopeQuery({
        ticketId,
        status: "claimed",
        assignedStaffId: interaction.user.id,
      }),
      {
        $set: {
          assignedStaffId: "",
          status: "open",
        },
      },
      { new: true },
    );

    if (unclaimedTicket) {
      await refreshStaffThreadPanel(interaction.client, unclaimedTicket);
      await logTicketAction(interaction.client, {
        ticket: unclaimedTicket,
        action: "TICKET_UNCLAIM",
        executorId: interaction.user.id,
      });
      await replyEphemeral(interaction, "Voce deixou de assumir este atendimento.");
      return true;
    }
  }

  const updatedTicket = await Ticket.findOneAndUpdate(
    buildTicketScopeQuery({
      ticketId,
      status: "open",
      $or: [{ assignedStaffId: "" }, { assignedStaffId: { $exists: false } }],
    }),
    {
      $set: {
        assignedStaffId: interaction.user.id,
        status: "claimed",
      },
    },
    { new: true },
  );

  if (!updatedTicket) {
    const currentTicket = await Ticket.findOne(buildTicketScopeQuery({ ticketId }));
    const message = currentTicket?.assignedStaffId
      ? `Este ticket ja foi assumido por <@${currentTicket.assignedStaffId}>.`
      : "Este ticket nao esta disponivel para assumir.";
    await replyEphemeral(interaction, message);
    return true;
  }

  await refreshStaffThreadPanel(interaction.client, updatedTicket);
  await logTicketAction(interaction.client, {
    ticket: updatedTicket,
    action: "TICKET_CLAIM",
    executorId: interaction.user.id,
  });
  await replyEphemeral(interaction, "Voce assumiu este atendimento.");
  return true;
}

async function sendUserSelect(interaction, ticketId, action, placeholder) {
  const ticket = await requireTicketForInteraction(interaction, ticketId);
  if (!ticket || !(await requireStaff(interaction, ticket))) {
    return true;
  }

  await replyEphemeral(interaction, "Selecione o membro da equipe.", {
    components: [buildUserSelectRow(`${action}:${ticketId}`, placeholder)],
  });
  return true;
}

async function handleTransferSelect(interaction, ticketId) {
  const ticket = await requireTicketForInteraction(interaction, ticketId);
  if (!ticket || !(await requireStaff(interaction, ticket))) {
    return true;
  }

  const targetId = interaction.values?.[0];
  const guild = interaction.guild || (await resolveStaffGuild(interaction.client));
  const targetMember = await guild.members.fetch(targetId).catch(() => null);

  if (!targetMember || !isTicketSupport(targetMember, ticket.categoryType)) {
    await replyEphemeral(interaction, "Selecione um membro da equipe com permissao para essa categoria.");
    return true;
  }

  const oldStaffId = ticket.assignedStaffId || "";
  ticket.assignedStaffId = targetId;
  ticket.status = "claimed";
  ticket.pausedAt = null;
  ticket.pausedBy = "";
  await ticket.save();
  await refreshStaffThreadPanel(interaction.client, ticket);
  await logTicketAction(interaction.client, {
    ticket,
    action: "TICKET_TRANSFER",
    executorId: interaction.user.id,
    targetId,
    metadata: {
      oldStaffId,
      newStaffId: targetId,
    },
  });
  await replyEphemeral(interaction, `Atendimento transferido para <@${targetId}>.`);
  return true;
}

async function handleCallUser(interaction, ticketId) {
  const ticket = await requireTicketForInteraction(interaction, ticketId);
  if (!ticket || !(await requireStaff(interaction, ticket))) {
    return true;
  }

  const cooldownLimit = new Date(Date.now() - config.tickets.callCooldownMs);
  const updatedTicket = await Ticket.findOneAndUpdate(
    buildTicketScopeQuery({
      ticketId,
      status: {
        $in: ACTIVE_TICKET_STATUSES,
      },
      $or: [
        { lastCallAt: null },
        { lastCallAt: { $exists: false } },
        { lastCallAt: { $lte: cooldownLimit } },
      ],
    }),
    {
      $set: {
        lastCallAt: new Date(),
      },
    },
    { new: true },
  );

  if (!updatedTicket) {
    await replyEphemeral(interaction, "Aguarde o cooldown antes de chamar o jogador novamente.");
    return true;
  }

  const user = await interaction.client.users.fetch(ticket.userId).catch(() => null);
  const dm = await user
    ?.send({
      content: "A equipe respondeu ao seu ticket e esta aguardando seu retorno.",
      allowedMentions: SAFE_ALLOWED_MENTIONS,
    })
    .catch(() => null);

  await logTicketAction(interaction.client, {
    ticket: updatedTicket,
    action: "TICKET_CALL_USER",
    executorId: interaction.user.id,
    targetId: ticket.userId,
    metadata: {
      delivered: Boolean(dm),
    },
  });
  await replyEphemeral(interaction, dm ? "Jogador chamado na DM." : "Nao consegui enviar DM para o jogador.");
  return true;
}

async function pauseTicket(interaction, ticketId) {
  const ticket = await requireTicketForInteraction(interaction, ticketId);
  if (!ticket || !(await requireStaff(interaction, ticket))) {
    return true;
  }

  if (ticket.status === "paused") {
    await replyEphemeral(interaction, "Este ticket ja esta pausado.");
    return true;
  }

  if (!ACTIVE_TICKET_STATUSES.includes(ticket.status)) {
    await replyEphemeral(interaction, "Este ticket nao esta aberto.");
    return true;
  }

  ticket.status = "paused";
  ticket.pausedAt = new Date();
  ticket.pausedBy = interaction.user.id;
  await ticket.save();
  await refreshStaffThreadPanel(interaction.client, ticket);
  await recordSystemMessage(ticket, `Ticket pausado por ${interaction.user.id}.`, interaction.user.id);
  await logTicketAction(interaction.client, {
    ticket,
    action: "TICKET_PAUSE",
    executorId: interaction.user.id,
  });
  await replyEphemeral(interaction, "Ticket pausado.");
  return true;
}

async function resumeTicket(interaction, ticketId) {
  const ticket = await requireTicketForInteraction(interaction, ticketId);
  if (!ticket || !(await requireStaff(interaction, ticket))) {
    return true;
  }

  if (ticket.status !== "paused") {
    await replyEphemeral(interaction, "Este ticket nao esta pausado.");
    return true;
  }

  ticket.status = ticket.assignedStaffId ? "claimed" : "open";
  ticket.pausedAt = null;
  ticket.pausedBy = "";
  await ticket.save();
  await refreshStaffThreadPanel(interaction.client, ticket);
  await recordSystemMessage(ticket, `Ticket retomado por ${interaction.user.id}.`, interaction.user.id);
  await logTicketAction(interaction.client, {
    ticket,
    action: "TICKET_RESUME",
    executorId: interaction.user.id,
  });
  await replyEphemeral(interaction, "Ticket retomado.");
  return true;
}

async function showCloseConfirmation(interaction, ticketId) {
  const ticket = await requireTicketForInteraction(interaction, ticketId);
  if (!ticket || !(await requireStaff(interaction, ticket))) {
    return true;
  }

  await replyEphemeral(interaction, "Deseja realmente fechar este atendimento?", {
    components: buildCloseConfirmComponents(ticketId),
  });
  return true;
}

async function sendClosedTicketDm(client, ticket) {
  const user = await client.users.fetch(ticket.userId).catch(() => null);
  if (!user) {
    return null;
  }

  return user
    .send({
      flags: MessageFlags.IsComponentsV2,
      components: buildTicketClosedComponents(ticket),
      allowedMentions: SAFE_ALLOWED_MENTIONS,
    })
    .catch((error) => {
      log.warn(`Nao foi possivel enviar DM de finalizacao do ticket ${ticket.ticketId}.`, error);
      return null;
    });
}

async function closeTicket(interaction, ticketId, reason) {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }

  const ticket = await requireTicketForInteraction(interaction, ticketId);
  if (!ticket || !(await requireStaff(interaction, ticket))) {
    return true;
  }

  const updatedTicket = await Ticket.findOneAndUpdate(
    buildTicketScopeQuery({
      ticketId,
      status: {
        $in: ACTIVE_TICKET_STATUSES,
      },
    }),
    {
      $set: {
        status: "closed",
        closedAt: new Date(),
        closedBy: interaction.user.id,
        closeReason: String(reason || "Resolvido").trim(),
      },
    },
    { new: true },
  );

  if (!updatedTicket) {
    await replyEphemeral(interaction, "Este ticket ja esta finalizado.");
    return true;
  }

  await recordSystemMessage(
    updatedTicket,
    `Ticket fechado por ${interaction.user.id}. Motivo: ${updatedTicket.closeReason || "Resolvido"}.`,
    interaction.user.id,
  );

  const transcript = await generateAndSendTranscript(interaction.client, updatedTicket);
  await logTicketAction(interaction.client, {
    ticket: updatedTicket,
    action: "TICKET_TRANSCRIPT",
    executorId: interaction.client.user.id,
    metadata: transcript,
  });

  const finalMessage = await sendClosedTicketDm(interaction.client, updatedTicket);
  updatedTicket.finalMessageId = finalMessage?.id || "";
  await updatedTicket.save();

  await refreshStaffThreadPanel(interaction.client, updatedTicket);
  const thread = await fetchTicketThread(interaction.client, updatedTicket);
  await lockThread(thread, `Ticket fechado por ${interaction.user.tag || interaction.user.id}.`);

  await logTicketAction(interaction.client, {
    ticket: updatedTicket,
    action: "TICKET_CLOSE",
    executorId: interaction.user.id,
    metadata: {
      reason: updatedTicket.closeReason,
      finalMessageSentInDm: Boolean(finalMessage),
    },
  });
  await replyEphemeral(
    interaction,
    finalMessage
      ? "Ticket finalizado, transcript gerado e avaliacao enviada na DM."
      : "Ticket finalizado e transcript gerado, mas nao consegui enviar a DM de avaliacao.",
  );
  await refreshSupportPanel(interaction.client);
  return true;
}

async function confirmCloseTicket(interaction, ticketId) {
  await interaction
    .update({
      content: "Fechando ticket...",
      components: [],
      allowedMentions: SAFE_ALLOWED_MENTIONS,
    })
    .catch(() => null);

  return closeTicket(interaction, ticketId, "Resolvido");
}

async function cancelCloseTicket(interaction) {
  await interaction
    .update({
      content: "Fechamento cancelado.",
      components: [],
      allowedMentions: SAFE_ALLOWED_MENTIONS,
    })
    .catch(() => null);
  return true;
}

async function reopenTicket(client, interaction, ticket) {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }

  if (!(await requireStaff(interaction, ticket))) {
    return;
  }

  if (ACTIVE_TICKET_STATUSES.includes(ticket.status)) {
    await replyEphemeral(interaction, "Este ticket ja esta aberto.");
    return;
  }

  const activeTicket = await findActiveTicketByUser(ticket.userId);
  if (activeTicket && activeTicket.ticketId !== ticket.ticketId) {
    await replyEphemeral(
      interaction,
      `Este usuario ja possui o ticket #${formatTicketNumber(activeTicket.ticketNumber)} em aberto.`,
    );
    return;
  }

  let updatedTicket;
  try {
    updatedTicket = await Ticket.findOneAndUpdate(
      buildTicketScopeQuery({
        ticketId: ticket.ticketId,
        status: "closed",
      }),
      {
        $set: {
          status: ticket.assignedStaffId ? "claimed" : "open",
          closedAt: null,
          closedBy: "",
          closeReason: "",
          pausedAt: null,
          pausedBy: "",
        },
      },
      { new: true },
    );
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      await replyEphemeral(interaction, "Este usuario ja possui outro atendimento em aberto.");
      return;
    }

    throw error;
  }

  if (!updatedTicket) {
    await replyEphemeral(interaction, "Este ticket nao esta disponivel para reabrir.");
    return;
  }

  const thread = await fetchTicketThread(client, updatedTicket);
  await ensureThreadWritable(thread);
  await refreshStaffThreadPanel(client, updatedTicket);
  await recordSystemMessage(updatedTicket, `Ticket reaberto por ${interaction.user.id}.`, interaction.user.id);
  await interaction.client.users
    .fetch(updatedTicket.userId)
    .then((user) =>
      user.send({
        content: `Seu ticket #${formatTicketNumber(updatedTicket.ticketNumber)} foi reaberto pela equipe.`,
        allowedMentions: SAFE_ALLOWED_MENTIONS,
      }),
    )
    .catch(() => null);

  await logTicketAction(client, {
    ticket: updatedTicket,
    action: "TICKET_REOPEN",
    executorId: interaction.user.id,
  });
  await replyEphemeral(interaction, "Ticket reaberto.");
  await refreshSupportPanel(client);
}

async function handleTranscript(interaction, ticketId) {
  const ticket = await requireTicketForInteraction(interaction, ticketId);
  if (!ticket || !(await requireStaff(interaction, ticket))) {
    return true;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);
  const transcript = await generateAndSendTranscript(interaction.client, ticket);
  await logTicketAction(interaction.client, {
    ticket,
    action: "TICKET_TRANSCRIPT",
    executorId: interaction.user.id,
    metadata: transcript,
  });
  await replyEphemeral(
    interaction,
    transcript.messageId
      ? "Transcript enviado no canal configurado."
      : "Transcript gerado, mas nao ha canal de transcript configurado ou acessivel.",
  );
  return true;
}

async function handleReviewRating(interaction, ticketId, rating) {
  const reviewRating = parseReviewRating(rating);
  if (!reviewRating) {
    await replyEphemeral(interaction, "Selecione uma nota valida.");
    return true;
  }

  const ticket = await requireTicketForInteraction(interaction, ticketId, { allowDm: true });
  if (!ticket) {
    return true;
  }

  if (interaction.user.id !== ticket.userId) {
    await replyEphemeral(interaction, "Somente quem abriu o ticket pode avaliar este atendimento.");
    return true;
  }

  if (await TicketReview.exists({ ticketId, userId: interaction.user.id })) {
    await replyEphemeral(interaction, "Voce ja avaliou este atendimento.");
    return true;
  }

  await interaction.showModal(buildReviewModal(ticketId, reviewRating));
  return true;
}

async function handleReviewSelect(interaction, ticketId) {
  return handleReviewRating(interaction, ticketId, interaction.values?.[0]);
}

async function handleReviewModal(interaction, ticketId, rating) {
  const reviewRating = parseReviewRating(rating);
  if (!reviewRating) {
    await replyEphemeral(interaction, "Selecione uma nota valida.");
    return true;
  }

  const ticket = await requireTicketForInteraction(interaction, ticketId, { allowDm: true });
  if (!ticket) {
    return true;
  }

  if (interaction.user.id !== ticket.userId) {
    await replyEphemeral(interaction, "Somente quem abriu o ticket pode avaliar este atendimento.");
    return true;
  }

  const comment = String(interaction.fields.getTextInputValue("comment") || "").trim();

  try {
    await TicketReview.create({
      ticketId,
      guildId: ticket.guildId,
      userId: interaction.user.id,
      staffId: ticket.assignedStaffId || "",
      rating: reviewRating,
      comment,
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      await replyEphemeral(interaction, "Voce ja avaliou este atendimento.");
      return true;
    }

    throw error;
  }

  await logTicketAction(interaction.client, {
    ticket,
    action: "TICKET_REVIEW",
    executorId: interaction.user.id,
    targetId: ticket.assignedStaffId || "",
    metadata: {
      rating: reviewRating,
      comment,
    },
  });

  if (config.tickets.reviewChannelId) {
    const reviewChannel =
      interaction.client.channels.cache.get(config.tickets.reviewChannelId) ||
      (await interaction.client.channels.fetch(config.tickets.reviewChannelId).catch(() => null));

    if (reviewChannel?.isTextBased?.()) {
      await reviewChannel
        .send({
          flags: MessageFlags.IsComponentsV2,
          components: buildTicketReviewComponents({
            ticket,
            rating: reviewRating,
            userId: interaction.user.id,
            userAvatarUrl: interaction.user.displayAvatarURL({ size: 128 }),
            comment,
          }),
          allowedMentions: SAFE_ALLOWED_MENTIONS,
        })
        .catch(() => null);
    }
  }

  await replyEphemeral(interaction, "Obrigado pela avaliacao!");
  return true;
}

async function handleTicketButton(interaction) {
  if (!interaction.customId?.startsWith("ticket:")) {
    return false;
  }

  const [, action, ticketId] = interaction.customId.split(":");

  if (action === "claim") return handleClaim(interaction, ticketId);
  if (action === "manage") return handleManage(interaction, ticketId);
  if (action === "transfer") {
    return sendUserSelect(interaction, ticketId, TICKET_CUSTOM_IDS.transferSelectPrefix, "Selecione o novo responsavel");
  }
  if (action === "call-user") return handleCallUser(interaction, ticketId);
  if (action === "pause") return pauseTicket(interaction, ticketId);
  if (action === "resume") return resumeTicket(interaction, ticketId);
  if (action === "transcript") return handleTranscript(interaction, ticketId);
  if (action === "close") return showCloseConfirmation(interaction, ticketId);
  if (action === "close-confirm") return confirmCloseTicket(interaction, ticketId);
  if (action === "close-cancel") return cancelCloseTicket(interaction);
  if (action === "reopen") {
    const ticket = await requireTicketForInteraction(interaction, ticketId);
    if (!ticket) return true;
    await reopenTicket(interaction.client, interaction, ticket);
    return true;
  }

  return false;
}

async function handleTicketStringSelect(interaction) {
  if (!interaction.customId?.startsWith("ticket:")) {
    return false;
  }

  if (interaction.customId === TICKET_CUSTOM_IDS.panelSelect) {
    return handlePanelSelect(interaction);
  }

  const [, action, ticketId] = interaction.customId.split(":");

  if (action === "review") return handleReviewSelect(interaction, ticketId);

  return false;
}

async function handleTicketUserSelect(interaction) {
  if (!interaction.customId?.startsWith("ticket:")) {
    return false;
  }

  const [, action, ticketId] = interaction.customId.split(":");

  if (action === "transfer-select") return handleTransferSelect(interaction, ticketId);

  return false;
}

async function handleTicketModalSubmit(interaction) {
  if (!interaction.customId?.startsWith("ticket:")) {
    return false;
  }

  if (interaction.customId.startsWith(`${TICKET_CUSTOM_IDS.categoryModalPrefix}:`)) {
    return handleCategoryModalSubmit(interaction);
  }

  const [, action, ticketId, rating] = interaction.customId.split(":");

  if (action === "review-modal") return handleReviewModal(interaction, ticketId, rating);

  return false;
}

async function handleTicketInteraction(interaction) {
  if (!config.tickets.enabled || !interaction.customId?.startsWith("ticket:")) {
    return false;
  }

  try {
    if (interaction.isStringSelectMenu()) return handleTicketStringSelect(interaction);
    if (interaction.isButton()) return handleTicketButton(interaction);
    if (interaction.isUserSelectMenu()) return handleTicketUserSelect(interaction);
    if (interaction.isModalSubmit()) return handleTicketModalSubmit(interaction);
  } catch (error) {
    log.error("Falha ao processar interacao de ticket.", error);
    await replyEphemeral(interaction, "Nao foi possivel processar essa acao agora.");
    return true;
  }

  return false;
}

function extractMessageAttachments(message) {
  return [...message.attachments.values()].map((attachment) => ({
    id: attachment.id || "",
    name: attachment.name || "anexo",
    url: attachment.url || "",
    contentType: attachment.contentType || "",
    size: Number(attachment.size || 0),
  }));
}

function formatAttachmentLinks(attachments) {
  return attachments
    .filter((attachment) => attachment.url)
    .map((attachment, index) => `${attachment.name || `anexo-${index + 1}`}: <${attachment.url}>`)
    .join("\n");
}

function truncateRelayContent(content) {
  const text = String(content || "").trim();
  if (text.length <= MAX_RELAY_CONTENT_LENGTH) {
    return text;
  }

  return `${text.slice(0, MAX_RELAY_CONTENT_LENGTH - 40)}\n\n[Mensagem truncada no Discord; transcript contem o texto salvo.]`;
}

function buildAttachmentFiles(attachments) {
  return attachments
    .filter((attachment) => attachment.url)
    .slice(0, 10)
    .map((attachment, index) => ({
      attachment: attachment.url,
      name: attachment.name || `anexo-${index + 1}`,
    }));
}

async function sendWithAttachmentFallback(target, payload, attachments, contextLabel) {
  const basePayload = {
    ...payload,
    content: truncateRelayContent(payload.content),
    allowedMentions: SAFE_ALLOWED_MENTIONS,
  };
  const files = buildAttachmentFiles(attachments);

  if (!files.length) {
    return target.send(basePayload);
  }

  try {
    return await target.send({
      ...basePayload,
      files,
    });
  } catch (error) {
    log.warn(`Nao foi possivel reenviar anexos como arquivo (${contextLabel}). Usando links.`, error);
    const attachmentLinks = formatAttachmentLinks(attachments);
    const fallbackContent = truncateRelayContent([basePayload.content, attachmentLinks && `Anexos:\n${attachmentLinks}`]
      .filter(Boolean)
      .join("\n\n"));

    return target.send({
      ...basePayload,
      content: fallbackContent || "Mensagem com anexos.",
    });
  }
}

function buildUserRelayContent(ticket, message, attachments) {
  const attachmentNotice = attachments.length && !message.content ? "O jogador enviou anexo." : "";
  return truncateRelayContent(
    [
      `**Jogador:** <@${ticket.userId}> (${message.author.tag || message.author.id})`,
      ticket.status === "paused" ? `**Status:** ${getStatusLabel(ticket.status)}` : "",
      message.content || attachmentNotice,
    ]
      .filter(Boolean)
      .join("\n\n"),
  );
}

function buildStaffRelayContent(ticket, message, attachments) {
  const staffName = message.member?.displayName || message.author.globalName || message.author.username || message.author.id;
  const identityPrefix = config.tickets.showStaffIdentity ? `**${escapeDiscordText(staffName)}:**\n` : "";
  const attachmentNotice = attachments.length && !message.content ? "A equipe enviou anexo." : "";

  return truncateRelayContent(`${identityPrefix}${message.content || attachmentNotice}`);
}

async function handleUserDmMessage(message, client) {
  const ticket = await findActiveTicketByUser(message.author.id);

  if (!ticket) {
    await message.channel
      .send({
        content: "Voce nao possui ticket aberto. Use o painel de atendimento no servidor para iniciar um novo atendimento.",
        allowedMentions: SAFE_ALLOWED_MENTIONS,
      })
      .catch(() => null);
    return true;
  }

  const thread = await fetchTicketThread(client, ticket);
  if (!thread) {
    await message.channel
      .send({
        content: "Nao encontrei a thread interna deste atendimento. A equipe foi notificada.",
        allowedMentions: SAFE_ALLOWED_MENTIONS,
      })
      .catch(() => null);
    await logTicketAction(client, {
      ticket,
      action: "TICKET_RELAY_FAILED",
      executorId: message.author.id,
      metadata: {
        reason: "staffThreadId not found",
      },
    });
    return true;
  }

  if (await TicketMessage.exists({ sourceMessageId: message.id })) {
    return true;
  }

  await ensureThreadWritable(thread);
  const attachments = extractMessageAttachments(message);
  const content = buildUserRelayContent(ticket, message, attachments);
  const targetMessage = await sendWithAttachmentFallback(
    thread,
    {
      content,
    },
    attachments,
    `DM -> thread ${ticket.ticketId}`,
  );

  await recordTicketMessage(ticket, {
    direction: "user_to_staff",
    authorId: message.author.id,
    authorTag: message.author.tag || message.author.id,
    content: message.content || "",
    attachments,
    sourceMessageId: message.id,
    sourceChannelId: message.channelId,
    targetMessageId: targetMessage.id,
    targetChannelId: thread.id,
    createdAt: message.createdAt,
  });
  await logTicketAction(client, {
    ticket,
    action: "TICKET_RELAY_USER",
    executorId: message.author.id,
    metadata: {
      sourceMessageId: message.id,
      targetMessageId: targetMessage.id,
      attachments: attachments.length,
    },
  });
  return true;
}

async function handleStaffThreadMessage(message, client) {
  if (!message.channel?.isThread?.() || message.guildId !== getTicketGuildId()) {
    return false;
  }

  const ticket = await findTicketByThread(message.channel.id);
  if (!ticket) {
    return false;
  }

  if (!ACTIVE_TICKET_STATUSES.includes(ticket.status)) {
    await message
      .reply({
        content: "Este ticket esta fechado. Reabra o atendimento antes de responder ao jogador.",
        allowedMentions: SAFE_ALLOWED_MENTIONS,
      })
      .catch(() => null);
    return true;
  }

  const member = message.member || (await message.guild.members.fetch(message.author.id).catch(() => null));
  if (!isTicketSupport(member, ticket.categoryType)) {
    await message
      .reply({
        content: "Voce nao possui permissao para responder este ticket.",
        allowedMentions: SAFE_ALLOWED_MENTIONS,
      })
      .catch(() => null);
    return true;
  }

  if (await TicketMessage.exists({ sourceMessageId: message.id })) {
    return true;
  }

  const attachments = extractMessageAttachments(message);
  if (!message.content && !attachments.length) {
    return true;
  }

  const user = await client.users.fetch(ticket.userId).catch(() => null);
  const content = buildStaffRelayContent(ticket, message, attachments);
  let targetMessage = null;

  if (user) {
    targetMessage = await sendWithAttachmentFallback(
      user,
      {
        content,
      },
      attachments,
      `thread -> DM ${ticket.ticketId}`,
    ).catch((error) => {
      log.warn(`Nao foi possivel enviar resposta do ticket ${ticket.ticketId} para DM.`, error);
      return null;
    });
  }

  await recordTicketMessage(ticket, {
    direction: "staff_to_user",
    authorId: message.author.id,
    authorTag: message.author.tag || message.author.id,
    content: message.content || "",
    attachments,
    sourceMessageId: message.id,
    sourceChannelId: message.channelId,
    targetMessageId: targetMessage?.id || "",
    targetChannelId: targetMessage?.channelId || "",
    delivered: Boolean(targetMessage),
    createdAt: message.createdAt,
  });

  if (!targetMessage) {
    await message
      .reply({
        content: "Nao consegui entregar esta mensagem na DM do jogador.",
        allowedMentions: SAFE_ALLOWED_MENTIONS,
      })
      .catch(() => null);
  }

  await logTicketAction(client, {
    ticket,
    action: "TICKET_RELAY_STAFF",
    executorId: message.author.id,
    targetId: ticket.userId,
    metadata: {
      sourceMessageId: message.id,
      targetMessageId: targetMessage?.id || "",
      attachments: attachments.length,
      delivered: Boolean(targetMessage),
    },
  });
  return true;
}

async function handleTicketMessage(message, client) {
  if (!config.tickets.enabled || !message || message.author?.bot || message.webhookId) {
    return false;
  }

  try {
    const fullMessage = message.partial ? await message.fetch().catch(() => message) : message;

    if (!fullMessage.guildId && fullMessage.channel?.type === ChannelType.DM) {
      return handleUserDmMessage(fullMessage, client);
    }

    return handleStaffThreadMessage(fullMessage, client);
  } catch (error) {
    log.error("Falha ao processar mensagem de ticket.", error);
    return true;
  }
}

async function closeLegacyActiveTickets(client) {
  const now = new Date();
  const result = await Ticket.updateMany(
    {
      systemVersion: {
        $ne: MODMAIL_SYSTEM_VERSION,
      },
      status: {
        $in: ["open", "claimed"],
      },
    },
    {
      $set: {
        status: "legacy_closed",
        closedAt: now,
        closedBy: client.user?.id || "",
        closeReason: "Ticket legado encerrado na migracao para ModMail.",
        legacyClosedAt: now,
      },
    },
  );

  if (result.modifiedCount) {
    log.warn(`${result.modifiedCount} ticket(s) legado(s) aberto(s) foram marcados como legacy_closed.`);
  }
}

async function initializeTickets(client) {
  if (!config.tickets.enabled) {
    log.info("Sistema de tickets desativado.");
    return;
  }

  await ensureTicketIndexes();
  await closeLegacyActiveTickets(client);

  if (!config.tickets.staffForumChannelId) {
    log.warn("DISCORD_TICKET_STAFF_FORUM_CHANNEL_ID nao configurado. O painel abre, mas novos tickets nao serao criados.");
  }

  const openTickets = await Ticket.find(
    buildTicketScopeQuery({
      status: {
        $in: ACTIVE_TICKET_STATUSES,
      },
    }),
  );

  for (const ticket of openTickets) {
    const thread = await fetchTicketThread(client, ticket);
    if (!thread) {
      log.warn(`Ticket #${formatTicketNumber(ticket.ticketNumber)} esta ativo, mas a thread ${ticket.staffThreadId} nao foi encontrada.`);
      continue;
    }

    await refreshStaffThreadPanel(client, ticket);
  }

  await upsertSupportPanel(client);
  log.info("Sistema de tickets ModMail inicializado.");
}

async function showTicketInfo(interaction) {
  const ticket = await findTicketForCurrentThread(interaction);
  if (!ticket || !(await requireStaff(interaction, ticket))) {
    return;
  }

  const categoryConfig = getTicketCategoryConfig(ticket.categoryType) || {};
  await replyEphemeral(
    interaction,
    [
      `Ticket #${formatTicketNumber(ticket.ticketNumber)}`,
      `Categoria: ${categoryConfig.name || ticket.categoryType}`,
      `Jogador: <@${ticket.userId}>`,
      `Status: ${getStatusLabel(ticket.status)}`,
      `Responsavel: ${ticket.assignedStaffId ? `<@${ticket.assignedStaffId}>` : "Nao definido"}`,
      `Thread: <#${ticket.staffThreadId}>`,
    ].join("\n"),
  );
}

async function closeTicketFromCommand(client, interaction, reason) {
  const ticket = await findTicketForCurrentThread(interaction);
  if (!ticket) {
    return;
  }

  await closeTicket(interaction, ticket.ticketId, reason || "Resolvido");
  await refreshSupportPanel(client);
}

async function reopenTicketFromCommand(client, interaction) {
  const ticket = await findTicketForCurrentThread(interaction);
  if (!ticket) {
    return;
  }

  await reopenTicket(client, interaction, ticket);
}

async function pauseTicketFromCommand(client, interaction) {
  const ticket = await findTicketForCurrentThread(interaction);
  if (!ticket) {
    return;
  }

  await pauseTicket(interaction, ticket.ticketId);
  await refreshSupportPanel(client);
}

async function resumeTicketFromCommand(client, interaction) {
  const ticket = await findTicketForCurrentThread(interaction);
  if (!ticket) {
    return;
  }

  await resumeTicket(interaction, ticket.ticketId);
  await refreshSupportPanel(client);
}

async function sendTranscriptFromCommand(client, interaction) {
  const ticket = await findTicketForCurrentThread(interaction);
  if (!ticket) {
    return;
  }

  await handleTranscript(interaction, ticket.ticketId);
  await refreshSupportPanel(client);
}

async function addBlacklistEntry(client, interaction, user, reason, days, permanent) {
  if (!isTicketAdministrator(interaction.member)) {
    await replyEphemeral(interaction, "Voce nao possui permissao para alterar a blacklist.");
    return;
  }

  const expiresAt = permanent ? null : new Date(Date.now() + Math.max(1, Number(days || 1)) * 86400000);

  await TicketBlacklist.findOneAndUpdate(
    {
      guildId: getTicketGuildId(),
      userId: user.id,
    },
    {
      $set: {
        reason,
        staffId: interaction.user.id,
        expiresAt,
        permanent: Boolean(permanent),
        createdAt: new Date(),
      },
    },
    { upsert: true, new: true },
  );
  await logTicketAction(client, {
    guildId: getTicketGuildId(),
    action: "TICKET_BLACKLIST_ADD",
    executorId: interaction.user.id,
    targetId: user.id,
    metadata: {
      reason,
      permanent,
      expiresAt,
    },
  });
  await replyEphemeral(interaction, `<@${user.id}> foi adicionado a blacklist de tickets.`);
}

async function removeBlacklistEntry(client, interaction, user) {
  if (!isTicketAdministrator(interaction.member)) {
    await replyEphemeral(interaction, "Voce nao possui permissao para alterar a blacklist.");
    return;
  }

  await TicketBlacklist.deleteOne({
    guildId: getTicketGuildId(),
    userId: user.id,
  });
  await logTicketAction(client, {
    guildId: getTicketGuildId(),
    action: "TICKET_BLACKLIST_REMOVE",
    executorId: interaction.user.id,
    targetId: user.id,
  });
  await replyEphemeral(interaction, `<@${user.id}> foi removido da blacklist de tickets.`);
}

async function showBlacklistEntry(interaction, user) {
  if (!isTicketAdministrator(interaction.member)) {
    await replyEphemeral(interaction, "Voce nao possui permissao para consultar a blacklist.");
    return;
  }

  const entry = await TicketBlacklist.findOne({
    guildId: getTicketGuildId(),
    userId: user.id,
  });

  if (!entry) {
    await replyEphemeral(interaction, "Este usuario nao esta na blacklist de tickets.");
    return;
  }

  await replyEphemeral(
    interaction,
    [
      `Usuario: <@${user.id}>`,
      `Motivo: ${entry.reason || "Nao informado"}`,
      `Aplicado por: ${entry.staffId ? `<@${entry.staffId}>` : "Nao informado"}`,
      `Expira: ${entry.permanent ? "Permanente" : entry.expiresAt?.toISOString() || "Nao informado"}`,
    ].join("\n"),
  );
}

module.exports = {
  addBlacklistEntry,
  closeTicketFromCommand,
  handleTicketInteraction,
  handleTicketMessage,
  initializeTickets,
  pauseTicketFromCommand,
  refreshSupportPanel,
  removeBlacklistEntry,
  reopenTicketFromCommand,
  resumeTicketFromCommand,
  sendTranscriptFromCommand,
  showBlacklistEntry,
  showTicketInfo,
  upsertSupportPanel,
};
