const timers = require("node:timers/promises");

const {
  ChannelType,
  MessageFlags,
  PermissionsBitField,
} = require("discord.js");

const config = require("../config");
const { createLogger } = require("./logger");
const { readPanelState, upsertPanelMessage } = require("./panel-message");
const {
  ACTIVE_TICKET_STATUSES,
  TICKET_SYSTEM_VERSION,
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
  buildDeleteConfirmComponents,
  buildReviewModal,
  buildStaffChannelComponents,
  buildSupportPanelComponents,
  buildTicketArchivedComponents,
  buildTicketCallComponents,
  buildTicketClosedComponents,
  buildTicketManageComponents,
  getTicketManageOptions,
  buildTicketReviewComponents,
  buildUserSelectModal,
  getStatusLabel,
} = require("./ticket-components");
const {
  buildTicketChannelName,
  escapeDiscordText,
  formatTicketNumber,
  getTicketCategoryConfig,
} = require("./ticket-common");
const { logTicketAction } = require("./ticket-logger");
const { generateAndSendTranscript } = require("./ticket-transcript");
const {
  buildTicketOverwrites,
  getTicketNotificationRoleIds,
  isTicketAdministrator,
  isTicketSupport,
} = require("./ticket-permissions");

const { withCategoryLock, resolveTicketCategory, cleanupTicketCategory, orderCategories } = require("./ticket-categories");
const { buildTicketActionModal } = require("./ticket-components");
const log = createLogger("tickets");
const busyTickets = new Set();

async function withTicketAction(interaction, ticketId, operation) {
  if (busyTickets.has(ticketId)) return replyEphemeral(interaction, "Uma ação está em andamento neste ticket. Tente novamente em instantes.");
  busyTickets.add(ticketId);
  try { return await operation(); } finally { busyTickets.delete(ticketId); }
}

function ticketCommand(operation) {
  return async (client, interaction, ...args) => {
    const ticket = await findTicketByStaffChannel(interaction.channelId);
    if (!ticket) return replyEphemeral(interaction, "Este canal não pertence a um ticket.");
    return withTicketAction(interaction, ticket.ticketId, () => operation(client, interaction, ...args));
  };
}
const SAFE_ALLOWED_MENTIONS = {
  parse: [],
  repliedUser: false,
};
const DATABASE_CLEAR_CONFIRMATION = "CONFIRMAR";
const TICKET_DATABASE_COMMAND_GUILD_ID = "1541296952514187397";
const TICKET_DATABASE_CLEAR_SCOPES = {
  CURRENT_TICKET: "ticket-atual",
  USER: "usuario",
  ALL: "todos",
};

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

function getTicketDatabaseCommandGuildId() {
  return TICKET_DATABASE_COMMAND_GUILD_ID;
}

function getDeletedCount(result) {
  return Number(result?.deletedCount || 0);
}

function formatTicketDatabaseClearStats(stats) {
  return [
    `Tickets: ${stats.tickets}`,
    `Mensagens: ${stats.messages}`,
    `Avaliacoes: ${stats.reviews}`,
    `Logs: ${stats.logs}`,
    `Blacklist: ${stats.blacklist}`,
    `Contador: ${stats.counters}`,
  ].join("\n");
}

async function collectTicketIds(ticketQuery) {
  const tickets = await Ticket.find(ticketQuery).select("ticketId").lean();
  return tickets
    .map((ticket) => ticket.ticketId)
    .filter(Boolean);
}

async function assertTicketsCanBePurged(query) {
  if (await Ticket.exists({ ...query, $or: [{ status: { $in: ACTIVE_TICKET_STATUSES } }, { channelDeletedAt: null }] })) {
    throw new Error("Exclua os canais dos tickets antes de limpar seus registros.");
  }
}

async function clearAllTicketDatabaseRecords() {
  const guildId = getTicketDatabaseCommandGuildId();
  await assertTicketsCanBePurged({ guildId });
  const [tickets, messages, reviews, logs, blacklist, counters] = await Promise.all([
    Ticket.deleteMany({ guildId }),
    TicketMessage.deleteMany({ guildId }),
    TicketReview.deleteMany({ guildId }),
    TicketLog.deleteMany({ guildId }),
    TicketBlacklist.deleteMany({ guildId }),
    Promise.resolve({ deletedCount: 0 }),
  ]);

  return {
    tickets: getDeletedCount(tickets),
    messages: getDeletedCount(messages),
    reviews: getDeletedCount(reviews),
    logs: getDeletedCount(logs),
    blacklist: getDeletedCount(blacklist),
    counters: getDeletedCount(counters),
  };
}

