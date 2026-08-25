const { Events } = require("discord.js");

const {
  handleTicketChannelDelete,
  handleTicketInteraction,
  initializeTickets,
} = require("../utils/ticket-manager");

module.exports = [
  {
    name: Events.ClientReady,
    once: true,
    execute: initializeTickets,
  },
  {
    name: Events.InteractionCreate,
    execute: handleTicketInteraction,
  },
  {
    name: Events.ChannelDelete,
    execute: handleTicketChannelDelete,
  },
];
