const fs = require("fs").promises;
const path = require("path");

const {
  ChannelType,
  MessageFlags,
} = require("discord.js");

const config = require("../config");
const { createLogger } = require("./logger");
const {
  ACTIVE_TICKET_STATUSES,
  Ticket,
  TicketBlacklist,
  TicketCounter,
  TicketLog,
  TicketMember,
  TicketReview,
  ensureTicketIndexes,
} = require("./ticket-models");
const {
  cleanupEmptyManagedCategory,
  ensureTicketCategory,
  syncManagedCategories,
} = require("./ticket-category-manager");
const {
  buildCategoryModal,
  buildCloseConfirmComponents,
  buildGoToTicketRow,
  buildReviewModal,
  buildSupportPanelComponents,
  buildTicketArchivedComponents,
  buildTicketClosedComponents,
  buildTicketManageComponents,
  buildTicketPanelComponents,
  buildTicketReviewComponents,
  buildRenameModal,
  buildUserSelectRow,
  TICKET_CUSTOM_IDS,
} = require("./ticket-components");
const {
  buildTicketChannelName,
  formatTicketNumber,
  getTicketCategoryConfig,
  normalizeTicketChannelName,
} = require("./ticket-common");
const { logTicketAction } = require("./ticket-logger");
const { generateAndSendTranscript } = require("./ticket-transcript");
const {
  buildTicketPermissionOverwrites,
  isProtectedTicketMember,
  isTicketAdministrator,
  isTicketSupport,
} = require("./ticket-permissions");

const log = createLogger("tickets");
const SAFE_ALLOWED_MENTIONS = {
  parse: [],
  repliedUser: false,
};

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

    log.warn("Não foi possível ler o estado do painel de tickets.", error);
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

  if (interaction.replied) {
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

async function getOpenTicketCount(guildId) {
  return Ticket.countDocuments({
    guildId,
    status: {
      $in: ACTIVE_TICKET_STATUSES,
    },
  });
}

async function findActiveTicketByOwner(guildId, ownerId) {
  return Ticket.findOne({
    guildId,
    ownerId,
    status: {
      $in: ACTIVE_TICKET_STATUSES,
    },
  }).sort({ createdAt: -1 });
}

async function findTicketByChannel(channelId, guildId) {
  return Ticket.findOne({
    channelId,
    guildId,
  }).sort({ createdAt: -1 });
}

async function isBlacklisted(guildId, userId) {
  const now = new Date();
  const blacklistEntry = await TicketBlacklist.findOne({
    guildId,
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

  return blacklistEntry;
}

async function isOnOpenCooldown(guildId, userId) {
  if (!config.tickets.openCooldownSeconds) {
    return false;
  }

  const createdAfter = new Date(Date.now() - config.tickets.openCooldownSeconds * 1000);
  return TicketLog.exists({
    guildId,
    action: "TICKET_CREATE",
    executorId: userId,
    createdAt: {
      $gte: createdAfter,
    },
  });
}

async function nextTicketNumber(guildId) {
  const counter = await TicketCounter.findOneAndUpdate(
    { guildId },
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
      throw new Error(`O campo "${field.label}" é obrigatório.`);
    }

    values[field.id] = value;
  }

  return values;
}

async function fetchGuildTextChannel(guild, channelId) {
  const channel =
    guild.channels.cache.get(channelId) ||
    (await guild.channels.fetch(channelId).catch(() => null));

  if (!channel?.isTextBased?.() || channel.guildId !== guild.id) {
    return null;
  }

  return channel;
}

async function fetchGuildCategory(guild, categoryId) {
  if (!categoryId) {
    return null;
  }

  const channel =
    guild.channels.cache.get(categoryId) ||
    (await guild.channels.fetch(categoryId).catch(() => null));

  if (channel?.type !== ChannelType.GuildCategory || channel.guildId !== guild.id) {
    return null;
  }

  return channel;
}

async function fetchTicketChannel(ticket, guild) {
  if (!ticket?.channelId) {
    return null;
  }

  return fetchGuildTextChannel(guild, ticket.channelId);
}

async function moveTicketToClosedCategory(channel) {
  const closedCategory = await fetchGuildCategory(channel.guild, config.tickets.closedCategoryId);
  if (!closedCategory) {
    log.warn(`Categoria de tickets fechados não encontrada: ${config.tickets.closedCategoryId}`);
    return null;
  }

  if (channel.parentId !== closedCategory.id) {
    await channel.edit({
      parent: closedCategory.id,
      reason: "Ticket finalizado e movido para categoria de arquivados.",
    });
  }

  return closedCategory;
}

async function upsertTicketArchivedPanel(channel, ticket) {
  const components = buildTicketArchivedComponents(ticket);

  if (ticket.panelMessageId) {
    const message = await channel.messages.fetch(ticket.panelMessageId).catch(() => null);
    if (message) {
      await message.edit({
        content: null,
        flags: MessageFlags.IsComponentsV2,
        components,
        allowedMentions: SAFE_ALLOWED_MENTIONS,
      });
      return message;
    }
  }

  const message = await channel.send({
    flags: MessageFlags.IsComponentsV2,
    components,
    allowedMentions: SAFE_ALLOWED_MENTIONS,
  });
  ticket.panelMessageId = message.id;
  await ticket.save();
  return message;
}

async function sendClosedTicketDm(client, ticket) {
  const user = await client.users.fetch(ticket.ownerId).catch(() => null);
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
      log.warn(`Não foi possível enviar DM de finalização do ticket ${ticket.ticketId}.`, error);
      return null;
    });
}