async function clearScopedTicketDatabaseRecords(ticketQuery, options = {}) {
  const guildId = getTicketDatabaseCommandGuildId();
  const userId = options.userId || "";
  await assertTicketsCanBePurged(ticketQuery);
  const ticketIds = await collectTicketIds(ticketQuery);
  const ticketIdFilter = ticketIds.length
    ? {
        guildId,
        ticketId: {
          $in: ticketIds,
        },
      }
    : null;

  const logConditions = [];
  const reviewConditions = [];
  if (ticketIds.length) {
    logConditions.push({
      ticketId: {
        $in: ticketIds,
      },
    });
    reviewConditions.push({
      ticketId: {
        $in: ticketIds,
      },
    });
  }

  if (userId) {
    logConditions.push({ targetId: userId });
    reviewConditions.push({ userId });
  }

  const [tickets, messages, reviews, logs, blacklist] = await Promise.all([
    Ticket.deleteMany(ticketQuery),
    ticketIdFilter ? TicketMessage.deleteMany(ticketIdFilter) : Promise.resolve({ deletedCount: 0 }),
    reviewConditions.length
      ? TicketReview.deleteMany({
          guildId,
          $or: reviewConditions,
        })
      : Promise.resolve({ deletedCount: 0 }),
    logConditions.length
      ? TicketLog.deleteMany({
          guildId,
          $or: logConditions,
        })
      : Promise.resolve({ deletedCount: 0 }),
    userId ? TicketBlacklist.deleteMany({ guildId, userId }) : Promise.resolve({ deletedCount: 0 }),
  ]);

  return {
    tickets: getDeletedCount(tickets),
    messages: getDeletedCount(messages),
    reviews: getDeletedCount(reviews),
    logs: getDeletedCount(logs),
    blacklist: getDeletedCount(blacklist),
    counters: 0,
  };
}

function buildTicketScopeQuery(extraQuery = {}) {
  return {
    guildId: getTicketGuildId(),
    systemVersion: TICKET_SYSTEM_VERSION,
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
      ownerId: userId,
      status: {
        $in: ACTIVE_TICKET_STATUSES,
      },
    }),
  ).sort({ createdAt: -1 });
}

