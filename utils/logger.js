const util = require("util");

const DEFAULT_SCOPE = "app";
const MAX_LOG_MESSAGE_LENGTH = 1800;

let discordLogClient = null;
let discordLogChannelId = "";
let isSendingDiscordLog = false;

function nowIso() {
  return new Date().toISOString();
}

function stringifyArg(arg) {
  if (typeof arg === "string") return arg;
  if (arg instanceof Error) return arg.stack || arg.message || String(arg);

  try {
    return util.inspect(arg, {
      depth: 4,
      breakLength: 120,
      maxArrayLength: 25,
      compact: false,
    });
  } catch {
    return String(arg);
  }
}

function formatLine(level, scope, args) {
  const prefix = `[${nowIso()}] [${level.toUpperCase()}] [${scope || DEFAULT_SCOPE}]`;
  const message = args.map(stringifyArg).join(" ");
  return `${prefix} ${message}`.trim();
}

function splitForDiscord(text) {
  const normalized = String(text || "");
  if (!normalized) return [];

  const parts = [];
  for (let index = 0; index < normalized.length; index += MAX_LOG_MESSAGE_LENGTH) {
    parts.push(normalized.slice(index, index + MAX_LOG_MESSAGE_LENGTH));
  }
  return parts;
}

async function forwardToDiscord(level, line) {
  if (!discordLogClient || !discordLogChannelId || isSendingDiscordLog) return;

  isSendingDiscordLog = true;
  try {
    const channel =
      discordLogClient.channels.cache.get(discordLogChannelId) ||
      (await discordLogClient.channels.fetch(discordLogChannelId).catch(() => null));

    if (!channel?.isTextBased?.()) return;

    const chunks = splitForDiscord(line);
    for (const chunk of chunks) {
      await channel.send(`\`\`\`txt\n${chunk}\n\`\`\``).catch(() => null);
    }
  } finally {
    isSendingDiscordLog = false;
  }
}

function emit(level, scope, args) {
  const line = formatLine(level, scope, args);

  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);

  forwardToDiscord(level, line).catch(() => null);
}

function createLogger(scope = DEFAULT_SCOPE) {
  return {
    debug: (...args) => emit("debug", scope, args),
    info: (...args) => emit("info", scope, args),
    warn: (...args) => emit("warn", scope, args),
    error: (...args) => emit("error", scope, args),
  };
}

function attachDiscordLogBridge(client, channelId) {
  discordLogClient = client || null;
  discordLogChannelId = String(channelId || "").trim();
}

module.exports = {
  attachDiscordLogBridge,
  createLogger,
};
