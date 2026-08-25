const path = require("path");
const {
  Collection,
  Events,
  REST,
  Routes,
} = require("discord.js");

const config = require("../config");
const { createLogger } = require("../utils/logger");
const {
  listJavaScriptFiles,
  loadFreshModule,
  toProjectRelativePath,
} = require("../utils/module-loader");

const log = createLogger("commands");

function getCommandScope() {
  const scope = String(config.discord.commandScope || "guild").toLowerCase();
  return scope === "global" ? "global" : "guild";
}

function normalizeCommandData(command) {
  if (command.data?.toJSON) {
    return command.data.toJSON();
  }

  return command.data || command;
}

function resolveCommandExecutor(command) {
  return command.run || command.execute || null;
}

function resolveCommandName(command, commandData) {
  return command.name || commandData.name || null;
}

function getTargetGuildIds(client) {
  if (config.discord.guildIds.length) {
    return config.discord.guildIds;
  }

  return [...client.guilds.cache.keys()];
}

function isValidCommandModule(command, commandData, commandName) {
  return Boolean(commandData && commandName && typeof resolveCommandExecutor(command) === "function");
}

async function registerSlashCommands(client, slashArray, loadedCommandNames) {
  try {
    const applicationId = config.discord.clientId || client.application?.id || client.user?.id;

    if (!applicationId) {
      log.warn("Nao foi possivel identificar o DISCORD_CLIENT_ID para sincronizar comandos.");
      return;
    }

    const rest = new REST({ version: "10" }).setToken(config.discord.token);
    const commandScope = getCommandScope();

    if (commandScope === "global") {
      await rest.put(Routes.applicationCommands(applicationId), {
        body: slashArray,
      });
      log.info(slashArray.length ? "Comandos registrados globalmente." : "Comandos globais removidos.");
    } else {
      const targetGuildIds = getTargetGuildIds(client);

      if (!targetGuildIds.length) {
        log.warn("Nenhum servidor encontrado para sincronizar comandos. Configure DISCORD_GUILD_IDS na hospedagem.");
        return;
      }

      for (const guildId of targetGuildIds) {
        await rest.put(Routes.applicationGuildCommands(applicationId, guildId), {
          body: slashArray,
        });
      }

      log.info(
        slashArray.length
          ? `Comandos registrados em ${targetGuildIds.length} servidor(es).`
          : `Comandos removidos em ${targetGuildIds.length} servidor(es).`,
      );
    }

    if (loadedCommandNames.length) {
      log.info(`Comandos ativos (${loadedCommandNames.length}): ${loadedCommandNames.join(", ")}`);
    } else {
      log.info("Nenhum comando slash ativo.");
    }
  } catch (error) {
    log.error("Erro ao sincronizar comandos.", error);
  }
}

async function commandsHandler(client) {
  const slashArray = [];
  const loadedCommandNames = [];
  const loadedNames = new Set();

  client.slashCommands = new Collection();

  try {
    const commandsPath = path.resolve(process.cwd(), "Commands");
    const files = await listJavaScriptFiles(commandsPath);

    for (const filePath of files) {
      const command = loadFreshModule(filePath);
      const commandData = normalizeCommandData(command);
      const commandName = resolveCommandName(command, commandData);
      const fileLabel = toProjectRelativePath(filePath);

      if (!isValidCommandModule(command, commandData, commandName)) {
        log.warn(`Arquivo ignorado por comando invalido: ${fileLabel}`);
        continue;
      }

      if (loadedNames.has(commandName)) {
        log.warn(`Comando duplicado ignorado (${commandName}) em ${fileLabel}`);
        continue;
      }

      const commandExecutor = resolveCommandExecutor(command);

      loadedNames.add(commandName);
      client.slashCommands.set(commandName, {
        ...command,
        run: commandExecutor,
      });
      slashArray.push(commandData);
      loadedCommandNames.push(commandName);
    }

    client.once(Events.ClientReady, async () => {
      await registerSlashCommands(client, slashArray, loadedCommandNames);
    });

    client.on(Events.GuildCreate, async (guild) => {
      if (getCommandScope() === "global" || !slashArray.length) {
        return;
      }

      if (config.discord.guildIds.length && !config.discord.guildIds.includes(guild.id)) {
        return;
      }

      try {
        const applicationId = config.discord.clientId || client.application?.id || client.user?.id;

        if (!applicationId) {
          log.warn(`Nao foi possivel registrar comandos no servidor ${guild.name}: DISCORD_CLIENT_ID ausente.`);
          return;
        }

        const rest = new REST({ version: "10" }).setToken(config.discord.token);
        await rest.put(Routes.applicationGuildCommands(applicationId, guild.id), {
          body: slashArray,
        });
        log.info(`Comandos registrados no servidor ${guild.name}.`);
      } catch (error) {
        log.error(`Erro ao registrar comandos no servidor ${guild.name}.`, error);
      }
    });
  } catch (error) {
    log.error("Erro ao carregar comandos.", error);
  }
}

module.exports = commandsHandler;
