const { Events } = require("discord.js");
const { handleStaffApplicationInteraction } = require("../utils/staff-application-manager");

module.exports = { name: Events.InteractionCreate, execute: handleStaffApplicationInteraction };
