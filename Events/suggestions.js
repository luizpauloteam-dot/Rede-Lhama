const { Events } = require("discord.js");

const { handleSuggestionInteraction } = require("../utils/suggestion-manager");

module.exports = {
  name: Events.InteractionCreate,
  execute: handleSuggestionInteraction,
};
