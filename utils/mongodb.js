const dns = require("dns");
const mongoose = require("mongoose");

const config = require("../config");
const { createLogger } = require("./logger");

const log = createLogger("mongodb");

let connectionPromise = null;

function hasMongoUri() {
  return Boolean(config.mongodb.uri);
}

async function connectMongo() {
  if (!hasMongoUri()) {
    if (config.tickets.enabled) {
      throw new Error("MONGODB_URI não configurado no arquivo .env.");
    }

    log.warn("MONGODB_URI não configurado. Recursos dependentes de MongoDB ficam inativos.");
    return null;
  }

  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  if (!connectionPromise) {
    if (config.mongodb.dnsServers.length) {
      dns.setServers(config.mongodb.dnsServers);
      log.info(`DNS do MongoDB configurado: ${config.mongodb.dnsServers.join(", ")}`);
    }

    connectionPromise = mongoose
      .connect(config.mongodb.uri, {
        serverSelectionTimeoutMS: 10000,
      })
      .then(() => {
        log.info("MongoDB conectado.");
        return mongoose.connection;
      })
      .catch((error) => {
        connectionPromise = null;
        throw error;
      });
  }

  return connectionPromise;
}

async function disconnectMongo() {
  if (mongoose.connection.readyState === 0) {
    return;
  }

  await mongoose.disconnect();
  connectionPromise = null;
  log.info("MongoDB desconectado.");
}

module.exports = {
  connectMongo,
  disconnectMongo,
  hasMongoUri,
};