async function fetchPanelChannel(client, preferredChannel = null) {
  if (preferredChannel?.isTextBased?.() && typeof preferredChannel.send === "function") {
    return preferredChannel;
  }

  if (!config.tickets.panelChannelId) {
    return null;
  }

  const channel =
    client.channels.cache.get(config.tickets.panelChannelId) ||
    (await client.channels.fetch(config.tickets.panelChannelId).catch(() => null));

  if (!channel?.isTextBased?.() || typeof channel.send !== "function") {
    log.warn(`Canal de painel de tickets inválido ou inacessível: ${config.tickets.panelChannelId}`);
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

  const openTicketCount = await getOpenTicketCount(channel.guildId);
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
        log.warn("Não foi possível atualizar o painel de tickets salvo. Vou enviar um novo.", error);
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
    log.warn("Não foi possível atualizar painel principal de tickets.", error);
  });
}

async function resetSupportPanelSelect(interaction) {
  if (!interaction.message?.editable || !interaction.guildId) {
    return;
  }

  const openTicketCount = await getOpenTicketCount(interaction.guildId);
  await interaction.message
    .edit({
      content: null,
      flags: MessageFlags.IsComponentsV2,
      components: buildSupportPanelComponents({ openTicketCount }),
      allowedMentions: SAFE_ALLOWED_MENTIONS,
    })
    .catch((error) => {
      log.warn("Não foi possível resetar o select do painel de tickets.", error);
    });
}

async function sendExistingTicketReply(interaction, ticket) {
  const components = ticket.channelId
    ? [buildGoToTicketRow(ticket.guildId, ticket.channelId)]
    : [];

  await replyEphemeral(interaction, "Você já possui um atendimento em aberto.", {
    components,
  });
}

