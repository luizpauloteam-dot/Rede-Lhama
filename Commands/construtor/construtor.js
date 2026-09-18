const { ChannelType, InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require("discord.js");
const config = require("../../config");
const { validateTargetChannel } = require("../../utils/discord-channel-access");
const { upsertBuilderApplicationPanel } = require("../../utils/staff-application-manager");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("construtor")
    .setDescription("Gerencia o painel de candidatura a construtor.")
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) => subcommand
      .setName("painel")
      .setDescription("Publica ou atualiza o painel de candidatura.")
      .addChannelOption((option) => option.setName("canal").setDescription("Canal onde o painel será publicado.")
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(false))),

  async run(client, interaction) {
    if (!interaction.inGuild() || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({ content: "Você precisa da permissão Gerenciar servidor para publicar este painel.", flags: MessageFlags.Ephemeral });
      return;
    }
    if (!config.builderApplications.reviewChannelId) {
      await interaction.reply({ content: "Configure o canal de análise das candidaturas de construtor antes de publicar o painel.", flags: MessageFlags.Ephemeral });
      return;
    }
    const panelChannel = interaction.options.getChannel("canal") || interaction.channel;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const validation = await validateTargetChannel({
      guild: interaction.guild, guildId: interaction.guildId, channelId: panelChannel.id,
      member: interaction.member, botMember: interaction.guild.members.me || client.user,
    });
    if (validation.error) {
      await interaction.editReply(validation.error);
      return;
    }
    const message = await upsertBuilderApplicationPanel(client, validation.targetChannel);
    await interaction.editReply(`Painel de candidatura publicado/atualizado em ${validation.targetChannel}: ${message.url}`);
  },
};