async function findTicketByStaffChannel(channelId) {
  return Ticket.findOne(
    buildTicketScopeQuery({
      channelId: channelId,
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

async function fetchStaffChannel(client, ticket) {
  if (!ticket?.channelId) {
    return null;
  }

  const channel =
    client.channels.cache.get(ticket.channelId) ||
    (await client.channels.fetch(ticket.channelId).catch(() => null));

  if (!isSendableTextChannel(channel) || channel.guildId !== ticket.guildId) {
    return null;
  }

  return channel;
}

async function refreshStaffChannelPanel(client, ticket) {
  const channel = await fetchStaffChannel(client, ticket);
  if (!channel) {
    return null;
  }

  const components = ticket.status === "closed"
    ? buildTicketArchivedComponents(ticket)
    : buildStaffChannelComponents(ticket);

  if (ticket.controlMessageId) {
    const message = await channel.messages.fetch(ticket.controlMessageId).catch(() => null);
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

  const message = await channel
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
    ticket.controlMessageId = message.id;
    await ticket.save();
  }

  return message;
}

async function fetchPanelChannel(client, preferredChannel = null) {
  if (isSendableTextChannel(preferredChannel)) {
    if (preferredChannel.guildId !== getTicketGuildId()) throw new Error("Publique o painel no servidor oficial de atendimento.");
    return preferredChannel;
  }

  const channelId = config.tickets.panelChannelId || (await readPanelState(config.tickets.panelMessageFilePath))?.channelId;
  if (!channelId) {
    return null;
  }

  const channel =
    client.channels.cache.get(channelId) ||
    (await client.channels.fetch(channelId).catch(() => null));

  if (!isSendableTextChannel(channel) || channel.guildId !== getTicketGuildId()) {
    log.warn(`Canal de painel de tickets invalido ou inacessivel: ${channelId}`);
    return null;
  }

  return channel;
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
  const message = await upsertPanelMessage({
    client, channel, components,
    customId: TICKET_CUSTOM_IDS.panelSelect,
    stateFilePath: config.tickets.panelMessageFilePath,
  });
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
    `Voce ja possui o ticket #${formatTicketNumber(ticket.ticketNumber)} em aberto. Continue em <#${ticket.channelId}>.`,
  );
}

async function validateBeforeOpening(interaction) {
  if (interaction.guildId !== getTicketGuildId()) {
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
      ownerId: interaction.user.id,
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
    ownerId: interaction.user.id,
    categoryType,
    ticketNumber,
    minecraftNick: formData.minecraftNick || "",
    formData,
    status: "open",
    systemVersion: TICKET_SYSTEM_VERSION,
  });
}

async function createStaffChannel(client, category, ticket, user) {
  const channel = await category.guild.channels.create({
    name: buildTicketChannelName(ticket, user), type: ChannelType.GuildText, parent: category.id,
    permissionOverwrites: buildTicketOverwrites(category.guild, ticket.categoryType, ticket.ownerId),
    topic: `Ticket ${ticket.ticketId} | Usuário ${ticket.ownerId} | Categoria ${ticket.categoryType}`,
    reason: `Ticket #${formatTicketNumber(ticket.ticketNumber)} aberto por ${user.id}`,
  });
  ticket.categoryId = category.id;
  ticket.channelId = channel.id;
  try {
    await ticket.save();
    const message = await channel.send({ flags: MessageFlags.IsComponentsV2,
      components: buildStaffChannelComponents(ticket),
      allowedMentions: { ...SAFE_ALLOWED_MENTIONS, roles: getTicketNotificationRoleIds(ticket.categoryType) } });
    ticket.controlMessageId = message.id;
    await ticket.save();
  } catch (error) {
    await channel.delete("Falha ao registrar o ticket").catch((failure) => log.error("Falha no rollback do canal", failure));
    throw error;
  }
  return channel;
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

async function createTicketFromModal(interaction, categoryType) {
  const categoryConfig = getTicketCategoryConfig(categoryType);
  if (!categoryConfig) {
    await replyEphemeral(interaction, "Categoria de atendimento invalida.");
    return true;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (interaction.guildId !== getTicketGuildId()) return true;

  let ticket = null;
  let staffChannel = null;

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

    const formData = extractFormData(interaction, categoryConfig);
    ticket = await reserveTicket(interaction, categoryType, formData);
    staffChannel = await withCategoryLock(async () => {
      const guild = await resolveStaffGuild(interaction.client);
      const category = await resolveTicketCategory(guild, categoryType);
      return createStaffChannel(interaction.client, category, ticket, interaction.user);
    });

    await recordSystemMessage(
      ticket,
      ["Ticket aberto pelo painel.", formDataToText(ticket, categoryConfig)].filter(Boolean).join("\n\n"),
      interaction.user.id,
    );

    await logTicketAction(interaction.client, {
      ticket,
      action: "TICKET_CREATE",
      executorId: interaction.user.id,
      metadata: {
        categoryId: ticket.categoryId,
        channelId: ticket.channelId,
        categoryType,
      },
    });

    await replyEphemeral(interaction, `Seu atendimento foi aberto em <#${ticket.channelId}>.`);
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

    if (ticket?.channelId) {
      ticket.status = "closed";
      ticket.closedAt = new Date();
      ticket.closedBy = interaction.client.user?.id || "";
      ticket.closeReason = "Falha ao concluir abertura do ticket.";
      await ticket.save().catch((failure) => log.error("Falha ao registrar rollback do ticket.", failure));
      const channel = staffChannel || await fetchStaffChannel(interaction.client, ticket);
      if (channel) {
        await channel.delete("Rollback de ticket apos falha na abertura.")
          .catch((failure) => log.error("Canal preservado após falha no rollback; registro mantido para recuperação.", failure));
      }
    } else if (ticket) {
      await Ticket.deleteOne({ _id: ticket._id }).catch((failure) => log.error("Falha ao liberar reserva do ticket.", failure));
    }
    if (ticket?.categoryId) {
      await withCategoryLock(async () => {
        const guild = await resolveStaffGuild(interaction.client);
        await cleanupTicketCategory(guild, ticket.categoryId);
      }).catch((failure) => log.error("Falha ao limpar categoria após abertura interrompida.", failure));
    }

    if (
      [
        "TICKET_GUILD_NOT_FOUND",
        "TICKET_CATEGORY_NOT_CONFIGURED",
        "TICKET_CATEGORY_INVALID",
        "TICKET_CATEGORY_PUBLIC",
      ].includes(error.code)
    ) {
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

async function requireTicketForInteraction(interaction, ticketId, { allowDm = false } = {}) {
  const ticket = await Ticket.findOne(
    buildTicketScopeQuery({
      ticketId,
    }),
  );

  if (
    !ticket ||
    (ticket.guildId !== interaction.guildId && !(allowDm && !interaction.guildId))
  ) {
    await replyEphemeral(interaction, "Ticket nao encontrado.");
    return null;
  }

  return ticket;
}

async function fetchInteractionMember(interaction, ticket) {
  const guild = interaction.guild || await interaction.client.guilds.fetch(ticket.guildId);
  return guild.members.fetch({ user: interaction.user.id, force: true });
}

async function requireStaff(interaction, ticket) {
  if (interaction.guildId !== ticket.guildId) {
    await replyEphemeral(interaction, "Use esta acao no servidor interno de atendimento.");
    return false;
  }

  const member = await fetchInteractionMember(interaction, ticket);
  const channel = await fetchStaffChannel(interaction.client, ticket);
  if (isTicketSupport(member, ticket.categoryType) && channel?.permissionsFor(member)?.has(PermissionsBitField.Flags.ViewChannel)) {
    return true;
  }

  await replyEphemeral(interaction, "Voce nao possui permissao para gerenciar este ticket.");
  return false;
}

async function findTicketForCurrentChannel(interaction) {
  if (!interaction.guildId || interaction.guildId !== getTicketGuildId()) {
    await replyEphemeral(interaction, "Use este comando dentro do canal interno de atendimento.");
    return null;
  }

  const ticket = await findTicketByStaffChannel(interaction.channelId);
  if (!ticket) {
    await replyEphemeral(interaction, "Este canal nao pertence a um ticket.");
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
      await refreshStaffChannelPanel(interaction.client, unclaimedTicket);
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

  await refreshStaffChannelPanel(interaction.client, updatedTicket);
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

  if (!ACTIVE_TICKET_STATUSES.includes(ticket.status)) return replyEphemeral(interaction, "Este ticket está fechado.");
  const titles = {
    "ticket:transfer-select": "Transferir atendimento",
    "ticket:add-user-select": "Adicionar usuário",
    "ticket:remove-user-select": "Remover usuário",
  };
  await interaction.showModal(buildUserSelectModal(`${action}-modal:${ticketId}`, titles[action], placeholder));
  return true;
}

async function handleTransferSelect(interaction, ticketId, targetId = interaction.values?.[0]) {
  const ticket = await requireTicketForInteraction(interaction, ticketId);
  if (!ticket || !(await requireStaff(interaction, ticket))) {
    return true;
  }

  const guild = interaction.guild || (await resolveStaffGuild(interaction.client));
  const targetMember = await guild.members.fetch(targetId).catch(() => null);

  if (!targetMember || !isTicketSupport(targetMember, ticket.categoryType)) {
    await replyEphemeral(interaction, "Selecione um membro da equipe com permissao para essa categoria.");
    return true;
  }

  if (!ACTIVE_TICKET_STATUSES.includes(ticket.status)) return replyEphemeral(interaction, "Este ticket está fechado.");
  const targetChannel = await fetchStaffChannel(interaction.client, ticket);
  if (!targetChannel?.permissionsFor(targetMember)?.has(PermissionsBitField.Flags.ViewChannel)) return replyEphemeral(interaction, "O atendente não tem acesso ao canal.");
  const oldStaffId = ticket.assignedStaffId || "";
  ticket.assignedStaffId = targetId;
  ticket.status = "claimed";
  ticket.pausedAt = null;
  ticket.pausedBy = "";
  await ticket.save();
  await refreshStaffChannelPanel(interaction.client, ticket);
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
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  }
  const ticket = await requireTicketForInteraction(interaction, ticketId);
  if (!ticket || !(await requireStaff(interaction, ticket))) {
    return true;
  }

  if (!ACTIVE_TICKET_STATUSES.includes(ticket.status)) {
    return replyEphemeral(interaction, "Este ticket está fechado.");
  }
  const callAt = new Date();
  const previousCallAt = ticket.lastCallAt || null;
  const cooldownLimit = new Date(callAt.getTime() - config.tickets.callCooldownMs);
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
        lastCallAt: callAt,
      },
    },
    { new: true },
  );

  if (!updatedTicket) {
    await replyEphemeral(interaction, "Aguarde o cooldown antes de chamar o jogador novamente.");
    return true;
  }

  let notification = null;
  let deliveryError = null;
  try {
    const owner = await interaction.client.users.fetch(ticket.ownerId);
    notification = await owner.send({
      flags: MessageFlags.IsComponentsV2,
      components: buildTicketCallComponents(updatedTicket),
      allowedMentions: { parse: [], users: [ticket.ownerId] },
    });
  } catch (error) {
    deliveryError = error;
    log.warn(`Não foi possível enviar a chamada do ticket ${ticketId} por DM.`, error);
    // Release only this reservation so a failed DM does not consume the cooldown.
    await Ticket.updateOne(
      buildTicketScopeQuery({ ticketId, lastCallAt: callAt }),
      { $set: { lastCallAt: previousCallAt } },
    );
  }

  await logTicketAction(interaction.client, {
    ticket: updatedTicket,
    action: "TICKET_CALL_USER",
    executorId: interaction.user.id,
    targetId: ticket.ownerId,
    metadata: {
      delivered: Boolean(notification),
      destination: "dm",
      errorCode: deliveryError?.code,
    },
  });
  await replyEphemeral(interaction, notification
    ? "Chamada enviada na DM do jogador com o botão para abrir o ticket."
    : deliveryError?.code === 50007
      ? "Não consegui enviar a chamada: a DM do jogador está bloqueada ou indisponível. Peça para ele permitir mensagens diretas e tente novamente."
      : "Não consegui enviar a chamada por DM. Tente novamente em instantes.");
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
  await refreshStaffChannelPanel(interaction.client, ticket);
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
  await refreshStaffChannelPanel(interaction.client, ticket);
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
  if (!ticket || !(await requireStaff(interaction, ticket))) return true;
  await replyEphemeral(interaction, "# Deseja realmente fechar este ticket?", {
    components: buildCloseConfirmComponents(ticketId),
  });
  return true;
}

async function sendTicketReview(client, ticket) {
  try {
    const user = await client.users.fetch(ticket.ownerId);
    return await user.send({ flags: MessageFlags.IsComponentsV2,
      components: buildTicketClosedComponents(ticket), allowedMentions: SAFE_ALLOWED_MENTIONS });
  } catch (error) {
    log.warn(`Não foi possível enviar a avaliação por DM do ticket ${ticket.ticketId}.`, error);
    return null;
  }
}

async function archiveTicketChannel(client, ticket) {
  return withCategoryLock(async () => {
    const guild = await resolveStaffGuild(client);
    const channels = await guild.channels.fetch();
    const category = channels.get(config.tickets.closedCategoryId);
    if (category?.type !== ChannelType.GuildCategory) throw new Error("Categoria de tickets fechados não encontrada.");
    const channel = await fetchStaffChannel(client, ticket);
    if (!channel) throw new Error("Canal do ticket não encontrado.");
    if (channel.parentId !== category.id && channels.filter((entry) => entry.parentId === category.id).size >= 50) {
      throw new Error("A categoria de tickets fechados está cheia.");
    }
    const user = await client.users.fetch(ticket.ownerId);
    const username = require("./ticket-common").normalizeDiscordName(user.username) || ticket.ownerId;
    const previousCategoryId = channel.parentId;
    await channel.edit({ parent: category.id, lockPermissions: false, name: `closed-${username}`.slice(0, 100),
      reason: "Arquivamento de ticket fechado" });
    ticket.categoryId = category.id;
    await ticket.save();
    await cleanupTicketCategory(guild, previousCategoryId);
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

  if (ACTIVE_TICKET_STATUSES.includes(ticket.status)) {
    const channel = await fetchStaffChannel(interaction.client, ticket);
    const countdownMessage = await channel.send({
      content: `## Este suporte será fechado em **${config.tickets.closeDelaySeconds}** segundos...`,
      allowedMentions: SAFE_ALLOWED_MENTIONS,
    });
    for (let remaining = config.tickets.closeDelaySeconds - 1; remaining >= 0; remaining -= 1) {
      await timers.setTimeout(1000);
      await countdownMessage.edit({
        content: remaining > 0
          ? `## Este suporte será fechado em **${remaining}** ${remaining === 1 ? "segundo" : "segundos"}...`
          : "## Fechando este suporte...",
        allowedMentions: SAFE_ALLOWED_MENTIONS,
      });
    }
  }

  let updatedTicket = await Ticket.findOneAndUpdate(
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
    if (ticket.status !== "closed" || ticket.finalizedAt) {
      await replyEphemeral(interaction, "Este ticket já está finalizado.");
      return true;
    }
    updatedTicket = ticket; // Retry an interrupted finalization without losing its reason/date.
  }

  await recordSystemMessage(
    updatedTicket,
    `Ticket fechado por ${interaction.user.id}. Motivo: ${updatedTicket.closeReason || "Resolvido"}.`,
    interaction.user.id,
  );

  const channel = await fetchStaffChannel(interaction.client, updatedTicket);
  for (const userId of [updatedTicket.ownerId, ...(updatedTicket.participantIds || [])]) {
    await channel.permissionOverwrites.edit(userId, { SendMessages: false, AttachFiles: false });
  }
  const transcript = await generateAndSendTranscript(interaction.client, updatedTicket);
  await logTicketAction(interaction.client, {
    ticket: updatedTicket,
    action: "TICKET_TRANSCRIPT",
    executorId: interaction.client.user.id,
    metadata: transcript,
  });

  await archiveTicketChannel(interaction.client, updatedTicket);

  const finalMessage = await sendTicketReview(interaction.client, updatedTicket);
  updatedTicket.finalMessageId = finalMessage?.id || "";
  await updatedTicket.save();

  await refreshStaffChannelPanel(interaction.client, updatedTicket);

  await logTicketAction(interaction.client, {
    ticket: updatedTicket,
    action: "TICKET_CLOSE",
    executorId: interaction.user.id,
    metadata: {
      reason: updatedTicket.closeReason,
      reviewMessageSent: Boolean(finalMessage),
    },
  });
  updatedTicket.finalizedAt = new Date();
  await updatedTicket.save();
  await replyEphemeral(
    interaction,
    finalMessage
      ? "Ticket arquivado, transcript salvo e avaliação enviada por DM."
      : "Ticket arquivado e transcript salvo. Não foi possível enviar a avaliação: a DM do usuário está indisponível.",
    { components: [] },
  );
  await refreshSupportPanel(interaction.client);
  return true;
}

async function confirmCloseTicket(interaction, ticketId) {
  await interaction.deferUpdate();
  return closeTicket(interaction, ticketId, "Fechamento confirmado pela equipe.");
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

  const activeTicket = await findActiveTicketByUser(ticket.ownerId);
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
          finalizedAt: null,
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

  const channel = await fetchStaffChannel(client, updatedTicket);
  await withCategoryLock(async () => {
    const category = await resolveTicketCategory(channel.guild, updatedTicket.categoryType);
    const user = await client.users.fetch(updatedTicket.ownerId);
    await channel.edit({ parent: category.id, lockPermissions: false, name: buildTicketChannelName(updatedTicket, user),
      reason: "Reabertura do ticket" });
    updatedTicket.categoryId = category.id;
    await updatedTicket.save();
  });
  for (const userId of [updatedTicket.ownerId, ...(updatedTicket.participantIds || [])]) {
    await channel.permissionOverwrites.edit(userId, { SendMessages: true, AttachFiles: true });
  }
  await refreshStaffChannelPanel(client, updatedTicket);
  await recordSystemMessage(updatedTicket, `Ticket reaberto por ${interaction.user.id}.`, interaction.user.id);

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
      : "Transcript salvo localmente e anexado abaixo.",
    { files: [transcript.filePath] },
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

  if (interaction.user.id !== ticket.ownerId || ticket.status !== "closed") {
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

  if (interaction.user.id !== ticket.ownerId || ticket.status !== "closed") {
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

  if (config.tickets.reviewChannelId && ticket.categoryType !== "coordination") {
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

  return handleTicketAction(interaction, ticketId, action);
}

async function handleTicketAction(interaction, ticketId, action) {

  if (action === "add-user" || action === "remove-user") {
    return sendUserSelect(interaction, ticketId, `ticket:${action}-select`, "Selecione o usuário");
  }
  if (action === "rename") {
    const ticket = await requireTicketForInteraction(interaction, ticketId);
    if (!ticket || !(await requireStaff(interaction, ticket))) return true;
    await interaction.showModal(buildTicketActionModal(ticketId, "rename", "Renomear ticket", "Nome do canal", 90));
    return true;
  }
  if (action === "delete" || action === "delete-confirm") return deleteTicketChannel(interaction, ticketId, action === "delete-confirm");
  if (action === "delete-cancel") return replyEphemeral(interaction, "Exclusão cancelada.", { components: [] });

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

  if (action === "manage-select") {
    const ticket = await requireTicketForInteraction(interaction, ticketId);
    if (!ticket || !(await requireStaff(interaction, ticket))) return true;
    const selectedAction = interaction.values?.[0];
    if (!getTicketManageOptions(ticket).some((option) => option.value === selectedAction)) {
      return replyEphemeral(interaction, "Esta ação não está disponível para o estado atual do ticket.");
    }
    return handleTicketAction(interaction, ticketId, selectedAction);
  }

  if (action === "review") return handleReviewSelect(interaction, ticketId);

  return false;
}

async function handleTicketUserSelect(interaction) {
  if (!interaction.customId?.startsWith("ticket:")) {
    return false;
  }

  const [, action, ticketId] = interaction.customId.split(":");

  if (action === "transfer-select") return handleTransferSelect(interaction, ticketId);
  if (action === "add-user-select" || action === "remove-user-select") return changeTicketParticipant(interaction, ticketId, action === "add-user-select");

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

  if (["transfer-select-modal", "add-user-select-modal", "remove-user-select-modal"].includes(action)) {
    const targetId = interaction.fields.getSelectedUsers("target-user", true).firstKey();
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (action === "transfer-select-modal") return handleTransferSelect(interaction, ticketId, targetId);
    return changeTicketParticipant(interaction, ticketId, action === "add-user-select-modal", targetId);
  }

  if (action === "review-modal") return handleReviewModal(interaction, ticketId, rating);
  if (action === "close-modal") {
    const reason = String(interaction.fields.getTextInputValue("value") || "").trim();
    if (!reason || reason.length > 700) return replyEphemeral(interaction, "Informe um motivo de até 700 caracteres.");
    return closeTicket(interaction, ticketId, reason);
  }
  if (action === "rename-modal") {
    const ticket = await requireTicketForInteraction(interaction, ticketId);
    if (!ticket || !(await requireStaff(interaction, ticket))) return true;
    if (!ACTIVE_TICKET_STATUSES.includes(ticket.status)) return replyEphemeral(interaction, "Este ticket está fechado.");
    const name = require("./ticket-common").normalizeDiscordName(interaction.fields.getTextInputValue("value"));
    if (!name) return replyEphemeral(interaction, "Informe um nome válido.");
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const channel = await fetchStaffChannel(interaction.client, ticket);
    await channel.setName(name, `Ticket renomeado por ${interaction.user.id}`);
    await logTicketAction(interaction.client, { ticket, action: "TICKET_RENAME", executorId: interaction.user.id, metadata: { name } });
    return replyEphemeral(interaction, `Canal renomeado para ${name}.`);
  }

  return false;
}

async function handleTicketInteraction(interaction) {
  if (!config.tickets.enabled || !interaction.customId?.startsWith("ticket:")) {
    return false;
  }

  try {
    const dispatch = async () => {
      if (interaction.isStringSelectMenu()) return handleTicketStringSelect(interaction);
      if (interaction.isButton()) return handleTicketButton(interaction);
      if (interaction.isUserSelectMenu()) return handleTicketUserSelect(interaction);
      if (interaction.isModalSubmit()) return handleTicketModalSubmit(interaction);
      return false;
    };
    const [, action, ticketId] = interaction.customId.split(":");
    if (ticketId && action !== "category-modal") return await withTicketAction(interaction, ticketId, dispatch);
    return await dispatch();
  } catch (error) {
    log.error("Falha ao processar interacao de ticket.", error);
    await replyEphemeral(interaction, "Nao foi possivel processar essa acao agora.");
    return true;
  }

  return false;
}

async function changeTicketParticipant(interaction, ticketId, adding, targetId = interaction.values?.[0]) {
  const ticket = await requireTicketForInteraction(interaction, ticketId);
  if (!ticket || !(await requireStaff(interaction, ticket))) return true;
  if (!ACTIVE_TICKET_STATUSES.includes(ticket.status)) return replyEphemeral(interaction, "Este ticket está fechado.");
  const member = await interaction.guild.members.fetch({ user: targetId, force: true });
  if (member.user.bot || targetId === ticket.ownerId || isTicketSupport(member, ticket.categoryType)) {
    return replyEphemeral(interaction, "O titular, o bot e a equipe mantêm o acesso definido pelas permissões do ticket.");
  }
  if (ticket.categoryType === "coordination") {
    return replyEphemeral(interaction, "Tickets de Coordenação são restritos ao titular, Coordenação e Administração.");
  }
  if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const channel = await fetchStaffChannel(interaction.client, ticket);
  await channel.permissionOverwrites.edit(targetId, {
    ViewChannel: adding, SendMessages: adding, AttachFiles: adding, ReadMessageHistory: adding,
  });
  await Ticket.updateOne({ ticketId }, adding ? { $addToSet: { participantIds: targetId } } : { $pull: { participantIds: targetId } });
  await logTicketAction(interaction.client, { ticket, action: adding ? "TICKET_ADD_USER" : "TICKET_REMOVE_USER", executorId: interaction.user.id, targetId });
  return replyEphemeral(interaction, adding ? "Usuário adicionado ao ticket." : "Usuário removido do ticket.");
}

async function deleteTicketChannel(interaction, ticketId, confirmed) {
  const ticket = await requireTicketForInteraction(interaction, ticketId);
  if (!ticket || !(await requireStaff(interaction, ticket))) return true;
  if (ticket.status !== "closed") return replyEphemeral(interaction, "Feche o ticket antes de excluir o canal.");
  if (!ticket.finalizedAt) return replyEphemeral(interaction, "Conclua o fechamento com /ticket fechar antes de excluir o canal.");
  if (!confirmed) return replyEphemeral(interaction, "Excluir definitivamente o canal? O transcript será preservado.", { components: buildDeleteConfirmComponents(ticketId) });
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  return withCategoryLock(async () => {
    const current = await Ticket.findOne(buildTicketScopeQuery({ ticketId }));
    if (current?.status !== "closed") return replyEphemeral(interaction, "O ticket foi reaberto; a exclusão foi cancelada.");
    const channel = await fetchStaffChannel(interaction.client, current);
    if (!channel || channel.type !== ChannelType.GuildText) return replyEphemeral(interaction, "Canal do ticket não encontrado.");
    await generateAndSendTranscript(interaction.client, current);
    await logTicketAction(interaction.client, { ticket: current, action: "TICKET_DELETE", executorId: interaction.user.id });
    await replyEphemeral(interaction, "Transcript salvo. Excluindo o canal.");
    await channel.delete(`Ticket excluído por ${interaction.user.id}`);
    current.channelDeletedAt = new Date();
    await current.save();
    await cleanupTicketCategory(channel.guild, channel.parentId);
  });
}

async function handleTicketChannelDelete(channel, client) {
  if (!config.tickets.enabled || channel.guildId !== getTicketGuildId()) return;
  try {
    await withCategoryLock(async () => {
      const ticket = await Ticket.findOne(buildTicketScopeQuery({ channelId: channel.id }));
      if (ticket && ACTIVE_TICKET_STATUSES.includes(ticket.status)) {
        ticket.status = "closed"; ticket.closedAt = new Date();
        ticket.closedBy = client.user.id; ticket.closeReason = "Canal excluído diretamente no Discord.";
        await ticket.save();
        await logTicketAction(client, { ticket, action: "TICKET_CHANNEL_REMOVED", executorId: client.user.id });
      }
      if (ticket) { ticket.channelDeletedAt = new Date(); await ticket.save(); }
      await cleanupTicketCategory(channel.guild, channel.parentId);
    });
    await refreshSupportPanel(client);
  } catch (error) {
    log.error("Falha ao reconciliar exclusão de canal de ticket.", error);
  }
}

async function initializeTickets(client) {
  if (!config.tickets.enabled) return;
  await ensureTicketIndexes();
  const latest = await Ticket.findOne({ guildId: getTicketGuildId() }).sort({ ticketNumber: -1 });
  await TicketCounter.findOneAndUpdate({ guildId: getTicketGuildId() },
    { $max: { seq: latest?.ticketNumber || 0 } }, { upsert: true, setDefaultsOnInsert: false });
  const guild = await resolveStaffGuild(client);
  await withCategoryLock(async () => {
    await orderCategories(guild);
    const tickets = await Ticket.find(buildTicketScopeQuery());
    const channels = await guild.channels.fetch();
    for (const ticket of tickets) {
      if (ticket.channelId && !channels.has(ticket.channelId) && ACTIVE_TICKET_STATUSES.includes(ticket.status)) {
        ticket.status = "closed"; ticket.closedAt = new Date();
        ticket.closedBy = client.user.id; ticket.closeReason = "Canal removido enquanto o bot estava offline.";
        ticket.channelDeletedAt = new Date();
        await ticket.save();
      }
    }
    const { TicketCategory } = require("./ticket-models");
    for (const record of await TicketCategory.find({ guildId: guild.id })) {
      await cleanupTicketCategory(guild, record.discordCategoryId);
    }
  });
  await upsertSupportPanel(client);
  log.info("Sistema de tickets por canais privados inicializado.");
}

async function clearTicketDatabaseFromCommand(client, interaction, options = {}) {
  const allowedGuildId = getTicketDatabaseCommandGuildId();

  if (!interaction.guildId || interaction.guildId !== allowedGuildId) {
    await replyEphemeral(interaction, `Use este comando apenas no servidor ${allowedGuildId}.`);
    return;
  }

  if (!isTicketAdministrator(interaction.member)) {
    await replyEphemeral(interaction, "Voce nao possui permissao para limpar o banco de dados de tickets.");
    return;
  }

  if (String(options.confirmation || "").trim().toUpperCase() !== DATABASE_CLEAR_CONFIRMATION) {
    await replyEphemeral(interaction, "Digite CONFIRMAR no campo de confirmacao para limpar o banco de dados.");
    return;
  }

  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);
  }

  const guildId = allowedGuildId;
  let stats = null;
  let targetLabel = "";

  if (options.scope === TICKET_DATABASE_CLEAR_SCOPES.CURRENT_TICKET) {
    const ticket = await Ticket.findOne({
      guildId,
      channelId: interaction.channelId,
    }).sort({ createdAt: -1 });

    if (!ticket) {
      await replyEphemeral(interaction, "Este canal nao pertence a um ticket do servidor permitido.");
      return;
    }

    stats = await clearScopedTicketDatabaseRecords({
      guildId,
      ticketId: ticket.ticketId,
    });
    targetLabel = `ticket #${formatTicketNumber(ticket.ticketNumber)}`;
  } else if (options.scope === TICKET_DATABASE_CLEAR_SCOPES.USER) {
    if (!options.user) {
      await replyEphemeral(interaction, "Informe o usuario que tera os dados limpos.");
      return;
    }

    stats = await clearScopedTicketDatabaseRecords(
      {
        guildId,
        ownerId: options.user.id,
      },
      {
        userId: options.user.id,
      },
    );
    targetLabel = `usuario <@${options.user.id}>`;
  } else if (options.scope === TICKET_DATABASE_CLEAR_SCOPES.ALL) {
    stats = await clearAllTicketDatabaseRecords();
    targetLabel = "todo o sistema de tickets";
  } else {
    await replyEphemeral(interaction, "Escopo de limpeza invalido.");
    return;
  }

  await refreshSupportPanel(client).catch((error) => {
    log.warn("Nao foi possivel atualizar o painel apos limpar o banco de tickets.", error);
  });

  log.warn(`Banco de tickets limpo por ${interaction.user.id}. Escopo: ${options.scope}.`, stats);

  await replyEphemeral(
    interaction,
    [
      `Banco de dados limpo: ${targetLabel}.`,
      formatTicketDatabaseClearStats(stats),
      "Isso nao apaga canais, mensagens ja enviadas no Discord ou arquivos de transcript ja publicados.",
    ].join("\n"),
  );
}

async function showTicketInfo(interaction) {
  const ticket = await findTicketForCurrentChannel(interaction);
  if (!ticket || !(await requireStaff(interaction, ticket))) {
    return;
  }

  const categoryConfig = getTicketCategoryConfig(ticket.categoryType) || {};
  await replyEphemeral(
    interaction,
    [
      `Ticket #${formatTicketNumber(ticket.ticketNumber)}`,
      `Categoria: ${categoryConfig.name || ticket.categoryType}`,
      `Jogador: <@${ticket.ownerId}>`,
      `Status: ${getStatusLabel(ticket.status)}`,
      `Responsavel: ${ticket.assignedStaffId ? `<@${ticket.assignedStaffId}>` : "Nao definido"}`,
      `Canal: <#${ticket.channelId}>`,
    ].join("\n"),
  );
}

async function closeTicketFromCommand(client, interaction, reason) {
  const ticket = await findTicketForCurrentChannel(interaction);
  if (!ticket) {
    return;
  }

  if (!reason?.trim()) return showCloseConfirmation(interaction, ticket.ticketId);
  await closeTicket(interaction, ticket.ticketId, reason);
  await refreshSupportPanel(client);
}

async function reopenTicketFromCommand(client, interaction) {
  const ticket = await findTicketForCurrentChannel(interaction);
  if (!ticket) {
    return;
  }

  await reopenTicket(client, interaction, ticket);
}

async function pauseTicketFromCommand(client, interaction) {
  const ticket = await findTicketForCurrentChannel(interaction);
  if (!ticket) {
    return;
  }

  await pauseTicket(interaction, ticket.ticketId);
  await refreshSupportPanel(client);
}

async function resumeTicketFromCommand(client, interaction) {
  const ticket = await findTicketForCurrentChannel(interaction);
  if (!ticket) {
    return;
  }

  await resumeTicket(interaction, ticket.ticketId);
  await refreshSupportPanel(client);
}

async function sendTranscriptFromCommand(client, interaction) {
  const ticket = await findTicketForCurrentChannel(interaction);
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
  clearTicketDatabaseFromCommand,
  closeTicketFromCommand: ticketCommand(closeTicketFromCommand),
  handleTicketInteraction,
  handleTicketChannelDelete,
  initializeTickets,
  pauseTicketFromCommand: ticketCommand(pauseTicketFromCommand),
  refreshSupportPanel,
  removeBlacklistEntry,
  reopenTicketFromCommand: ticketCommand(reopenTicketFromCommand),
  resumeTicketFromCommand: ticketCommand(resumeTicketFromCommand),
  sendTranscriptFromCommand: ticketCommand(sendTranscriptFromCommand),
  showBlacklistEntry,
  showTicketInfo,
  upsertSupportPanel,
};
