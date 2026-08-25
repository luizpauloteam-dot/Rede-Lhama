const fs = require("fs").promises;
const path = require("path");

const {
  Events,
  MessageFlags,
} = require("discord.js");

const config = require("../config");
const {
  LinkValidationError,
  consumeLinkCode,
} = require("../utils/account-link-store");
const {
  LINK_PANEL_CUSTOM_IDS,
  buildLinkCodeModal,
  buildLinkPanelComponents,
} = require("../utils/link-panel");
const {
  assignConfiguredRoles,
  buildSuccessMessage,
} = require("../utils/link-roles");
const { createLogger } = require("../utils/logger");

const log = createLogger("link-panel");
const SAFE_ALLOWED_MENTIONS = {
  parse: [],
  repliedUser: false,
};

async function ensureParentDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function readPanelState() {
  try {
    const content = await fs.readFile(config.link.panelMessageFilePath, "utf8");
    return JSON.parse(content);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }

    log.warn("Nao foi possivel ler o estado do painel.", error);
    return null;
  }
}

async function writePanelState(state) {
  await ensureParentDir(config.link.panelMessageFilePath);
  await fs.writeFile(config.link.panelMessageFilePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

async function resolvePanelChannel(client) {
  if (!config.link.panelChannelId) {
    log.warn("DISCORD_LINK_PANEL_CHANNEL_ID nao configurado.");
    return null;
  }

  const channel =
    client.channels.cache.get(config.link.panelChannelId) ||
    (await client.channels.fetch(config.link.panelChannelId).catch(() => null));

  if (!channel?.isTextBased?.() || typeof channel.send !== "function") {
    log.warn(`Canal do painel invalido ou inacessivel: ${config.link.panelChannelId}`);
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

async function upsertPanel(client) {
  const channel = await resolvePanelChannel(client);
  if (!channel) {
    return;
  }

  const components = buildLinkPanelComponents();
  const existingMessage = await fetchStoredPanelMessage(channel, client);

  if (existingMessage) {
    await existingMessage
      .edit({
        components,
        allowedMentions: SAFE_ALLOWED_MENTIONS,
      })
      .then(() => {
        log.info(`Painel de vinculacao atualizado em ${channel.id}.`);
      })
      .catch(async (error) => {
        log.warn("Nao foi possivel atualizar o painel salvo. Vou enviar um novo.", error);
        const message = await sendPanel(channel, components);
        await writePanelState({ channelId: channel.id, messageId: message.id });
      });
    return;
  }

  const message = await sendPanel(channel, components);
  await writePanelState({ channelId: channel.id, messageId: message.id });
  log.info(`Painel de vinculacao enviado em ${channel.id}.`);
}

async function sendPanel(channel, components) {
  return channel.send({
    flags: MessageFlags.IsComponentsV2,
    components,
    allowedMentions: SAFE_ALLOWED_MENTIONS,
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

function isLinkPanelInteraction(interaction) {
  return (
    interaction.customId === LINK_PANEL_CUSTOM_IDS.connectButton ||
    interaction.customId === LINK_PANEL_CUSTOM_IDS.connectModal
  );
}

async function handleConnectModal(interaction) {
  if (!interaction.guild) {
    await replyEphemeral(interaction, "Use este painel dentro do servidor do Discord.");
    return;
  }

  const code = interaction.fields.getTextInputValue(LINK_PANEL_CUSTOM_IDS.codeInput);
  const linkedAccount = await consumeLinkCode({
    code,
    discordId: interaction.user.id,
    discordTag: interaction.user.tag || interaction.user.username,
  });
  const roleResult = await assignConfiguredRoles({
    guild: interaction.guild,
    member: interaction.member,
    userId: interaction.user.id,
    linkedAccount,
  });

  log.info(
    `Conta vinculada: ${linkedAccount.nick} (${linkedAccount.uuid}) -> ${interaction.user.tag} (${interaction.user.id}).`,
  );

  await replyEphemeral(interaction, buildSuccessMessage(linkedAccount, roleResult));
}

async function handleInteraction(interaction) {
  if (!interaction.customId || !isLinkPanelInteraction(interaction)) {
    return;
  }

  try {
    if (interaction.isButton() && interaction.customId === LINK_PANEL_CUSTOM_IDS.connectButton) {
      await interaction.showModal(buildLinkCodeModal());
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === LINK_PANEL_CUSTOM_IDS.connectModal) {
      await handleConnectModal(interaction);
    }
  } catch (error) {
    if (error instanceof LinkValidationError) {
      await replyEphemeral(interaction, error.message);
      return;
    }

    log.error("Falha ao processar painel de vinculacao.", error);
    await replyEphemeral(interaction, "Nao foi possivel vincular sua conta agora.");
  }
}

module.exports = [
  {
    name: Events.ClientReady,
    once: true,
    execute: async (client) => {
      await upsertPanel(client);
    },
  },
  {
    name: Events.InteractionCreate,
    execute: handleInteraction,
  },
];
