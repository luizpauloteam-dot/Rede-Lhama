const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  ContainerBuilder,
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  ThumbnailBuilder,
  UserSelectMenuBuilder,
} = require("discord.js");

const config = require("../config");
const {
  escapeDiscordText,
  formatDateTime,
  formatTicketNumber,
  getTicketCategoryConfig,
  listTicketCategoryEntries,
  resolveWaitLevel,
} = require("./ticket-common");

const TICKET_CUSTOM_IDS = {
  panelSelect: "ticket:panel-select",
  categoryModalPrefix: "ticket:category-modal",
  claimPrefix: "ticket:claim",
  transferPrefix: "ticket:transfer",
  transferSelectPrefix: "ticket:transfer-select",
  callUserPrefix: "ticket:call-user",
  pausePrefix: "ticket:pause",
  resumePrefix: "ticket:resume",
  closePrefix: "ticket:close",
  closeConfirmPrefix: "ticket:close-confirm",
  closeCancelPrefix: "ticket:close-cancel",
  managePrefix: "ticket:manage",
  reopenPrefix: "ticket:reopen",
  reviewPrefix: "ticket:review",
  reviewModalPrefix: "ticket:review-modal",
  transcriptPrefix: "ticket:transcript",
};

function buildText(content) {
  return {
    type: ComponentType.TextDisplay,
    content,
  };
}

function buildSection(contents, accessory = null) {
  const section = {
    type: ComponentType.Section,
    components: contents.map(buildText),
  };

  if (accessory) {
    section.accessory = accessory;
  }

  return section;
}

function buildSeparator() {
  return {
    type: ComponentType.Separator,
    divider: true,
    spacing: 1,
  };
}

function buildMediaGallery(url, description) {
  if (!url) {
    return null;
  }

  return {
    type: ComponentType.MediaGallery,
    items: [
      {
        media: {
          url,
        },
        description,
      },
    ],
  };
}

function buildDisabledBadge(customId, label, style = ButtonStyle.Secondary) {
  return new ButtonBuilder()
    .setCustomId(customId)
    .setLabel(label)
    .setStyle(style)
    .setDisabled(true)
    .toJSON();
}

function buildThumbnail(url, description) {
  if (!url) {
    return null;
  }

  return new ThumbnailBuilder()
    .setURL(url)
    .setDescription(description)
    .toJSON();
}

function getFormValue(formData, key) {
  if (typeof formData?.get === "function") {
    return formData.get(key);
  }

  return formData?.[key];
}

function formDataToDisplayLines(ticket, categoryConfig) {
  const lines = [];

  for (const field of categoryConfig.modalFields || []) {
    const value = escapeDiscordText(getFormValue(ticket.formData, field.id));
    if (!value) {
      continue;
    }

    lines.push(`**${field.label}:** ${value}`);
  }

  return lines;
}

function getStatusLabel(status) {
  const labels = {
    open: "Aberto",
    claimed: "Assumido",
    paused: "Pausado",
    closed: "Fechado",
    legacy_closed: "Legado fechado",
  };

  return labels[status] || status || "Desconhecido";
}

function buildSupportPanelComponents({ openTicketCount }) {
  const waitLevel = resolveWaitLevel(openTicketCount);
  const openTicketLabel = `${openTicketCount} ticket${Number(openTicketCount) === 1 ? "" : "s"}`;
  const media = buildMediaGallery(config.tickets.bannerUrl, "Banner de atendimento da Rede Lhama");
  const select = new StringSelectMenuBuilder()
    .setCustomId(TICKET_CUSTOM_IDS.panelSelect)
    .setPlaceholder("Selecione o tipo de atendimento")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      listTicketCategoryEntries().map((category) => ({
        label: category.name,
        value: category.type,
        description: category.description,
        emoji: category.emoji,
      })),
    );

  const containerComponents = [
    buildText(
      [
        "# Central de Atendimento",
        "Selecione a categoria correta e mantenha a DM do bot aberta. O atendimento acontece somente pelo privado.",
      ].join("\n"),
    ),
    buildSeparator(),
    buildText(
      [
        "**Horario de atendimento**",
        "- Dias uteis: 10:00 as 20:00 (UTC-3)",
        "- Fins de semana e feriados: 10:00 as 16:00 (UTC-3)",
      ].join("\n"),
    ),
    buildText(
      [
        `Temos \`${openTicketLabel}\` ativos. A fila esta com movimento \`${waitLevel}\`.`,
        "A equipe responde por ordem de chegada.",
      ].join("\n"),
    ),
  ];

  if (media) {
    containerComponents.push(buildSeparator(), media);
  }

  containerComponents.push(new ActionRowBuilder().addComponents(select).toJSON());

  const container = new ContainerBuilder({
    accent_color: config.tickets.accentColor,
    components: containerComponents,
  });

  return [container.toJSON()];
}

