const path = require("path");

const { createLogger } = require("../utils/logger");
const {
  listJavaScriptFiles,
  loadFreshModule,
  toProjectRelativePath,
} = require("../utils/module-loader");

const log = createLogger("events");

function registerEvent(eventDefinition, fileLabel, loadedEvents, client) {
  if (!eventDefinition || typeof eventDefinition !== "object") {
    return false;
  }

  if (typeof eventDefinition.execute !== "function" || !eventDefinition.name) {
    return false;
  }

  const subscribe = eventDefinition.once ? client.once.bind(client) : client.on.bind(client);
  subscribe(eventDefinition.name, (...args) => eventDefinition.execute(...args, client));

  loadedEvents.push(`${fileLabel} -> ${eventDefinition.name}${eventDefinition.once ? " (once)" : ""}`);
  return true;
}

function registerFile(filePath, loadedEvents, client) {
  const eventModule = loadFreshModule(filePath);
  const fileLabel = toProjectRelativePath(filePath);

  if (typeof eventModule.setClient === "function") {
    eventModule.setClient(client);
    loadedEvents.push(`${fileLabel} -> setClient`);
    return;
  }

  if (Array.isArray(eventModule)) {
    let loadedAny = false;

    for (const eventDefinition of eventModule) {
      if (registerEvent(eventDefinition, fileLabel, loadedEvents, client)) {
        loadedAny = true;
      }
    }

    if (!loadedAny) {
      log.warn(`Arquivo ignorado por não exportar eventos válidos: ${fileLabel}`);
    }
    return;
  }

  if (registerEvent(eventModule, fileLabel, loadedEvents, client)) {
    return;
  }

  log.warn(`Arquivo ignorado por formato inválido: ${fileLabel}`);
}

async function eventsHandler(client) {
  const eventsPath = path.resolve(process.cwd(), "Events");
  const loadedEvents = [];
  const files = await listJavaScriptFiles(eventsPath);

  for (const filePath of files) {
    try {
      registerFile(filePath, loadedEvents, client);
    } catch (error) {
      log.error(`Falha ao registrar evento de ${toProjectRelativePath(filePath)}.`, error);
    }
  }

  if (!loadedEvents.length) {
    log.info("Nenhum evento encontrado em Events.");
    return;
  }

  log.info(`Eventos carregados (${loadedEvents.length}): ${loadedEvents.join(" | ")}`);
}

module.exports = eventsHandler;
