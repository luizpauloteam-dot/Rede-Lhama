const path = require("path");
const { Collection, Events } = require("discord.js");

const config = require("../config");
const { createLogger } = require("../utils/logger");
const {
  listJavaScriptFiles,
  loadFreshModule,
  toProjectRelativePath,
} = require("../utils/module-loader");

const log = createLogger("commands");

function getCommandScope() {
  return String(config.discord.commandScope || "guild").toLowerCase();
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

function getTargetGuilds(client) {
  if (!config.discord.guildIds.length) {
    return [...client.guilds.cache.values()];
  }

  return config.discord.guildIds
    .map((guildId) => client.guilds.cache.get(guildId))
    .filter(Boolean);
}

function isValidCommandModule(command, commandData, commandName) {
  return Boolean(commandData && commandName && typeof resolveCommandExecutor(command) === "function");
}

async function registerSlashCommands(client, slashArray, loadedCommandNames) {
  try {
    if (getCommandScope() === "global") {
      await client.application.commands.set(slashArray);
      log.info(slashArray.length ? "Comandos registrados globalmente." : "Comandos globais removidos.");
    } else {
      const targetGuilds = getTargetGuilds(client);

      if (!targetGuilds.length) {
        log.warn("Nenhum servidor encontrado para sincronizar comandos.");
        return;
      }

      for (const guild of targetGuilds) {
        await guild.commands.set(slashArray);
      }

      log.info(
        slashArray.length
          ? `Comandos registrados em ${targetGuilds.length} servidor(es).`
          : `Comandos removidos em ${targetGuilds.length} servidor(es).`,
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
        await guild.commands.set(slashArray);
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
