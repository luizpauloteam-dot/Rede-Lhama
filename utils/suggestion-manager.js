const fs = require("fs").promises;
const path = require("path");

const {
  MessageFlags,
  ThreadAutoArchiveDuration,
} = require("discord.js");

const config = require("../config");
const { createLogger } = require("./logger");
const { readPanelState, upsertPanelMessage } = require("./panel-message");
const {
  SUGGESTION_CUSTOM_IDS,
  buildApprovedSuggestionComponents,
  buildSuggestionModal,
  buildSuggestionPanelComponents,
  buildSuggestionPostComponents,
  buildSuggestionThreadComponents,
} = require("./suggestion-components");
const { normalizeDiscordName } = require("./ticket-common");
const { isTicketAdministrator } = require("./ticket-permissions");

const log = createLogger("suggestions");
const SAFE_ALLOWED_MENTIONS = {
  parse: [],
  repliedUser: false,
};

async function ensureParentDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

function createEmptySuggestionStore() {
  return {
    suggestions: {},
  };
}

async function readSuggestionStore() {
  try {
    const content = await fs.readFile(config.suggestions.storeFilePath, "utf8");
    const store = JSON.parse(content);
    return {
      suggestions: store.suggestions || {},
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return createEmptySuggestionStore();
    }

    log.warn("Não foi possível ler o arquivo de sugestões.", error);
    return createEmptySuggestionStore();
  }
}

