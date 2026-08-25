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
} = require("./ticket-common");

const TICKET_CUSTOM_IDS = {
  panelSelect: "ticket:panel-select",
  categoryModalPrefix: "ticket:category-modal",
  claimPrefix: "ticket:claim",
  transferPrefix: "ticket:transfer",
  transferSelectPrefix: "ticket:transfer-select",
  addMemberPrefix: "ticket:add-member",
  addMemberSelectPrefix: "ticket:add-member-select",
  removeMemberPrefix: "ticket:remove-member",
  removeMemberSelectPrefix: "ticket:remove-member-select",
  callOwnerPrefix: "ticket:call-owner",
  renamePrefix: "ticket:rename",
  renameModalPrefix: "ticket:rename-modal",
  closePrefix: "ticket:close",
  closeConfirmPrefix: "ticket:close-confirm",
  closeCancelPrefix: "ticket:close-cancel",
  managePrefix: "ticket:manage",
  reopenPrefix: "ticket:reopen",
  reviewPrefix: "ticket:review",
  reviewModalPrefix: "ticket:review-modal",
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

function formDataToDisplayLines(ticket, categoryConfig) {
  const formData = ticket.formData || {};
  const getValue = (key) => {
    if (typeof formData.get === "function") {
      return formData.get(key);
    }

    return formData[key];
  };

  const lines = [];
  for (const field of categoryConfig.modalFields || []) {
    const value = escapeDiscordText(getValue(field.id));
    if (!value) {
      continue;
    }

    lines.push(`**${field.label}:** ${value}`);
  }

  return lines;
}

function buildSupportPanelComponents({ openTicketCount }) {
  const waitLevel = resolveWaitLevelFromCount(openTicketCount);
  const openTicketLabel = `${openTicketCount} ticket${Number(openTicketCount) === 1 ? "" : "s"}`;
  const media = buildMediaGallery(config.tickets.bannerUrl, "Banner de atendimento da Rede Lhama");
  const select = new StringSelectMenuBuilder()
    .setCustomId(TICKET_CUSTOM_IDS.panelSelect)
    .setPlaceholder("Selecione o tipo de atendimento!")
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
        "# 📫 Central de Atendimento",
        "Para agilizar o atendimento, selecione corretamente a categoria da sua solicitação.",
      ].join("\n"),
    ),
    buildSeparator(),
    buildText(
      [
        "**⏰ Horários de Atendimento**",
        [
          "• Dias úteis - `10:00` às `20:00` (UTC-3)",
          "• Fins de semana e feriados - `10:00` às `16:00` (UTC-3)",
          "Atendimentos podem ocorrer fora deste período, porém com baixa prioridade.",
        ].join("\n"),
      ].join("\n"),
    ),
    buildText(
      [
        `Temos \`${openTicketLabel}\` em aberto, tempo de espera está \`${waitLevel}\`.`,
        "Tenha paciência: os atendimentos ocorrem por ordem de chegada. Nosso prazo máximo é de **2 dias úteis**.",
      ].join("\n"),
    ),
    buildSeparator(),
    buildText(
      [
        "**🤝 Comandos úteis**",
        [
          "• `/reportar` - Viu alguma infração? Crie uma denúncia.",
          "• `/apelar` - Solicite uma revisão da sua punição.",
          "• `/sugerir` - Crie uma sugestão para a comunidade.",
          "• `/formulario` - Faça parte da nossa equipe.",
        ].join("\n"),
      ].join("\n"),
    ),
    buildText("Utilize-os em #comandos e mantenha o privado aberto para receber o resultado."),
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

function resolveWaitLevelFromCount(openTicketCount) {
  const count = Number(openTicketCount || 0);
  const thresholds = config.tickets.waitThresholds;

  if (count <= thresholds.lowMax) return "baixo";
  if (count <= thresholds.moderateMax) return "moderado";
  if (count <= thresholds.highMax) return "alto";
  return "muito alto";
}

