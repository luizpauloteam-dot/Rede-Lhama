const {
  ChannelType,
  MessageFlags,
  PermissionsBitField,
  SlashCommandBuilder,
} = require("discord.js");

const { validateTargetChannel } = require("../../utils/discord-channel-access");
const { upsertSuggestionPanel } = require("../../utils/suggestion-manager");

const SAFE_ALLOWED_MENTIONS = {
  parse: [],
  repliedUser: false,
};

function canManageSuggestionPanel(member) {
  return Boolean(
    member?.permissions?.has(PermissionsBitField.Flags.Administrator) ||
      member?.permissions?.has(PermissionsBitField.Flags.ManageGuild) ||
      member?.permissions?.has(PermissionsBitField.Flags.ManageMessages),
  );
}

async function replyEphemeral(interaction, content) {
  const payload = {
    content,
    flags: MessageFlags.Ephemeral,
    allowedMentions: SAFE_ALLOWED_MENTIONS,
  };

  if (interaction.deferred && !interaction.replied) {
    await interaction.editReply({
      content,
      allowedMentions: SAFE_ALLOWED_MENTIONS,
    });
    return;
  }

  if (interaction.replied || interaction.deferred) {
    await interaction.followUp(payload);
    return;
  }

  await interaction.reply(payload);
}

async function validateCommandChannel(interaction, client, channel) {
  return validateTargetChannel({
    guild: interaction.guild,
    guildId: interaction.guildId,
    channelId: channel.id,
    member: interaction.member,
    botMember: interaction.guild.members.me || client.user,
  });
}

async function handlePanelCommand(client, interaction) {
  if (!canManageSuggestionPanel(interaction.member)) {
    await replyEphemeral(interaction, "Você não possui permissão para publicar o painel de sugestões.");
    return;
  }

  const panelChannel = interaction.options.getChannel("canal") || interaction.channel;
  const suggestionChannel = interaction.options.getChannel("destino");

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const panelValidation = await validateCommandChannel(interaction, client, panelChannel);
  if (panelValidation.error) {
    await replyEphemeral(interaction, panelValidation.error);
    return;
  }

  let validatedSuggestionChannel = null;
  if (suggestionChannel) {
    const suggestionValidation = await validateCommandChannel(interaction, client, suggestionChannel);
    if (suggestionValidation.error) {
      await replyEphemeral(interaction, suggestionValidation.error);
      return;
    }

    validatedSuggestionChannel = suggestionValidation.targetChannel;
  }

  const message = await upsertSuggestionPanel(client, panelValidation.targetChannel, validatedSuggestionChannel);
  if (!message) {
    await replyEphemeral(interaction, "Não foi possível publicar o painel de sugestões.");
    return;
  }

  const destination = validatedSuggestionChannel ? ` e destino em ${validatedSuggestionChannel}` : "";
  await replyEphemeral(interaction, `Painel de sugestões publicado/atualizado em ${panelValidation.targetChannel}${destination}.`);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("sugestao")
    .setDescription("Gerencia o painel de sugestões da Rede Lhama.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("painel")
        .setDescription("Publica ou atualiza o painel de sugestões.")
        .addChannelOption((option) =>
          option
            .setName("canal")
            .setDescription("Canal onde o painel será publicado.")
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(false),
        )
        .addChannelOption((option) =>
          option
            .setName("destino")
            .setDescription("Canal onde as sugestões serão enviadas.")
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(false),
        ),
    ),

  async run(client, interaction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "painel") {
      await handlePanelCommand(client, interaction);
    }
  },
};