async function writeSuggestionStore(store) {
  await ensureParentDir(config.suggestions.storeFilePath);
  await fs.writeFile(config.suggestions.storeFilePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

function isSendableTextChannel(channel) {
  return Boolean(channel?.isTextBased?.() && typeof channel.send === "function");
}

async function resolveChannel(client, channelId) {
  if (!channelId) {
    return null;
  }

  return client.channels.cache.get(channelId) || (await client.channels.fetch(channelId).catch(() => null));
}

async function resolvePanelChannel(client, preferredChannel = null) {
  if (isSendableTextChannel(preferredChannel)) {
    return preferredChannel;
  }

  const channel = await resolveChannel(client, config.suggestions.panelChannelId);
  if (!isSendableTextChannel(channel)) {
    return null;
  }

  return channel;
}

async function upsertSuggestionPanel(client, preferredChannel = null, suggestionChannel = null) {
  if (!config.suggestions.enabled) {
    return null;
  }

  const panelChannel = await resolvePanelChannel(client, preferredChannel);
  if (!panelChannel) {
    return null;
  }

  const state = await readPanelState(config.suggestions.panelMessageFilePath);
  const components = buildSuggestionPanelComponents();
  const suggestionChannelId =
    suggestionChannel?.id ||
    config.suggestions.channelId ||
    state?.suggestionChannelId ||
    panelChannel.id;
  return upsertPanelMessage({
    client, channel: panelChannel, components,
    customId: SUGGESTION_CUSTOM_IDS.openButton,
    stateFilePath: config.suggestions.panelMessageFilePath,
    extraState: { suggestionChannelId },
  });
}

async function replyEphemeral(interaction, content) {
  const payload = {
    content,
    flags: MessageFlags.Ephemeral,
    allowedMentions: SAFE_ALLOWED_MENTIONS,
  };

  if (interaction.replied || interaction.deferred) {
    await interaction.followUp(payload).catch(() => null);
    return;
  }

  await interaction.reply(payload).catch(() => null);
}

function countVotes(suggestion) {
  const votes = Object.values(suggestion?.votes || {});

  return {
    upVotes: votes.filter((vote) => vote === "up").length,
    downVotes: votes.filter((vote) => vote === "down").length,
  };
}

function buildSuggestionMessageComponents(suggestion) {
  return buildSuggestionPostComponents({
    title: suggestion.title,
    description: suggestion.description,
    userId: suggestion.userId,
    userAvatarUrl: suggestion.userAvatarUrl,
    suggestionId: suggestion.messageId,
    guildId: suggestion.guildId,
    threadId: suggestion.threadId,
    implemented: suggestion.implemented,
    ...countVotes(suggestion),
  });
}

function buildApprovedMessageComponents(suggestion, implementedById) {
  return buildApprovedSuggestionComponents({
    suggestionId: suggestion.messageId,
    title: suggestion.title,
    description: suggestion.description,
    userId: suggestion.userId,
    implementedById,
    guildId: suggestion.guildId,
    threadId: suggestion.threadId,
    ...countVotes(suggestion),
  });
}

function buildSuggestionThreadName(title) {
  return normalizeDiscordName(`sugestao-${title}`).slice(0, 90) || "sugestao";
}

async function updateSuggestionMessage(client, suggestion) {
  const channel = await resolveChannel(client, suggestion.channelId);
  const message = await channel?.messages?.fetch(suggestion.messageId).catch(() => null);

  if (!message) {
    return null;
  }

  await message.edit({
    content: null,
    flags: MessageFlags.IsComponentsV2,
    components: buildSuggestionMessageComponents(suggestion),
    allowedMentions: SAFE_ALLOWED_MENTIONS,
  });

  return message;
}

async function createSuggestionThread(message, suggestion) {
  if (typeof message.startThread !== "function") {
    return null;
  }

  const thread = await message
    .startThread({
      name: buildSuggestionThreadName(suggestion.title),
      autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
      reason: `Tópico de conversa da sugestão enviada por ${suggestion.userId}.`,
    })
    .catch((error) => {
      log.warn("Não foi possível criar tópico da sugestão.", error);
      return null;
    });

  if (!thread) {
    return null;
  }

  const threadMessage = await thread
    .send({
      flags: MessageFlags.IsComponentsV2,
      components: buildSuggestionThreadComponents({
        suggestionId: suggestion.messageId,
      }),
      allowedMentions: SAFE_ALLOWED_MENTIONS,
    })
    .catch((error) => {
      log.warn("Não foi possível enviar controle de implementação no tópico.", error);
      return null;
    });

  return {
    threadId: thread.id,
    threadMessageId: threadMessage?.id || "",
  };
}

async function resolveSuggestionTargetChannel(interaction) {
  const state = await readPanelState(config.suggestions.panelMessageFilePath);
  const channelId = config.suggestions.channelId || state?.suggestionChannelId;
  const configuredChannel = await resolveChannel(interaction.client, channelId);

  if (isSendableTextChannel(configuredChannel)) {
    return configuredChannel;
  }

  if (isSendableTextChannel(interaction.channel)) {
    return interaction.channel;
  }

  return null;
}

async function handleSuggestionModal(interaction) {
  const title = String(interaction.fields.getTextInputValue(SUGGESTION_CUSTOM_IDS.titleInput) || "").trim();
  const description = String(interaction.fields.getTextInputValue(SUGGESTION_CUSTOM_IDS.descriptionInput) || "").trim();

  if (title.length < 3 || description.length < 10) {
    await replyEphemeral(interaction, "Preencha a sugestão com título e descrição.");
    return;
  }

  const targetChannel = await resolveSuggestionTargetChannel(interaction);
  if (!targetChannel) {
    await replyEphemeral(interaction, "Canal de sugestões não configurado ou inacessível.");
    return;
  }

  const userAvatarUrl = interaction.user.displayAvatarURL({ size: 128 });
  const message = await targetChannel.send({
    flags: MessageFlags.IsComponentsV2,
    components: buildSuggestionPostComponents({
      title,
      description,
      userId: interaction.user.id,
      userAvatarUrl,
    }),
    allowedMentions: SAFE_ALLOWED_MENTIONS,
  });

  const suggestion = {
    messageId: message.id,
    channelId: message.channelId,
    guildId: interaction.guildId || targetChannel.guildId,
    threadId: "",
    threadMessageId: "",
    title,
    description,
    userId: interaction.user.id,
    userAvatarUrl,
    votes: {},
    implemented: false,
    implementedById: "",
    implementedAt: "",
    approvedChannelId: "",
    approvedMessageId: "",
    createdAt: new Date().toISOString(),
  };
  const threadResult = await createSuggestionThread(message, suggestion);

  if (threadResult) {
    suggestion.threadId = threadResult.threadId;
    suggestion.threadMessageId = threadResult.threadMessageId;
  }

  const store = await readSuggestionStore();
  store.suggestions[suggestion.messageId] = suggestion;
  await writeSuggestionStore(store);
  await message
    .edit({
      content: null,
      flags: MessageFlags.IsComponentsV2,
      components: buildSuggestionMessageComponents(suggestion),
      allowedMentions: SAFE_ALLOWED_MENTIONS,
    })
    .catch((error) => {
      log.warn("Não foi possível atualizar botões da sugestão.", error);
    });

  await replyEphemeral(
    interaction,
    threadResult
      ? `Sugestão enviada em ${targetChannel} e tópico criado em <#${threadResult.threadId}>.`
      : `Sugestão enviada em ${targetChannel}, mas não consegui criar o tópico.`,
  );
}

async function handleSuggestionVote(interaction, suggestionId, voteType) {
  const store = await readSuggestionStore();
  const suggestion = store.suggestions[suggestionId];

  if (!suggestion) {
    await replyEphemeral(interaction, "Sugestão não encontrada.");
    return;
  }

  if (suggestion.implemented) {
    await replyEphemeral(interaction, "Esta sugestão já foi aprovada.");
    return;
  }

  suggestion.votes ||= {};

  if (suggestion.votes[interaction.user.id] === voteType) {
    delete suggestion.votes[interaction.user.id];
  } else {
    suggestion.votes[interaction.user.id] = voteType;
  }

  await writeSuggestionStore(store);
  await interaction.update({
    components: buildSuggestionMessageComponents(suggestion),
    allowedMentions: SAFE_ALLOWED_MENTIONS,
  });
}

async function resolveApprovedChannel(interaction) {
  const channel = await resolveChannel(interaction.client, config.suggestions.approvedChannelId);

  if (!isSendableTextChannel(channel)) {
    return null;
  }

  return channel;
}

function canImplementSuggestion(member) {
  return isTicketAdministrator(member);
}

async function lockSuggestionThread(channel) {
  if (!channel?.isThread?.()) {
    return;
  }

  await channel.setLocked(true, "Sugestão aprovada pela equipe.").catch((error) => {
    log.warn("Não foi possível trancar o tópico da sugestão.", error);
  });
  await channel.setArchived(true, "Sugestão aprovada pela equipe.").catch((error) => {
    log.warn("Não foi possível arquivar o tópico da sugestão.", error);
  });
}

async function handleImplementSuggestion(interaction, suggestionId) {
  if (!canImplementSuggestion(interaction.member)) {
    await replyEphemeral(interaction, "Somente administradores podem implementar sugestões.");
    return;
  }

  const store = await readSuggestionStore();
  const suggestion = store.suggestions[suggestionId];

  if (!suggestion) {
    await replyEphemeral(interaction, "Sugestão não encontrada.");
    return;
  }

  if (suggestion.implemented) {
    await replyEphemeral(interaction, "Esta sugestão já foi aprovada.");
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const approvedChannel = await resolveApprovedChannel(interaction);
  if (!approvedChannel) {
    await interaction.editReply({
      content: "Canal de sugestões aprovadas não encontrado ou inacessível.",
      allowedMentions: SAFE_ALLOWED_MENTIONS,
    });
    return;
  }

  const approvedMessage = await approvedChannel.send({
    flags: MessageFlags.IsComponentsV2,
    components: buildApprovedMessageComponents(suggestion, interaction.user.id),
    allowedMentions: SAFE_ALLOWED_MENTIONS,
  });

  suggestion.implemented = true;
  suggestion.implementedById = interaction.user.id;
  suggestion.implementedAt = new Date().toISOString();
  suggestion.approvedChannelId = approvedChannel.id;
  suggestion.approvedMessageId = approvedMessage.id;
  store.suggestions[suggestionId] = suggestion;
  await writeSuggestionStore(store);

  await updateSuggestionMessage(interaction.client, suggestion).catch((error) => {
    log.warn("Não foi possível atualizar mensagem original da sugestão aprovada.", error);
  });

  await interaction.message
    .edit({
      content: null,
      flags: MessageFlags.IsComponentsV2,
      components: buildSuggestionThreadComponents({
        suggestionId,
        implemented: true,
      }),
      allowedMentions: SAFE_ALLOWED_MENTIONS,
    })
    .catch((error) => {
      log.warn("Não foi possível atualizar botão de implementação no tópico.", error);
    });

  await interaction.editReply({
    content: `Sugestão aprovada e enviada em ${approvedChannel}.`,
    allowedMentions: SAFE_ALLOWED_MENTIONS,
  });
  await lockSuggestionThread(interaction.channel);
}

async function handleSuggestionInteraction(interaction) {
  if (!config.suggestions.enabled || !interaction.customId?.startsWith("suggestion:")) {
    return false;
  }

  try {
    if (interaction.isButton() && interaction.customId === SUGGESTION_CUSTOM_IDS.openButton) {
      await interaction.showModal(buildSuggestionModal());
      return true;
    }

    if (interaction.isButton()) {
      const [, action, suggestionId] = interaction.customId.split(":");

      if (action === "vote-up") {
        await handleSuggestionVote(interaction, suggestionId, "up");
        return true;
      }

      if (action === "vote-down") {
        await handleSuggestionVote(interaction, suggestionId, "down");
        return true;
      }

      if (action === "implement") {
        await handleImplementSuggestion(interaction, suggestionId);
        return true;
      }
    }

    if (interaction.isModalSubmit() && interaction.customId === SUGGESTION_CUSTOM_IDS.modal) {
      await handleSuggestionModal(interaction);
      return true;
    }
  } catch (error) {
    log.error("Falha ao processar sugestão.", error);
    await replyEphemeral(interaction, "Não foi possível processar sua sugestão agora.");
    return true;
  }

  return false;
}

module.exports = {
  handleSuggestionInteraction,
  upsertSuggestionPanel,
};