function buildTicketPanelComponents(ticket) {
  const categoryConfig = getTicketCategoryConfig(ticket.categoryType) || {};
  const formLines = formDataToDisplayLines(ticket, categoryConfig);
  const assignedStaff = ticket.assignedStaffId ? `<@${ticket.assignedStaffId}>` : "Aguardando...";
  const categoryName = categoryConfig.name || ticket.categoryType;
  const teamMention = !ticket.assignedStaffId && config.tickets.supportRoles[0]
    ? ` <@&${config.tickets.supportRoles[0]}>`
    : "";
  const intro = ticket.assignedStaffId
    ? "Seu suporte está sendo atendido por nossa equipe."
    : "Seu suporte foi aberto com sucesso e nossa equipe irá atendê-lo em breve.";
  const components = [
    buildText(`# Olá, <@${ticket.ownerId}>!${teamMention}`),
    buildText(intro),
    buildText(`> **Categoria:** ${categoryName}\n> **Responsável:** ${assignedStaff}`),
    buildSeparator(),
    buildText("Descreva sua situação abaixo para que possamos ajudar da melhor forma."),
  ];

  if (formLines.length) {
    components.push(
      buildSeparator(),
      buildText(["**Informações enviadas**", ...formLines.map((line) => `- ${line}`)].join("\n")),
    );
  }

  components.push(buildTicketActionRow(ticket).toJSON());

  const container = new ContainerBuilder({
    accent_color: config.tickets.accentColor,
    components,
  });

  return [container.toJSON()];
}

function buildTicketActionRow(ticket) {
  const disabled = ticket.status === "closed";
  const row = new ActionRowBuilder();

  if (!ticket.assignedStaffId && ticket.status !== "closed") {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${TICKET_CUSTOM_IDS.claimPrefix}:${ticket.ticketId}`)
        .setLabel("Aceitar")
        .setEmoji("✅")
        .setStyle(ButtonStyle.Success)
        .setDisabled(disabled),
    );
  }

  return row.addComponents(
    new ButtonBuilder()
      .setCustomId(`${TICKET_CUSTOM_IDS.closePrefix}:${ticket.ticketId}`)
      .setLabel("Fechar")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`${TICKET_CUSTOM_IDS.managePrefix}:${ticket.ticketId}`)
      .setLabel("Gerenciar")
      .setEmoji("💼")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled),
  );
}

function buildCloseConfirmComponents(ticketId) {
  return [
    new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`${TICKET_CUSTOM_IDS.closeConfirmPrefix}:${ticketId}`)
          .setLabel("Confirmar")
          .setEmoji("✅")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`${TICKET_CUSTOM_IDS.closeCancelPrefix}:${ticketId}`)
          .setLabel("Cancelar")
          .setEmoji("❌")
          .setStyle(ButtonStyle.Danger),
      )
      .toJSON(),
  ];
}

function buildTicketManageComponents(ticket) {
  const categoryConfig = getTicketCategoryConfig(ticket.categoryType) || {};
  const categoryName = categoryConfig.name || ticket.categoryType;
  const assignedStaff = ticket.assignedStaffId ? `<@${ticket.assignedStaffId}>` : "Aguardando...";
  const disabled = ticket.status === "closed";
  const components = [
    buildSection(
      [
        `# Gerenciar ticket #${formatTicketNumber(ticket.ticketNumber)}`,
        `**Categoria:** ${categoryName}\n**Responsável:** ${assignedStaff}`,
      ],
      buildDisabledBadge(`ticket:badge:${ticket.ticketId}:manage`, "Equipe", ButtonStyle.Secondary),
    ),
    buildText("Escolha a ação que deseja executar neste atendimento."),
    new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`${TICKET_CUSTOM_IDS.transferPrefix}:${ticket.ticketId}`)
          .setLabel("Transferir")
          .setEmoji("🔄")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(disabled),
        new ButtonBuilder()
          .setCustomId(`${TICKET_CUSTOM_IDS.addMemberPrefix}:${ticket.ticketId}`)
          .setLabel("Adicionar")
          .setEmoji("➕")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(disabled),
        new ButtonBuilder()
          .setCustomId(`${TICKET_CUSTOM_IDS.removeMemberPrefix}:${ticket.ticketId}`)
          .setLabel("Remover")
          .setEmoji("➖")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(disabled),
        new ButtonBuilder()
          .setCustomId(`${TICKET_CUSTOM_IDS.callOwnerPrefix}:${ticket.ticketId}`)
          .setLabel("Chamar")
          .setEmoji("🔔")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(disabled),
        new ButtonBuilder()
          .setCustomId(`${TICKET_CUSTOM_IDS.renamePrefix}:${ticket.ticketId}`)
          .setLabel("Renomear")
          .setEmoji("📝")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(disabled),
      )
      .toJSON(),
  ];

  const container = new ContainerBuilder({
    accent_color: config.tickets.accentColor,
    components,
  });

  return [container.toJSON()];
}

