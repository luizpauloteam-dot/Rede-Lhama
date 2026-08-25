const { PermissionsBitField } = require("discord.js");

async function resolveGuildChannel(guild, channelId) {
  return guild.channels.cache.get(channelId) || (await guild.channels.fetch(channelId).catch(() => null));
}

function isSendableTextChannel(channel, guildId) {
  return Boolean(
    channel &&
      channel.guildId === guildId &&
      typeof channel.isTextBased === "function" &&
      channel.isTextBased() &&
      typeof channel.send === "function",
  );
}

function getSendPermissionFlag(channel) {
  return channel.isThread?.()
    ? PermissionsBitField.Flags.SendMessagesInThreads
    : PermissionsBitField.Flags.SendMessages;
}

function canSendToChannel(channel, memberOrUser) {
  const permissions = channel.permissionsFor(memberOrUser);
  return Boolean(
    permissions?.has([
      PermissionsBitField.Flags.ViewChannel,
      getSendPermissionFlag(channel),
    ]),
  );
}

async function validateTargetChannel({ guild, guildId, channelId, member, botMember }) {
  const targetChannel = await resolveGuildChannel(guild, channelId);

  if (!isSendableTextChannel(targetChannel, guildId)) {
    return {
      error: "Informe um canal de texto deste servidor.",
      targetChannel: null,
    };
  }

  if (!canSendToChannel(targetChannel, member)) {
    return {
      error: "Você não pode enviar mensagens nesse canal.",
      targetChannel,
    };
  }

  if (!canSendToChannel(targetChannel, botMember)) {
    return {
      error: "Não tenho permissão para enviar mensagens nesse canal.",
      targetChannel,
    };
  }

  return {
    error: null,
    targetChannel,
  };
}

module.exports = {
  canSendToChannel,
  isSendableTextChannel,
  resolveGuildChannel,
  validateTargetChannel,
};