function buildStaffActionRow(ticket) {
  const disabled = ticket.status === "closed" || ticket.status === "legacy_closed";
  const row = new ActionRowBuilder();

  if (!ticket.assignedStaffId && !disabled && ticket.status !== "paused") {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${TICKET_CUSTOM_IDS.claimPrefix}:${ticket.ticketId}`)
        .setLabel("Assumir")
        .setStyle(ButtonStyle.Success),
    );
  }

  row.addComponents(
    new ButtonBuilder()
      .setCustomId(`${TICKET_CUSTOM_IDS.managePrefix}:${ticket.ticketId}`)
      .setLabel("Gerenciar")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`${TICKET_CUSTOM_IDS.closePrefix}:${ticket.ticketId}`)
      .setLabel("Fechar")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),
  );

  return row.toJSON();
}

function buildStaffThreadComponents(ticket) {
  const categoryConfig = getTicketCategoryConfig(ticket.categoryType) || {};
  const categoryName = categoryConfig.name || ticket.categoryType;
  const assignedStaff = ticket.assignedStaffId ? `<@${ticket.assignedStaffId}>` : "Aguardando";
  const formLines = formDataToDisplayLines(ticket, categoryConfig);
  const components = [
    buildSection(
      [
        `# Ticket #${formatTicketNumber(ticket.ticketNumber)}`,
        `**Jogador:** <@${ticket.userId}>\n**Categoria:** ${categoryName}`,
      ],
      buildDisabledBadge(`ticket:badge:${ticket.ticketId}:status`, getStatusLabel(ticket.status)),
    ),
    buildText(
      [
        `**Responsavel:** ${assignedStaff}`,
        `**Aberto em:** ${formatDateTime(ticket.createdAt)}`,
        `**Sistema:** ${ticket.systemVersion || "modmail-v2"}`,
      ].join("\n"),
    ),
  ];

  if (formLines.length) {
    components.push(
      buildSeparator(),
      buildText(["**Formulario**", ...formLines.map((line) => `- ${line}`)].join("\n")),
    );
  }

  components.push(
    buildSeparator(),
    buildText("Responda nesta thread para enviar mensagem ao jogador por DM."),
    buildStaffActionRow(ticket),
  );

  const container = new ContainerBuilder({
    accent_color: config.tickets.accentColor,
    components,
  });

  return [container.toJSON()];
}

function buildDmWelcomeComponents(ticket) {
  const categoryConfig = getTicketCategoryConfig(ticket.categoryType) || {};
  const formLines = formDataToDisplayLines(ticket, categoryConfig);
  const components = [
    buildText(
      [
        `# Ticket #${formatTicketNumber(ticket.ticketNumber)} aberto`,
        `Categoria: **${categoryConfig.name || ticket.categoryType}**`,
        "A equipe recebeu sua solicitacao. Envie novas mensagens aqui nesta DM para continuar o atendimento.",
      ].join("\n"),
    ),
  ];

  if (formLines.length) {
    components.push(
      buildSeparator(),
      buildText(["**Resumo enviado**", ...formLines.map((line) => `- ${line}`)].join("\n")),
    );
  }

  const container = new ContainerBuilder({
    accent_color: config.tickets.accentColor,
    components,
  });

  return [container.toJSON()];
}

