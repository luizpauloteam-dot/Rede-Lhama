const {
  MessageFlags,
  SlashCommandBuilder,
} = require("discord.js");

const config = require("../../config");
const { buildSuggestionModal } = require("../../utils/suggestion-components");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("sugerir")
    .setDescription("Envia uma sugestão para a Rede Lhama."),

  async run(client, interaction) {
    if (!config.suggestions.enabled) {
      await interaction.reply({
        content: "O sistema de sugestões está desativado.",
        flags: MessageFlags.Ephemeral,
        allowedMentions: {
          parse: [],
          repliedUser: false,
        },
      });
      return;
    }

    await interaction.showModal(buildSuggestionModal());
  },
};
