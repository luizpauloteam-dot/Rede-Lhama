const { InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require("discord.js");
const { buildTeamModal } = require("../../utils/team-components");
const { resolveTeamRoles } = require("../../utils/team-roles");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("equipe")
    .setDescription("Registra a entrada ou remoção de um membro da equipe e altera seu cargo.")
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addStringOption((option) => option
      .setName("tipo")
      .setDescription("Tipo de alteração na equipe.")
      .setRequired(true)
      .addChoices({ name: "entrar", value: "entrar" }, { name: "remover", value: "remover" })),

  async run(client, interaction) {
    if (!interaction.inGuild() || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles)) {
      await interaction.reply({ content: "Você precisa da permissão Gerenciar cargos neste servidor.", flags: MessageFlags.Ephemeral });
      return;
    }
    let teamRoles;
    try {
      teamRoles = resolveTeamRoles(interaction.guild.roles.cache);
    } catch (error) {
      await interaction.reply({ content: error.message, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
      return;
    }
    await interaction.showModal(buildTeamModal(interaction.options.getString("tipo", true), teamRoles.ranks));
  },
};