function buildTicketManageComponents(ticket) {
  const disabled = ticket.status === "closed" || ticket.status === "legacy_closed";
  const pauseButton = ticket.status === "paused"
    ? new ButtonBuilder()
        .setCustomId(`${TICKET_CUSTOM_IDS.resumePrefix}:${ticket.ticketId}`)
        .setLabel("Retomar")
        .setStyle(ButtonStyle.Success)
    : new ButtonBuilder()
        .setCustomId(`${TICKET_CUSTOM_IDS.pausePrefix}:${ticket.ticketId}`)
        .setLabel("Pausar")
        .setStyle(ButtonStyle.Secondary);

  const container = new ContainerBuilder({
    accent_color: config.tickets.accentColor,
    components: [
      buildSection(
        [
          `# Gerenciar ticket #${formatTicketNumber(ticket.ticketNumber)}`,
          `**Status:** ${getStatusLabel(ticket.status)}\n**Responsavel:** ${ticket.assignedStaffId ? `<@${ticket.assignedStaffId}>` : "Aguardando"}`,
        ],
        buildDisabledBadge(`ticket:badge:${ticket.ticketId}:staff`, "Equipe"),
      ),
      buildText("Escolha a acao para este atendimento."),
      new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`${TICKET_CUSTOM_IDS.transferPrefix}:${ticket.ticketId}`)
            .setLabel("Transferir")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(disabled),
          new ButtonBuilder()
            .setCustomId(`${TICKET_CUSTOM_IDS.callUserPrefix}:${ticket.ticketId}`)
            .setLabel("Chamar jogador")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(disabled),
          new ButtonBuilder()
            .setCustomId(`${TICKET_CUSTOM_IDS.transcriptPrefix}:${ticket.ticketId}`)
            .setLabel("Transcript")
            .setStyle(ButtonStyle.Secondary),
          pauseButton.setDisabled(disabled),
        )
        .toJSON(),
    ],
  });

  return [container.toJSON()];
}

function buildCloseConfirmComponents(ticketId) {
  return [
    new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`${TICKET_CUSTOM_IDS.closeConfirmPrefix}:${ticketId}`)
          .setLabel("Confirmar")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`${TICKET_CUSTOM_IDS.closeCancelPrefix}:${ticketId}`)
          .setLabel("Cancelar")
          .setStyle(ButtonStyle.Danger),
      )
      .toJSON(),
  ];
}

function buildTicketClosedComponents(ticket) {
  const categoryConfig = getTicketCategoryConfig(ticket.categoryType) || {};
  const closedBy = config.tickets.showStaffIdentity && ticket.closedBy ? `<@${ticket.closedBy}>` : "Equipe";
  const containerComponents = [
    buildText(
      [
        `# Ticket #${formatTicketNumber(ticket.ticketNumber)} finalizado`,
        `Obrigado pelo contato. Se precisar de ajuda novamente, abra outro atendimento pelo painel.`,
      ].join("\n"),
    ),
    buildSeparator(),
    buildText(
      [
        "**Resumo**",
        `> **Categoria:** ${categoryConfig.name || ticket.categoryType}`,
        `> **Fechado por:** ${closedBy}`,
        `> **Motivo:** ${escapeDiscordText(ticket.closeReason) || "Resolvido"}`,
      ].join("\n"),
    ),
  ];
  const media = buildMediaGallery(config.tickets.closedBannerUrl, "Banner de atendimento finalizado");

  if (media) {
    containerComponents.push(buildSeparator(), media);
  }

  containerComponents.push(
    buildSeparator(),
    buildText("**Avalie este atendimento**\nSelecione uma nota para continuar."),
    buildReviewSelectRow(ticket.ticketId),
  );

  const container = new ContainerBuilder({
    accent_color: config.tickets.accentColor,
    components: containerComponents,
  });

  return [container.toJSON()];
}

function buildTicketArchivedComponents(ticket) {
  const categoryConfig = getTicketCategoryConfig(ticket.categoryType) || {};
  const container = new ContainerBuilder({
    accent_color: config.tickets.accentColor,
    components: [
      buildSection(
        [
          `# Ticket #${formatTicketNumber(ticket.ticketNumber)} fechado`,
          `**Categoria:** ${categoryConfig.name || ticket.categoryType}\n**Motivo:** ${escapeDiscordText(ticket.closeReason) || "Resolvido"}`,
        ],
        buildDisabledBadge(`ticket:badge:${ticket.ticketId}:closed`, "Fechado"),
      ),
      buildText(
        [
          `**Fechado por:** ${ticket.closedBy ? `<@${ticket.closedBy}>` : "Nao informado"}`,
          `**Fechado em:** ${ticket.closedAt ? formatDateTime(ticket.closedAt) : "Agora"}`,
        ].join("\n"),
      ),
      new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`${TICKET_CUSTOM_IDS.reopenPrefix}:${ticket.ticketId}`)
            .setLabel("Reabrir")
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`${TICKET_CUSTOM_IDS.transcriptPrefix}:${ticket.ticketId}`)
            .setLabel("Transcript")
            .setStyle(ButtonStyle.Secondary),
        )
        .toJSON(),
    ],
  });

  return [container.toJSON()];
}

