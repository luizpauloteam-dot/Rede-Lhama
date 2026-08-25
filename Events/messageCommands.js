const {
  Events,
  PermissionsBitField,
} = require("discord.js");

const { createLogger } = require("../utils/logger");
const { validateTargetChannel } = require("../utils/discord-channel-access");

const log = createLogger("message-commands");

const COMMAND_PREFIX = "!";
const MAX_MESSAGE_LENGTH = 2000;
const CHANNEL_ARGUMENT_PATTERN = /^(?:<#(?<mentionId>\d{17,20})>|(?<rawId>\d{17,20}))\s+(?<rest>[\s\S]+)$/;
const STAFF_COMMANDS = new Set(["say"]);
const SAFE_ALLOWED_MENTIONS = {
  parse: [],
  repliedUser: false,
};

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function parseCommand(content) {
  const normalizedContent = String(content || "").trimStart();

  if (!normalizedContent.startsWith(COMMAND_PREFIX)) {
    return null;
  }

  const withoutPrefix = normalizedContent.slice(COMMAND_PREFIX.length);
  const match = withoutPrefix.match(/^(?<name>\S+)(?:\s+(?<payload>[\s\S]+))?$/);

  if (!match?.groups) {
    return null;
  }

  return {
    name: normalizeText(match.groups.name),
    payload: String(match.groups.payload || "").trimStart(),
  };
}

function parseChannelPayload(payload) {
  const match = String(payload || "").match(CHANNEL_ARGUMENT_PATTERN);

  if (!match?.groups) {
    return null;
  }

  return {
    channelId: match.groups.mentionId || match.groups.rawId,
    rest: match.groups.rest.trim(),
  };
}

async function reply(message, content) {
  await message
    .reply({
      content,
      allowedMentions: SAFE_ALLOWED_MENTIONS,
    })
    .catch(() => null);
}

function canUseStaffCommand(message) {
  const permissions = message.channel.permissionsFor(message.member);
  return Boolean(permissions?.has(PermissionsBitField.Flags.ManageMessages));
}

async function validateMessageTargetChannel(message, client, channelId) {
  return validateTargetChannel({
    guild: message.guild,
    guildId: message.guildId,
    channelId,
    member: message.member,
    botMember: message.guild.members.me || client.user,
  });
}

async function handleSayCommand(message, client, payload) {
  const parsedPayload = parseChannelPayload(payload);
  if (!parsedPayload?.rest) {
    await reply(message, "Uso: `!say #canal texto`.");
    return;
  }

  if (parsedPayload.rest.length > MAX_MESSAGE_LENGTH) {
    await reply(message, `A mensagem precisa ter no maximo ${MAX_MESSAGE_LENGTH} caracteres.`);
    return;
  }

  const { error, targetChannel } = await validateMessageTargetChannel(message, client, parsedPayload.channelId);
  if (error) {
    await reply(message, error);
    return;
  }

  await targetChannel.send({
    content: parsedPayload.rest,
    allowedMentions: SAFE_ALLOWED_MENTIONS,
  });
  await reply(message, `Mensagem enviada em ${targetChannel}.`);
}

async function execute(message, client) {
  if (!message.guild || message.author.bot) {
    return;
  }

  const command = parseCommand(message.content);
  if (!command || !STAFF_COMMANDS.has(command.name)) {
    return;
  }

  if (!canUseStaffCommand(message)) {
    await reply(message, "Voce precisa da permissao `Gerenciar mensagens` para usar este comando.");
    return;
  }

  try {
    await handleSayCommand(message, client, command.payload);
  } catch (error) {
    log.error(`Falha ao executar comando ${command.name}.`, error);
    await reply(message, "Nao foi possivel executar este comando.");
  }
}

module.exports = {
  name: Events.MessageCreate,
  execute,
};
