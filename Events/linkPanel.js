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
const { upsertPanelMessage } = require("../utils/panel-message");

const log = createLogger("link-panel");
const SAFE_ALLOWED_MENTIONS = {
  parse: [],
  repliedUser: false,
};

async function resolvePanelChannel(client) {
  if (!config.link.panelChannelId) {
    log.warn("DISCORD_LINK_PANEL_CHANNEL_ID não configurado.");
    return null;
  }

  const channel =
    client.channels.cache.get(config.link.panelChannelId) ||
    (await client.channels.fetch(config.link.panelChannelId).catch(() => null));

  if (!channel?.isTextBased?.() || typeof channel.send !== "function") {
    log.warn(`Canal do painel inválido ou inacessível: ${config.link.panelChannelId}`);
    return null;
  }

  return channel;
}

async function upsertPanel(client) {
  const channel = await resolvePanelChannel(client);
  if (!channel) {
    return;
  }

  await upsertPanelMessage({
    client, channel,
    customId: LINK_PANEL_CUSTOM_IDS.connectButton,
    stateFilePath: config.link.panelMessageFilePath,
    components: buildLinkPanelComponents(),
  });
  log.info(`Painel de vinculação sincronizado em ${channel.id}.`);
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

    log.error("Falha ao processar painel de vinculação.", error);
    await replyEphemeral(interaction, "Não foi possível vincular sua conta agora.");
  }
}

module.exports = [
  {
    name: Events.ClientReady,
    once: true,
    execute: async (client) => {
      await upsertPanel(client).catch((error) => log.error("Falha ao sincronizar painel de vinculação.", error));
    },
  },
  {
    name: Events.InteractionCreate,
    execute: handleInteraction,
  },
];