function buildReviewSelectRow(ticketId) {
  const options = [
    { rating: 1, description: "Muito ruim" },
    { rating: 2, description: "Ruim" },
    { rating: 3, description: "Regular" },
    { rating: 4, description: "Bom" },
    { rating: 5, description: "Excelente" },
  ];

  return new ActionRowBuilder()
    .addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`${TICKET_CUSTOM_IDS.reviewPrefix}:${ticketId}`)
        .setPlaceholder("Escolha sua nota")
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(
          options.map(({ rating, description }) => ({
            label: `${rating} estrela${rating === 1 ? "" : "s"}`,
            value: String(rating),
            description,
          })),
        ),
    )
    .toJSON();
}

function buildTicketReviewComponents({ ticket, rating, userId, userAvatarUrl, comment }) {
  const ratingNumber = Number.parseInt(rating, 10);
  const safeRating = Number.isFinite(ratingNumber) ? Math.min(5, Math.max(1, ratingNumber)) : 1;
  const reviewerThumbnail = buildThumbnail(userAvatarUrl, "Avatar de quem abriu o ticket");
  const components = [
    reviewerThumbnail
      ? buildSection(["# Nova avaliacao de ticket"], reviewerThumbnail)
      : buildText("# Nova avaliacao de ticket"),
    buildSeparator(),
    buildText(
      [
        `**Nota:** ${safeRating}/5`,
        `**Usuario:** <@${userId}>`,
        `**Atendente:** ${ticket.assignedStaffId ? `<@${ticket.assignedStaffId}>` : "Nao informado"}`,
      ].join("\n"),
    ),
  ];

  const safeComment = escapeDiscordText(comment);
  if (safeComment) {
    components.push(buildSeparator(), buildText(`**Comentario**\n${safeComment}`));
  }

  const container = new ContainerBuilder({
    accent_color: config.tickets.accentColor,
    components,
  });

  return [container.toJSON()];
}

function buildCategoryModal(categoryType) {
  const categoryConfig = getTicketCategoryConfig(categoryType);
  if (!categoryConfig) {
    throw new Error(`Categoria de ticket invalida: ${categoryType}`);
  }

  const modal = new ModalBuilder()
    .setCustomId(`${TICKET_CUSTOM_IDS.categoryModalPrefix}:${categoryType}`)
    .setTitle(categoryConfig.modalTitle || categoryConfig.name);

  for (const field of categoryConfig.modalFields) {
    modal.addComponents(buildLabelTextInput(field));
  }

  return modal;
}

function buildLabelTextInput(field) {
  const input = new TextInputBuilder()
    .setCustomId(field.id)
    .setStyle(field.style === "paragraph" ? TextInputStyle.Paragraph : TextInputStyle.Short)
    .setRequired(Boolean(field.required));

  if (field.placeholder) input.setPlaceholder(field.placeholder);
  if (field.minLength) input.setMinLength(field.minLength);
  if (field.maxLength) input.setMaxLength(field.maxLength);

  return new LabelBuilder()
    .setLabel(field.label)
    .setTextInputComponent(input);
}

function buildReviewModal(ticketId, rating) {
  return new ModalBuilder()
    .setCustomId(`${TICKET_CUSTOM_IDS.reviewModalPrefix}:${ticketId}:${rating}`)
    .setTitle(`Avaliacao ${rating}/5`)
    .addComponents(
      buildLabelTextInput({
        id: "comment",
        label: "Comentario opcional",
        style: "paragraph",
        maxLength: 700,
        required: false,
      }),
    );
}

function buildUserSelectRow(customId, placeholder) {
  return new ActionRowBuilder()
    .addComponents(
      new UserSelectMenuBuilder()
        .setCustomId(customId)
        .setPlaceholder(placeholder)
        .setMinValues(1)
        .setMaxValues(1),
    )
    .toJSON();
}

module.exports = {
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
};
