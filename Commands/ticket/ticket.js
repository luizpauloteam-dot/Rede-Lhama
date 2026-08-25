const {
  ChannelType,
  MessageFlags,
  SlashCommandBuilder,
} = require("discord.js");

const {
  addBlacklistEntry,
  closeTicketFromCommand,
  deleteTicketFromCommand,
  removeBlacklistEntry,
  reopenTicketFromCommand,
  showBlacklistEntry,
  showTicketInfo,
  upsertSupportPanel,
} = require("../../utils/ticket-manager");
const { isTicketAdministrator } = require("../../utils/ticket-permissions");

async function replyEphemeral(interaction, content) {
  const payload = {
    content,
    flags: MessageFlags.Ephemeral,
    allowedMentions: {
      parse: [],
      repliedUser: false,
    },
  };

  if (interaction.deferred && !interaction.replied) {
    await interaction.editReply({
      content,
      allowedMentions: payload.allowedMentions,
    });
    return;
  }

  if (interaction.replied || interaction.deferred) {
    await interaction.followUp(payload);
    return;
  }

  await interaction.reply(payload);
}

async function handlePanelCommand(client, interaction) {
  if (!isTicketAdministrator(interaction.member)) {
    await replyEphemeral(interaction, "Você não possui permissão para publicar o painel de tickets.");
    return;
  }

  const channel = interaction.options.getChannel("canal") || interaction.channel;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await upsertSupportPanel(client, channel);
  await replyEphemeral(interaction, `Painel de tickets publicado/atualizado em ${channel}.`);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("Gerencia o sistema de tickets da Rede Lhama.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("painel")
        .setDescription("Publica ou atualiza o painel principal de atendimento.")
        .addChannelOption((option) =>
          option
            .setName("canal")
            .setDescription("Canal onde o painel será publicado.")
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(false),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("info")
        .setDescription("Mostra informações do ticket neste canal."),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("fechar")
        .setDescription("Fecha o ticket neste canal.")
        .addStringOption((option) =>
          option
            .setName("motivo")
            .setDescription("Motivo do fechamento.")
            .setMaxLength(700)
            .setRequired(false),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("reabrir")
        .setDescription("Reabre o ticket neste canal."),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("excluir")
        .setDescription("Gera a transcrição e exclui definitivamente o canal do ticket."),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("blacklist-adicionar")
        .setDescription("Impede um usuário de abrir tickets.")
        .addUserOption((option) =>
          option
            .setName("usuario")
            .setDescription("Usuário que será bloqueado.")
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName("motivo")
            .setDescription("Motivo do bloqueio.")
            .setMaxLength(700)
            .setRequired(true),
        )
        .addBooleanOption((option) =>
          option
            .setName("permanente")
            .setDescription("Define se o bloqueio será permanente.")
            .setRequired(false),
        )
        .addIntegerOption((option) =>
          option
            .setName("dias")
            .setDescription("Duração em dias quando não for permanente.")
            .setMinValue(1)
            .setMaxValue(3650)
            .setRequired(false),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("blacklist-remover")
        .setDescription("Remove um usuário da blacklist de tickets.")
        .addUserOption((option) =>
          option
            .setName("usuario")
            .setDescription("Usuário que será liberado.")
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("blacklist-info")
        .setDescription("Consulta a blacklist de um usuário.")
        .addUserOption((option) =>
          option
            .setName("usuario")
            .setDescription("Usuário consultado.")
            .setRequired(true),
        ),
    ),

  async run(client, interaction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === "painel") {
      await handlePanelCommand(client, interaction);
      return;
    }

    if (subcommand === "info") {
      await showTicketInfo(interaction);
      return;
    }

    if (subcommand === "fechar") {
      await closeTicketFromCommand(client, interaction, interaction.options.getString("motivo"));
      return;
    }

    if (subcommand === "reabrir") {
      await reopenTicketFromCommand(client, interaction);
      return;
    }

    if (subcommand === "excluir") {
      await deleteTicketFromCommand(client, interaction);
      return;
    }

    if (subcommand === "blacklist-adicionar") {
      await addBlacklistEntry(
        client,
        interaction,
        interaction.options.getUser("usuario", true),
        interaction.options.getString("motivo", true),
        interaction.options.getInteger("dias") || 1,
        interaction.options.getBoolean("permanente") || false,
      );
      return;
    }

    if (subcommand === "blacklist-remover") {
      await removeBlacklistEntry(client, interaction, interaction.options.getUser("usuario", true));
      return;
    }

    if (subcommand === "blacklist-info") {
      await showBlacklistEntry(interaction, interaction.options.getUser("usuario", true));
    }
  },
};
