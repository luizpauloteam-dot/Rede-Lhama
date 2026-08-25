const {
  ActivityType,
  Client,
  Events,
  GatewayIntentBits,
  Partials,
} = require("discord.js");

const config = require("./config");
const { attachDiscordLogBridge, createLogger } = require("./utils/logger");
const { connectMongo, disconnectMongo } = require("./utils/mongodb");

const log = createLogger("core");

function buildIntents() {
  return [
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.Guilds,
    GatewayIntentBits.MessageContent,
  ];
}

const client = new Client({
  intents: buildIntents(),
  partials: [
    Partials.Channel,
    Partials.GuildMember,
    Partials.Message,
    Partials.Reaction,
    Partials.User,
  ],
});

function validateRuntimeConfig() {
  if (!config.discord.token) {
    throw new Error("DISCORD_BOT_TOKEN não configurado no arquivo .env.");
  }

  if (config.tickets.enabled && !config.mongodb.uri) {
    throw new Error("MONGODB_URI não configurado no arquivo .env.");
  }
}

function resolveActivityType(activityTypeName) {
  return ActivityType[activityTypeName] ?? ActivityType.Watching;
}

function registerProcessHandlers() {
  process.on("unhandledRejection", (reason) => {
    log.error("Unhandled rejection.", reason);
  });

  process.on("uncaughtException", (error, origin) => {
    log.error(`Uncaught exception (${origin || "unknown"}).`, error);
  });

  process.on("uncaughtExceptionMonitor", (error, origin) => {
    log.warn(`Uncaught exception monitor (${origin || "unknown"}).`, error);
  });

  const shutdown = async (signal) => {
    log.warn(`Encerrando processo por ${signal}.`);

    try {
      await client.destroy();
    } catch (error) {
      log.error("Falha ao destruir client durante o shutdown.", error);
    }

    try {
      await disconnectMongo();
    } catch (error) {
      log.error("Falha ao desconectar MongoDB durante o shutdown.", error);
    } finally {
      process.exit(0);
    }
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

async function handleSlashCommand(interaction) {
  const command = client.slashCommands?.get(interaction.commandName);

  if (!command) {
    await interaction
      .reply({
        content: "Comando não encontrado.",
        ephemeral: true,
      })
      .catch(() => null);
    return;
  }

  try {
    await command.run(client, interaction);
  } catch (error) {
    log.error(`Falha ao executar comando ${interaction.commandName}.`, error);

    const payload = {
      content: "Não foi possível executar o comando.",
      ephemeral: true,
    };

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload).catch(() => null);
      return;
    }

    await interaction.reply(payload).catch(() => null);
  }
}

function registerClientHandlers() {
  client.once(Events.ClientReady, () => {
    attachDiscordLogBridge(client, config.discord.logChannelId);

    log.info(`Bot conectado como ${client.user.tag} (${client.user.id}).`);
    log.info(`Servidores conectados: ${client.guilds.cache.size}`);

    if (config.discord.presence.activityName) {
      client.user.setPresence({
        activities: [
          {
            name: config.discord.presence.activityName,
            type: resolveActivityType(config.discord.presence.activityType),
          },
        ],
        status: config.discord.presence.status,
      });
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isChatInputCommand()) {
      await handleSlashCommand(interaction);
    }
  });
}

async function bootstrap() {
  validateRuntimeConfig();
  registerProcessHandlers();
  registerClientHandlers();

  await connectMongo();

  await Promise.all([
    require("./Handler/commands")(client),
    require("./Handler/events")(client),
  ]);

  await client.login(config.discord.token);
}

bootstrap().catch((error) => {
  log.error("Falha ao iniciar o bot.", error);
  process.exit(1);
});

module.exports = client;