async function validateBeforeOpening(interaction) {
  if (!interaction.guild) {
    await replyEphemeral(interaction, "Use este painel dentro do servidor do Discord.");
    return false;
  }

  const blacklistEntry = await isBlacklisted(interaction.guildId, interaction.user.id);
  if (blacklistEntry) {
    await replyEphemeral(interaction, "🚫 Você não possui permissão para abrir tickets neste servidor.");
    return false;
  }

  const activeTicket = await findActiveTicketByOwner(interaction.guildId, interaction.user.id);
  if (activeTicket) {
    await sendExistingTicketReply(interaction, activeTicket);
    return false;
  }

  if (await isOnOpenCooldown(interaction.guildId, interaction.user.id)) {
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
    await replyEphemeral(interaction, "Categoria de atendimento inválida.");
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
  const activeTickets = await Ticket.countDocuments({
    guildId: interaction.guildId,
    ownerId: interaction.user.id,
    status: {
      $in: ACTIVE_TICKET_STATUSES,
    },
  });

  if (activeTickets >= config.tickets.maxTicketsPerUser) {
    const activeTicket = await findActiveTicketByOwner(interaction.guildId, interaction.user.id);
    const error = new Error("MAX_ACTIVE_TICKETS");
    error.activeTicket = activeTicket;
    throw error;
  }

  const ticketNumber = await nextTicketNumber(interaction.guildId);

  return Ticket.create({
    guildId: interaction.guildId,
    ownerId: interaction.user.id,
    categoryType,
    ticketNumber,
    minecraftNick: formData.minecraftNick || "",
    formData,
    status: "open",
  });
}

async function updateTicketPanelMessage(client, ticket) {
  if (!ticket.panelMessageId || !ticket.channelId) {
    return;
  }

  const guild = client.guilds.cache.get(ticket.guildId);
  if (!guild) {
    return;
  }

  const channel = await fetchTicketChannel(ticket, guild);
  if (!channel) {
    return;
  }

  const message = await channel.messages.fetch(ticket.panelMessageId).catch(() => null);
  if (!message) {
    return;
  }

  await message
    .edit({
      content: null,
      flags: MessageFlags.IsComponentsV2,
      components: buildTicketPanelComponents(ticket),
      allowedMentions: SAFE_ALLOWED_MENTIONS,
    })
    .catch((error) => {
      log.warn(`Não foi possível atualizar painel do ticket ${ticket.ticketId}.`, error);
    });
}

async function createTicketFromModal(interaction, categoryType) {
  const categoryConfig = getTicketCategoryConfig(categoryType);
  if (!categoryConfig) {
    await replyEphemeral(interaction, "Categoria de atendimento inválida.");
    return true;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  let ticket = null;
  let ticketChannel = null;
  let categoryResult = null;

  try {
    const blacklistEntry = await isBlacklisted(interaction.guildId, interaction.user.id);
    if (blacklistEntry) {
      await replyEphemeral(interaction, "🚫 Você não possui permissão para abrir tickets neste servidor.");
      return true;
    }

    if (await isOnOpenCooldown(interaction.guildId, interaction.user.id)) {
      await replyEphemeral(interaction, "Aguarde alguns segundos antes de abrir outro atendimento.");
      return true;
    }

    const formData = extractFormData(interaction, categoryConfig);
    ticket = await reserveTicket(interaction, categoryType, formData);
    categoryResult = await ensureTicketCategory(interaction.guild, categoryType);

    if (categoryResult.created) {
      await logTicketAction(interaction.client, {
        guildId: interaction.guildId,
        action: "TICKET_CATEGORY_CREATE",
        executorId: interaction.client.user.id,
        targetId: categoryResult.category.id,
        metadata: {
          categoryType,
          instance: categoryResult.record.instance,
        },
      });
    }

    ticketChannel = await interaction.guild.channels.create({
      name: buildTicketChannelName(categoryType, interaction.user),
      type: ChannelType.GuildText,
      parent: categoryResult.category.id,
      topic: `Ticket ${ticket.ticketId} | Dono ${interaction.user.id} | Categoria ${categoryType}`,
      permissionOverwrites: buildTicketPermissionOverwrites(interaction.guild, interaction.user.id, categoryType),
      reason: `Ticket aberto por ${interaction.user.tag || interaction.user.id}.`,
    });

    ticket.channelId = ticketChannel.id;
    ticket.categoryId = categoryResult.category.id;
    await ticket.save();

    const panelMessage = await ticketChannel.send({
      flags: MessageFlags.IsComponentsV2,
      components: buildTicketPanelComponents(ticket),
      allowedMentions: SAFE_ALLOWED_MENTIONS,
    });

    ticket.panelMessageId = panelMessage.id;
    await ticket.save();

    await logTicketAction(interaction.client, {
      ticket,
      action: "TICKET_CREATE",
      executorId: interaction.user.id,
      metadata: {
        channelId: ticketChannel.id,
        categoryType,
      },
    });

    await replyEphemeral(interaction, `Seu atendimento foi criado em <#${ticketChannel.id}>.`);
    await refreshSupportPanel(interaction.client);
    return true;
  } catch (error) {
    if (error.message === "MAX_ACTIVE_TICKETS" || isDuplicateKeyError(error)) {
      const activeTicket = error.activeTicket || (await findActiveTicketByOwner(interaction.guildId, interaction.user.id));
      if (activeTicket) {
        await sendExistingTicketReply(interaction, activeTicket);
        return true;
      }
    }

    if (ticketChannel) {
      await ticketChannel.delete("Rollback de ticket após falha na criação.").catch(() => null);
    }

    if (ticket && !ticket.channelId) {
      await Ticket.deleteOne({ _id: ticket._id }).catch(() => null);
    }

    if (categoryResult?.category?.id) {
      await cleanupEmptyManagedCategory(interaction.guild, categoryResult.category.id).catch(() => null);
    }

    log.error("Falha ao criar ticket.", error);
    await replyEphemeral(interaction, "Não foi possível abrir seu ticket agora. A equipe foi notificada.");
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
  const ticket = await Ticket.findOne({ ticketId });

  if (
    !ticket ||
    (!options.allowDm && ticket.guildId !== interaction.guildId) ||
    (options.allowDm && interaction.guildId && ticket.guildId !== interaction.guildId)
  ) {
    await replyEphemeral(interaction, "Ticket não encontrado.");
    return null;
  }

  return ticket;
}

async function requireStaff(interaction, ticket) {
  if (isTicketSupport(interaction.member, ticket.categoryType)) {
    return true;
  }

  await replyEphemeral(interaction, "Você não possui permissão para gerenciar este ticket.");
  return false;
}

async function requireStaffOrOwner(interaction, ticket) {
  if (interaction.user.id === ticket.ownerId || isTicketSupport(interaction.member, ticket.categoryType)) {
    return true;
  }

  await replyEphemeral(interaction, "Você não possui permissão para fechar este ticket.");
  return false;
}

async function requireReopenPermission(interaction, ticket) {
  if (interaction.user.id === ticket.ownerId || isTicketSupport(interaction.member, ticket.categoryType)) {
    return true;
  }

  await replyEphemeral(interaction, "Você não possui permissão para reabrir este ticket.");
  return false;
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

  if (ticket.status === "claimed" && ticket.assignedStaffId === interaction.user.id) {
    const unclaimedTicket = await Ticket.findOneAndUpdate(
      {
        ticketId,
        guildId: interaction.guildId,
        status: "claimed",
        assignedStaffId: interaction.user.id,
      },
      {
        $set: {
          assignedStaffId: "",
          status: "open",
        },
      },
      { new: true },
    );

    if (unclaimedTicket) {
      await updateTicketPanelMessage(interaction.client, unclaimedTicket);
      await logTicketAction(interaction.client, {
        ticket: unclaimedTicket,
        action: "TICKET_UNCLAIM",
        executorId: interaction.user.id,
      });
      await replyEphemeral(interaction, "Você deixou de assumir este atendimento.");
      return true;
    }
  }

  const updatedTicket = await Ticket.findOneAndUpdate(
    {
      ticketId,
      guildId: interaction.guildId,
      status: "open",
      $or: [{ assignedStaffId: "" }, { assignedStaffId: { $exists: false } }],
    },
    {
      $set: {
        assignedStaffId: interaction.user.id,
        status: "claimed",
      },
    },
    { new: true },
  );

  if (!updatedTicket) {
    const currentTicket = await Ticket.findOne({ ticketId });
    const message = currentTicket?.assignedStaffId
      ? `Este ticket já foi assumido por <@${currentTicket.assignedStaffId}>.`
      : "Este ticket não está disponível para assumir.";
    await replyEphemeral(interaction, message);
    return true;
  }

  await updateTicketPanelMessage(interaction.client, updatedTicket);
  await logTicketAction(interaction.client, {
    ticket: updatedTicket,
    action: "TICKET_CLAIM",
    executorId: interaction.user.id,
  });
  await replyEphemeral(interaction, "Você assumiu este atendimento.");
  return true;
}

async function sendUserSelect(interaction, ticketId, action, placeholder) {
  const ticket = await requireTicketForInteraction(interaction, ticketId);
  if (!ticket || !(await requireStaff(interaction, ticket))) {
    return true;
  }

  await replyEphemeral(interaction, "Selecione o usuário.", {
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
  const targetMember = await interaction.guild.members.fetch(targetId).catch(() => null);

  if (!targetMember || !isTicketSupport(targetMember, ticket.categoryType)) {
    await replyEphemeral(interaction, "Selecione um membro da equipe com permissão para essa categoria.");
    return true;
  }

  const oldStaffId = ticket.assignedStaffId || "";
  ticket.assignedStaffId = targetId;
  ticket.status = "claimed";
  await ticket.save();
  await updateTicketPanelMessage(interaction.client, ticket);
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

async function handleAddMemberSelect(interaction, ticketId) {
  const ticket = await requireTicketForInteraction(interaction, ticketId);
  if (!ticket || !(await requireStaff(interaction, ticket))) {
    return true;
  }

  const targetId = interaction.values?.[0];
  const channel = await fetchTicketChannel(ticket, interaction.guild);
  if (!channel) {
    await replyEphemeral(interaction, "Canal do ticket não encontrado.");
    return true;
  }

  await channel.permissionOverwrites.edit(targetId, {
    ViewChannel: true,
    SendMessages: true,
    AttachFiles: true,
    ReadMessageHistory: true,
    UseApplicationCommands: true,
  });
  await TicketMember.findOneAndUpdate(
    { ticketId, userId: targetId },
    {
      $setOnInsert: {
        ticketId,
        userId: targetId,
        addedBy: interaction.user.id,
        createdAt: new Date(),
      },
    },
    { upsert: true, new: true },
  );
  await logTicketAction(interaction.client, {
    ticket,
    action: "TICKET_MEMBER_ADD",
    executorId: interaction.user.id,
    targetId,
  });
  await replyEphemeral(interaction, `<@${targetId}> foi adicionado ao ticket.`);
  return true;
}

async function handleRemoveMemberSelect(interaction, ticketId) {
  const ticket = await requireTicketForInteraction(interaction, ticketId);
  if (!ticket || !(await requireStaff(interaction, ticket))) {
    return true;
  }

  const targetId = interaction.values?.[0];
  if (targetId === ticket.ownerId || targetId === interaction.client.user.id) {
    await replyEphemeral(interaction, "Não é possível remover o dono do ticket ou o bot.");
    return true;
  }

  const targetMember = await interaction.guild.members.fetch(targetId).catch(() => null);
  if (targetMember && isProtectedTicketMember(targetMember)) {
    await replyEphemeral(interaction, "Não é possível remover membros ou cargos protegidos da equipe.");
    return true;
  }

  const channel = await fetchTicketChannel(ticket, interaction.guild);
  if (!channel) {
    await replyEphemeral(interaction, "Canal do ticket não encontrado.");
    return true;
  }

  await channel.permissionOverwrites.delete(targetId).catch(() => null);
  await TicketMember.deleteOne({ ticketId, userId: targetId });
  await logTicketAction(interaction.client, {
    ticket,
    action: "TICKET_MEMBER_REMOVE",
    executorId: interaction.user.id,
    targetId,
  });
  await replyEphemeral(interaction, `<@${targetId}> foi removido do ticket.`);
  return true;
}

async function handleCallOwner(interaction, ticketId) {
  const ticket = await requireTicketForInteraction(interaction, ticketId);
  if (!ticket || !(await requireStaff(interaction, ticket))) {
    return true;
  }

  const cooldownLimit = new Date(Date.now() - config.tickets.callCooldownMs);
  const updatedTicket = await Ticket.findOneAndUpdate(
    {
      ticketId,
      status: {
        $in: ACTIVE_TICKET_STATUSES,
      },
      $or: [
        { lastCallAt: null },
        { lastCallAt: { $exists: false } },
        { lastCallAt: { $lte: cooldownLimit } },
      ],
    },
    {
      $set: {
        lastCallAt: new Date(),
      },
    },
    { new: true },
  );

  if (!updatedTicket) {
    await replyEphemeral(interaction, "Aguarde o cooldown antes de chamar o usuário novamente.");
    return true;
  }

  const user = await interaction.client.users.fetch(ticket.ownerId).catch(() => null);
  if (user) {
    await user
      .send("A equipe respondeu ao seu ticket e está aguardando seu retorno.")
      .catch(() => null);
  }

  await logTicketAction(interaction.client, {
    ticket: updatedTicket,
    action: "TICKET_CALL_USER",
    executorId: interaction.user.id,
    targetId: ticket.ownerId,
  });
  await replyEphemeral(interaction, "Usuário chamado no privado.");
  return true;
}

async function handleRenameModal(interaction, ticketId) {
  const ticket = await requireTicketForInteraction(interaction, ticketId);
  if (!ticket || !(await requireStaff(interaction, ticket))) {
    return true;
  }

  const requestedName = interaction.fields.getTextInputValue("name");
  const normalizedName = normalizeTicketChannelName(requestedName);

  if (!/^[a-z0-9-]{3,90}$/.test(normalizedName)) {
    await replyEphemeral(interaction, "Informe um nome válido usando letras, números e hifens.");
    return true;
  }

  const channel = await fetchTicketChannel(ticket, interaction.guild);
  if (!channel) {
    await replyEphemeral(interaction, "Canal do ticket não encontrado.");
    return true;
  }

  const oldName = channel.name;
  await channel.edit({
    name: normalizedName,
    reason: `Ticket renomeado por ${interaction.user.tag || interaction.user.id}.`,
  });
  await logTicketAction(interaction.client, {
    ticket,
    action: "TICKET_RENAME",
    executorId: interaction.user.id,
    metadata: {
      oldName,
      newName: normalizedName,
    },
  });
  await replyEphemeral(interaction, `Ticket renomeado para #${normalizedName}.`);
  return true;
}

async function showCloseConfirmation(interaction, ticketId) {
  const ticket = await requireTicketForInteraction(interaction, ticketId);
  if (!ticket || !(await requireStaffOrOwner(interaction, ticket))) {
    return true;
  }

  await replyEphemeral(interaction, "# Deseja realmente fechar este suporte? Esta ação não pode ser desfeita.", {
    components: buildCloseConfirmComponents(ticketId),
  });
  return true;
}

async function closeTicket(interaction, ticketId, reason) {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }

  const ticket = await requireTicketForInteraction(interaction, ticketId);
  if (!ticket || !(await requireStaffOrOwner(interaction, ticket))) {
    return true;
  }

  const updatedTicket = await Ticket.findOneAndUpdate(
    {
      ticketId,
      guildId: interaction.guildId,
      status: {
        $in: ACTIVE_TICKET_STATUSES,
      },
    },
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
    await replyEphemeral(interaction, "Este ticket já está finalizado.");
    return true;
  }

  const channel = await fetchTicketChannel(updatedTicket, interaction.guild);
  if (!channel) {
    await replyEphemeral(interaction, "Ticket finalizado, mas o canal não foi encontrado.");
    await refreshSupportPanel(interaction.client);
    return true;
  }

  const previousCategoryId = channel.parentId || updatedTicket.categoryId;

  const transcript = await generateAndSendTranscript(interaction.client, channel, updatedTicket);
  await logTicketAction(interaction.client, {
    ticket: updatedTicket,
    action: "TICKET_TRANSCRIPT",
    executorId: interaction.client.user.id,
    metadata: transcript,
  });

  const closedCategory = await moveTicketToClosedCategory(channel);
  if (closedCategory) {
    updatedTicket.categoryId = closedCategory.id;
  }

  await upsertTicketArchivedPanel(channel, updatedTicket);

  const finalMessage = await sendClosedTicketDm(interaction.client, updatedTicket);
  updatedTicket.finalMessageId = finalMessage?.id || "";
  await updatedTicket.save();

  if (previousCategoryId && previousCategoryId !== updatedTicket.categoryId) {
    const removedCategory = await cleanupEmptyManagedCategory(interaction.guild, previousCategoryId);
    if (removedCategory) {
      await logTicketAction(interaction.client, {
        guildId: interaction.guildId,
        action: "TICKET_CATEGORY_DELETE",
        executorId: interaction.client.user.id,
        targetId: previousCategoryId,
      });
    }
  }

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
      ? "Ticket finalizado, movido para arquivados e avaliação enviada no privado."
      : "Ticket finalizado e movido para arquivados, mas não consegui enviar a DM de avaliação.",
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

  if (!(await requireReopenPermission(interaction, ticket))) {
    return;
  }

  if (ACTIVE_TICKET_STATUSES.includes(ticket.status)) {
    await replyEphemeral(interaction, "Este ticket já está aberto.");
    return;
  }

  const activeTicket = await findActiveTicketByOwner(ticket.guildId, ticket.ownerId);
  if (activeTicket && activeTicket.ticketId !== ticket.ticketId) {
    await replyEphemeral(interaction, "Este usuário já possui outro atendimento em aberto.", {
      components: activeTicket.channelId ? [buildGoToTicketRow(activeTicket.guildId, activeTicket.channelId)] : [],
    });
    return;
  }

  const guild = client.guilds.cache.get(ticket.guildId);
  if (!guild) {
    await replyEphemeral(interaction, "Servidor do ticket não encontrado.");
    return;
  }

  const channel = await fetchTicketChannel(ticket, guild);
  if (!channel) {
    await replyEphemeral(interaction, "Canal do ticket não encontrado.");
    return;
  }

  const categoryResult = await ensureTicketCategory(guild, ticket.categoryType);
  if (categoryResult.created) {
    await logTicketAction(client, {
      guildId: ticket.guildId,
      action: "TICKET_CATEGORY_CREATE",
      executorId: client.user.id,
      targetId: categoryResult.category.id,
      metadata: {
        categoryType: ticket.categoryType,
        instance: categoryResult.record.instance,
      },
    });
  }

  let updatedTicket;
  try {
    updatedTicket = await Ticket.findOneAndUpdate(
      {
        ticketId: ticket.ticketId,
        guildId: ticket.guildId,
        status: "closed",
      },
      {
        $set: {
          status: "open",
          categoryId: categoryResult.category.id,
          closedAt: null,
          closedBy: "",
          closeReason: "",
        },
      },
      { new: true },
    );
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      await replyEphemeral(interaction, "Este usuário já possui outro atendimento em aberto.");
      return;
    }

    throw error;
  }

  if (!updatedTicket) {
    await replyEphemeral(interaction, "Este ticket não está disponível para reabrir.");
    return;
  }

  try {
    await channel.edit({
      parent: categoryResult.category.id,
      reason: `Ticket reaberto por ${interaction.user.tag || interaction.user.id}.`,
    });
  } catch (error) {
    await Ticket.updateOne(
      { ticketId: ticket.ticketId },
      {
        $set: {
          status: "closed",
          categoryId: ticket.categoryId,
          closedAt: ticket.closedAt,
          closedBy: ticket.closedBy,
          closeReason: ticket.closeReason,
        },
      },
    ).catch(() => null);
    throw error;
  }
  await updateTicketPanelMessage(client, updatedTicket);
  await logTicketAction(client, {
    ticket: updatedTicket,
    action: "TICKET_REOPEN",
    executorId: interaction.user.id,
    metadata: {
      categoryId: categoryResult.category.id,
    },
  });
  await replyEphemeral(interaction, "Ticket reaberto e movido para a categoria de atendimento.");
  await refreshSupportPanel(client);
}

async function handleReviewRating(interaction, ticketId, rating) {
  const reviewRating = parseReviewRating(rating);
  if (!reviewRating) {
    await replyEphemeral(interaction, "Selecione uma nota válida.");
    return true;
  }

  const ticket = await requireTicketForInteraction(interaction, ticketId, { allowDm: true });
  if (!ticket) {
    return true;
  }

  if (interaction.user.id !== ticket.ownerId) {
    await replyEphemeral(interaction, "Somente quem abriu o ticket pode avaliar este atendimento.");
    return true;
  }

  if (await TicketReview.exists({ ticketId, userId: interaction.user.id })) {
    await replyEphemeral(interaction, "Você já avaliou este atendimento.");
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
    await replyEphemeral(interaction, "Selecione uma nota válida.");
    return true;
  }

  const ticket = await requireTicketForInteraction(interaction, ticketId, { allowDm: true });
  if (!ticket) {
    return true;
  }

  if (interaction.user.id !== ticket.ownerId) {
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
      await replyEphemeral(interaction, "Você já avaliou este atendimento.");
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

  await replyEphemeral(interaction, "Obrigado pela avaliação!");
  return true;
}

async function handleTicketButton(interaction) {
  if (!interaction.customId?.startsWith("ticket:")) {
    return false;
  }

  const [, action, ticketId, rating] = interaction.customId.split(":");

  if (action === "claim") return handleClaim(interaction, ticketId);
  if (action === "manage") return handleManage(interaction, ticketId);
  if (action === "transfer") {
    return sendUserSelect(interaction, ticketId, TICKET_CUSTOM_IDS.transferSelectPrefix, "Selecione o novo responsável");
  }
  if (action === "add-member") {
    return sendUserSelect(interaction, ticketId, TICKET_CUSTOM_IDS.addMemberSelectPrefix, "Selecione quem será adicionado");
  }
  if (action === "remove-member") {
    return sendUserSelect(interaction, ticketId, TICKET_CUSTOM_IDS.removeMemberSelectPrefix, "Selecione quem será removido");
  }
  if (action === "call-owner") return handleCallOwner(interaction, ticketId);
  if (action === "rename") {
    const ticket = await requireTicketForInteraction(interaction, ticketId);
    if (!ticket || !(await requireStaff(interaction, ticket))) return true;
    await interaction.showModal(buildRenameModal(ticketId));
    return true;
  }
  if (action === "close") {
    return showCloseConfirmation(interaction, ticketId);
  }
  if (action === "close-confirm") return confirmCloseTicket(interaction, ticketId);
  if (action === "close-cancel") return cancelCloseTicket(interaction);
  if (action === "reopen") {
    const ticket = await requireTicketForInteraction(interaction, ticketId);
    if (!ticket) return true;
    await reopenTicket(interaction.client, interaction, ticket);
    return true;
  }
  if (action === "review") return handleReviewRating(interaction, ticketId, rating);

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
  if (action === "add-member-select") return handleAddMemberSelect(interaction, ticketId);
  if (action === "remove-member-select") return handleRemoveMemberSelect(interaction, ticketId);

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

  if (action === "rename-modal") return handleRenameModal(interaction, ticketId);
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
    log.error("Falha ao processar interação de ticket.", error);
    await replyEphemeral(interaction, "Não foi possível processar essa ação agora.");
    return true;
  }

  return false;
}

async function initializeTickets(client) {
  if (!config.tickets.enabled) {
    log.info("Sistema de tickets desativado.");
    return;
  }

  await ensureTicketIndexes();
  await syncManagedCategories(client);

  const openTickets = await Ticket.find({
    status: {
      $in: ACTIVE_TICKET_STATUSES,
    },
  });

  for (const ticket of openTickets) {
    const guild = client.guilds.cache.get(ticket.guildId);
    if (!guild) {
      continue;
    }

    const channel = await fetchTicketChannel(ticket, guild);
    if (!channel) {
      ticket.status = "closed";
      ticket.closedAt = new Date();
      ticket.closedBy = client.user.id;
      ticket.closeReason = "Canal do ticket não encontrado ao reiniciar o bot.";
      await ticket.save();
      await logTicketAction(client, {
        ticket,
        action: "TICKET_CLOSE",
        executorId: client.user.id,
        metadata: {
          reason: ticket.closeReason,
        },
      });
      continue;
    }

    await updateTicketPanelMessage(client, ticket);
  }

  await upsertSupportPanel(client);
  log.info("Sistema de tickets inicializado.");
}

async function reopenTicketFromCommand(client, interaction) {
  const ticket = await findTicketByChannel(interaction.channelId, interaction.guildId);
  if (!ticket) {
    await replyEphemeral(interaction, "Este canal não pertence a um ticket.");
    return;
  }

  await reopenTicket(client, interaction, ticket);
}

async function closeTicketFromCommand(client, interaction, reason) {
  const ticket = await findTicketByChannel(interaction.channelId, interaction.guildId);
  if (!ticket) {
    await replyEphemeral(interaction, "Este canal não pertence a um ticket.");
    return;
  }

  await closeTicket(interaction, ticket.ticketId, reason || "Resolvido");
  await refreshSupportPanel(client);
}

async function deleteTicketFromCommand(client, interaction) {
  const ticket = await findTicketByChannel(interaction.channelId, interaction.guildId);
  if (!ticket) {
    await replyEphemeral(interaction, "Este canal não pertence a um ticket.");
    return;
  }

  if (!isTicketSupport(interaction.member, ticket.categoryType)) {
    await replyEphemeral(interaction, "Você não possui permissão para excluir este ticket.");
    return;
  }

  const channel = await fetchTicketChannel(ticket, interaction.guild);
  if (!channel) {
    await replyEphemeral(interaction, "Canal do ticket não encontrado.");
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (ACTIVE_TICKET_STATUSES.includes(ticket.status)) {
    ticket.status = "closed";
    ticket.closedAt = new Date();
    ticket.closedBy = interaction.user.id;
    ticket.closeReason = "Ticket excluído definitivamente.";
    await ticket.save();
    await logTicketAction(client, {
      ticket,
      action: "TICKET_CLOSE",
      executorId: interaction.user.id,
      metadata: {
        reason: ticket.closeReason,
      },
    });
  }

  const transcript = await generateAndSendTranscript(client, channel, ticket);
  await logTicketAction(client, {
    ticket,
    action: "TICKET_TRANSCRIPT",
    executorId: client.user.id,
    metadata: transcript,
  });

  await channel.delete(`Ticket excluído por ${interaction.user.tag || interaction.user.id}.`);
  await replyEphemeral(interaction, "Ticket excluído.");
}

async function showTicketInfo(interaction) {
  const ticket = await findTicketByChannel(interaction.channelId, interaction.guildId);
  if (!ticket) {
    await replyEphemeral(interaction, "Este canal não pertence a um ticket.");
    return;
  }

  const categoryConfig = getTicketCategoryConfig(ticket.categoryType) || {};
  await replyEphemeral(
    interaction,
    [
      `Ticket #${formatTicketNumber(ticket.ticketNumber)}`,
      `Categoria: ${categoryConfig.name || ticket.categoryType}`,
      `Dono: <@${ticket.ownerId}>`,
      `Status: ${ticket.status}`,
      `Responsável: ${ticket.assignedStaffId ? `<@${ticket.assignedStaffId}>` : "Não definido"}`,
    ].join("\n"),
  );
}

async function addBlacklistEntry(client, interaction, user, reason, days, permanent) {
  if (!isTicketAdministrator(interaction.member)) {
    await replyEphemeral(interaction, "Você não possui permissão para alterar a blacklist.");
    return;
  }

  const expiresAt = permanent ? null : new Date(Date.now() + Math.max(1, Number(days || 1)) * 86400000);

  await TicketBlacklist.findOneAndUpdate(
    {
      guildId: interaction.guildId,
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
    guildId: interaction.guildId,
    action: "TICKET_BLACKLIST_ADD",
    executorId: interaction.user.id,
    targetId: user.id,
    metadata: {
      reason,
      permanent,
      expiresAt,
    },
  });
  await replyEphemeral(interaction, `<@${user.id}> foi adicionado à blacklist de tickets.`);
}

async function removeBlacklistEntry(client, interaction, user) {
  if (!isTicketAdministrator(interaction.member)) {
    await replyEphemeral(interaction, "Você não possui permissão para alterar a blacklist.");
    return;
  }

  await TicketBlacklist.deleteOne({
    guildId: interaction.guildId,
    userId: user.id,
  });
  await logTicketAction(client, {
    guildId: interaction.guildId,
    action: "TICKET_BLACKLIST_REMOVE",
    executorId: interaction.user.id,
    targetId: user.id,
  });
  await replyEphemeral(interaction, `<@${user.id}> foi removido da blacklist de tickets.`);
}

async function showBlacklistEntry(interaction, user) {
  if (!isTicketAdministrator(interaction.member)) {
    await replyEphemeral(interaction, "Você não possui permissão para consultar a blacklist.");
    return;
  }

  const entry = await TicketBlacklist.findOne({
    guildId: interaction.guildId,
    userId: user.id,
  });

  if (!entry) {
    await replyEphemeral(interaction, "Este usuário não está na blacklist de tickets.");
    return;
  }

  await replyEphemeral(
    interaction,
    [
      `Usuário: <@${user.id}>`,
      `Motivo: ${entry.reason || "Não informado"}`,
      `Aplicado por: ${entry.staffId ? `<@${entry.staffId}>` : "Não informado"}`,
      `Expira: ${entry.permanent ? "Permanente" : entry.expiresAt?.toISOString() || "Não informado"}`,
    ].join("\n"),
  );
}

async function handleTicketChannelDelete(channel, client) {
  if (!channel?.guild || channel.type === ChannelType.GuildCategory) {
    return;
  }

  const ticket = await Ticket.findOne({
    guildId: channel.guildId,
    channelId: channel.id,
  });

  if (!ticket) {
    return;
  }

  if (ACTIVE_TICKET_STATUSES.includes(ticket.status)) {
    ticket.status = "closed";
    ticket.closedAt = new Date();
    ticket.closedBy = "";
    ticket.closeReason = "Canal do ticket excluído.";
    await ticket.save();
  }

  await logTicketAction(client, {
    ticket,
    action: "TICKET_DELETE",
    executorId: "",
    metadata: {
      channelId: channel.id,
      parentId: channel.parentId || ticket.categoryId,
    },
  });

  const categoryId = channel.parentId || ticket.categoryId;
  const removedCategory = await cleanupEmptyManagedCategory(channel.guild, categoryId);

  if (removedCategory) {
    await logTicketAction(client, {
      guildId: channel.guildId,
      action: "TICKET_CATEGORY_DELETE",
      executorId: client.user.id,
      targetId: categoryId,
    });
  }

  await refreshSupportPanel(client);
}

module.exports = {
  addBlacklistEntry,
  closeTicketFromCommand,
  deleteTicketFromCommand,
  handleTicketChannelDelete,
  handleTicketInteraction,
  initializeTickets,
  refreshSupportPanel,
  removeBlacklistEntry,
  reopenTicketFromCommand,
  showBlacklistEntry,
  showTicketInfo,
  upsertSupportPanel,
};
