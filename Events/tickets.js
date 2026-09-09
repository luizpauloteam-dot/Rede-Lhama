const { Events } = require("discord.js");

const {
  handleTicketInteraction,
  handleTicketChannelDelete,
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
