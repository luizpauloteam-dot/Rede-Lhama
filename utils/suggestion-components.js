const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  ContainerBuilder,
  LabelBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ThumbnailBuilder,
} = require("discord.js");

const config = require("../config");
const { escapeDiscordText } = require("./ticket-common");

const SUGGESTION_CUSTOM_IDS = {
  openButton: "suggestion:open",
  modal: "suggestion:modal",
  titleInput: "suggestion:title",
  descriptionInput: "suggestion:description",
  voteUpPrefix: "suggestion:vote-up",
  voteDownPrefix: "suggestion:vote-down",
  implementPrefix: "suggestion:implement",
};

function buildText(content) {
  return {
    type: ComponentType.TextDisplay,
    content,
  };
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

function buildThumbnail(url, description) {
  if (!url) {
    return null;
  }

  return new ThumbnailBuilder()
    .setURL(url)
    .setDescription(description)
    .toJSON();
}

function buildSuggestionPanelComponents() {
  const media = buildMediaGallery(config.suggestions.bannerUrl, "Banner de sugestões da Rede Lhama");
  const components = [
    buildText(
      [
        "# Sugestões",
        "Envie ideias para melhorar a comunidade, o servidor e os sistemas da Rede Lhama.",
      ].join("\n"),
    ),
    buildSeparator(),
    {
      type: ComponentType.Section,
      components: [
        buildText("Clique para escrever sua sugestão. Ela será publicada para a equipe analisar."),
      ],
      accessory: new ButtonBuilder()
        .setCustomId(SUGGESTION_CUSTOM_IDS.openButton)
        .setLabel("Enviar sugestão")
        .setEmoji("💡")
        .setStyle(ButtonStyle.Primary)
        .toJSON(),
    },
  ];

  if (media) {
    components.push(buildSeparator(), media);
  }

  const container = new ContainerBuilder({
    accent_color: config.suggestions.accentColor,
    components,
  });

  return [container.toJSON()];
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

function buildSuggestionModal() {
  return new ModalBuilder()
    .setCustomId(SUGGESTION_CUSTOM_IDS.modal)
    .setTitle("Enviar sugestão")
    .addComponents(
      buildLabelTextInput({
        id: SUGGESTION_CUSTOM_IDS.titleInput,
        label: "Título",
        style: "short",
        minLength: 3,
        maxLength: 100,
        required: true,
      }),
      buildLabelTextInput({
        id: SUGGESTION_CUSTOM_IDS.descriptionInput,
        label: "Descrição",
        style: "paragraph",
        minLength: 10,
        maxLength: 1200,
        required: true,
      }),
    );
}

function buildSuggestionVoteRow({
  suggestionId,
  guildId,
  threadId,
  upVotes = 0,
  downVotes = 0,
  implemented = false,
}) {
  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`${SUGGESTION_CUSTOM_IDS.voteUpPrefix}:${suggestionId}`)
        .setLabel(String(upVotes))
        .setEmoji("✅")
        .setStyle(ButtonStyle.Success)
        .setDisabled(implemented),
      new ButtonBuilder()
        .setCustomId(`${SUGGESTION_CUSTOM_IDS.voteDownPrefix}:${suggestionId}`)
        .setLabel(String(downVotes))
        .setEmoji("❌")
        .setStyle(ButtonStyle.Danger)
        .setDisabled(implemented),
    );

  if (threadId && guildId) {
    row.addComponents(
      new ButtonBuilder()
        .setLabel("Debater")
        .setEmoji("💬")
        .setStyle(ButtonStyle.Link)
        .setURL(`https://discord.com/channels/${guildId}/${threadId}`),
    );
  }

  if (implemented) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`suggestion:implemented:${suggestionId}`)
        .setLabel("Aprovada")
        .setEmoji("✅")
        .setStyle(ButtonStyle.Success)
        .setDisabled(true),
    );
  }

  return row.toJSON();
}

function buildSuggestionPostComponents({
  title,
  description,
  userId,
  userAvatarUrl,
  suggestionId,
  guildId,
  threadId,
  upVotes = 0,
  downVotes = 0,
  implemented = false,
}) {
  const safeTitle = escapeDiscordText(title);
  const safeDescription = escapeDiscordText(description);
  const authorThumbnail = buildThumbnail(userAvatarUrl, "Avatar de quem enviou a sugestão");
  const components = [
    authorThumbnail
      ? {
          type: ComponentType.Section,
          components: [
            buildText("# Nova sugestão"),
            buildText(`Enviada por <@${userId}>`),
          ],
          accessory: authorThumbnail,
        }
      : buildText(["# Nova sugestão", `Enviada por <@${userId}>`].join("\n")),
    buildSeparator(),
    buildText([`**${safeTitle}**`, safeDescription].join("\n")),
    buildSeparator(),
    buildText(implemented ? "Sugestão aprovada pela equipe." : "Vote nos botões abaixo e converse no tópico da sugestão."),
  ];

  const container = new ContainerBuilder({
    accent_color: config.suggestions.accentColor,
    components,
  });

  if (!suggestionId) {
    return [container.toJSON()];
  }

  return [
    container.toJSON(),
    buildSuggestionVoteRow({
      suggestionId,
      guildId,
      threadId,
      upVotes,
      downVotes,
      implemented,
    }),
  ];
}

function buildSuggestionThreadComponents({ suggestionId, implemented = false }) {
  const container = new ContainerBuilder({
    accent_color: config.suggestions.accentColor,
    components: [
      buildText(
        implemented
          ? "# Sugestão aprovada\nEste tópico foi trancado pela equipe."
          : "# Conversa da sugestão\nUse este tópico para conversar sobre a ideia enviada.",
      ),
      buildSeparator(),
      new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`${SUGGESTION_CUSTOM_IDS.implementPrefix}:${suggestionId}`)
            .setLabel(implemented ? "Implementada" : "Implementar")
            .setEmoji("✅")
            .setStyle(ButtonStyle.Success)
            .setDisabled(implemented),
        )
        .toJSON(),
    ],
  });

  return [container.toJSON()];
}

function buildApprovedSuggestionComponents({
  title,
  description,
  userId,
  userAvatarUrl,
  implementedById,
  upVotes = 0,
  downVotes = 0,
  guildId,
  threadId,
}) {
  const safeTitle = escapeDiscordText(title);
  const safeDescription = escapeDiscordText(description);
  const authorThumbnail = buildThumbnail(userAvatarUrl, "Avatar de quem enviou a sugestão");
  const components = [
    authorThumbnail
      ? {
          type: ComponentType.Section,
          components: [
            buildText("# Sugestão aprovada"),
            buildText(`Enviada por <@${userId}>`),
          ],
          accessory: authorThumbnail,
        }
      : buildText(["# Sugestão aprovada", `Enviada por <@${userId}>`].join("\n")),
    buildSeparator(),
    buildText([`**${safeTitle}**`, safeDescription].join("\n")),
    buildSeparator(),
    buildText(
      [
        `**Aprovada por:** <@${implementedById}>`,
        `**Votos:** ✅ ${upVotes} | ❌ ${downVotes}`,
        threadId && guildId ? `**Tópico:** https://discord.com/channels/${guildId}/${threadId}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    ),
  ];

  const container = new ContainerBuilder({
    accent_color: config.suggestions.accentColor,
    components,
  });

  return [container.toJSON()];
}

module.exports = {
  SUGGESTION_CUSTOM_IDS,
  buildApprovedSuggestionComponents,
  buildSuggestionModal,
  buildSuggestionPanelComponents,
  buildSuggestionPostComponents,
  buildSuggestionThreadComponents,
};