function buildTicketClosedComponents(ticket) {
  const categoryConfig = getTicketCategoryConfig(ticket.categoryType) || {};
  const containerComponents = [
    buildText(
      [
        `# Seu ticket na categoria ${categoryConfig.name || ticket.categoryType} foi finalizado!`,
        `Olá <@${ticket.ownerId}>, agradecemos seu contato. Se você precisar de mais alguma coisa, entre em contato novamente. Será um prazer ajudar você!`,
      ].join("\n"),
    ),
    buildSeparator(),
    buildText(
      [
        "**Resumo**",
        `> **ID:** ${formatTicketNumber(ticket.ticketNumber)}`,
        `> **Aberto por:** <@${ticket.ownerId}>`,
        `> **Fechado por:** ${ticket.closedBy ? `<@${ticket.closedBy}>` : "Não informado"}`,
      ].join("\n"),
    ),
    buildText(
      [
        "**Atendimento**",
        `> **Motivo:** ${escapeDiscordText(ticket.closeReason) || "Resolvido"}`,
        `> **Aberto em:** ${formatDateTime(ticket.createdAt)}`,
        `> **Atendido por:** ${ticket.assignedStaffId ? `<@${ticket.assignedStaffId}>` : "Não informado"}`,
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
  const categoryName = `${categoryConfig.emoji || "🎟️"} ${categoryConfig.name || ticket.categoryType}`;
  const container = new ContainerBuilder({
    accent_color: config.tickets.accentColor,
    components: [
      buildSection(
        [
          `# 🎟️ Ticket #${formatTicketNumber(ticket.ticketNumber)} finalizado`,
          `${categoryName}\nFechado por ${ticket.closedBy ? `<@${ticket.closedBy}>` : "Não informado"}`,
        ],
        new ButtonBuilder()
          .setCustomId(`${TICKET_CUSTOM_IDS.reopenPrefix}:${ticket.ticketId}`)
          .setLabel("Reabrir ticket")
          .setEmoji("🔓")
          .setStyle(ButtonStyle.Success)
          .toJSON(),
      ),
      buildSeparator(),
      buildSection(
        [
          `**Motivo**\n${escapeDiscordText(ticket.closeReason) || "Resolvido"}`,
          `**Aberto em**\n${formatDateTime(ticket.createdAt)}`,
          `**Fechado em**\n${ticket.closedAt ? formatDateTime(ticket.closedAt) : "Agora"}`,
        ],
        buildDisabledBadge(`ticket:badge:${ticket.ticketId}:arquivado`, "Arquivado", ButtonStyle.Secondary),
      ),
      buildText("A mensagem de finalização e a avaliação foram enviadas no privado de quem abriu o ticket."),
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
            emoji: "⭐",
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
      ? buildSection(["# Nova avaliação de ticket"], reviewerThumbnail)
      : buildText("# Nova avaliação de ticket"),
    buildSeparator(),
    buildText(
      [
        `**Nota:** ${"⭐".repeat(safeRating)}`,
        `**Usuário:** <@${userId}>`,
        `**Atendente:** ${ticket.assignedStaffId ? `<@${ticket.assignedStaffId}>` : "Não informado"}`,
      ].join("\n"),
    ),
  ];

  const safeComment = escapeDiscordText(comment);
  if (safeComment) {
    components.push(buildSeparator(), buildText(`**Comentário**\n${safeComment}`));
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
    throw new Error(`Categoria de ticket inválida: ${categoryType}`);
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

function buildRenameModal(ticketId) {
  return new ModalBuilder()
    .setCustomId(`${TICKET_CUSTOM_IDS.renameModalPrefix}:${ticketId}`)
    .setTitle("Renomear ticket")
    .addComponents(
      buildLabelTextInput({
        id: "name",
        label: "Novo nome do canal",
        style: "short",
        minLength: 3,
        maxLength: 90,
        required: true,
      }),
    );
}

function buildReviewModal(ticketId, rating) {
  return new ModalBuilder()
    .setCustomId(`${TICKET_CUSTOM_IDS.reviewModalPrefix}:${ticketId}:${rating}`)
    .setTitle(`Avaliação ${rating} estrela${Number(rating) === 1 ? "" : "s"}`)
    .addComponents(
      buildLabelTextInput({
        id: "comment",
        label: "Comentário opcional",
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

function buildGoToTicketRow(guildId, channelId) {
  return new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setLabel("Ir para meu ticket")
        .setEmoji("🔗")
        .setStyle(ButtonStyle.Link)
        .setURL(`https://discord.com/channels/${guildId}/${channelId}`),
    )
    .toJSON();
}

module.exports = {
  TICKET_CUSTOM_IDS,
  buildCategoryModal,
  buildCloseConfirmComponents,
  buildGoToTicketRow,
  buildTicketArchivedComponents,
  buildReviewModal,
  buildTicketReviewComponents,
  buildSupportPanelComponents,
  buildTicketClosedComponents,
  buildTicketManageComponents,
  buildTicketPanelComponents,
  buildRenameModal,
  buildUserSelectRow,
};

