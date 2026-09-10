const { Events } = require("discord.js");
const { handleTeamInteraction } = require("../utils/team-manager");

module.exports = { name: Events.InteractionCreate, execute: handleTeamInteraction };
