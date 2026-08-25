const fs = require("fs").promises;
const path = require("path");

const config = require("../config");

const CODE_PATTERN = /^\d{4}$/;
const LINE_SEPARATOR = ";";

let storeLock = Promise.resolve();

class LinkValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "LinkValidationError";
  }
}

function sanitizeField(value) {
  return String(value || "")
    .trim()
    .replace(/[;\r\n]/g, " ");
}

function normalizeCode(value) {
  const code = String(value || "").trim();

  if (!CODE_PATTERN.test(code)) {
    throw new LinkValidationError("Informe o código de 4 dígitos gerado no Minecraft.");
  }

  return code;
}

function normalizeVipKeys(value) {
  return String(value || "")
    .split(",")
    .map((key) => key.trim().toLowerCase())
    .filter(Boolean);
}

async function ensureParentDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function readTextFile(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return "";
    }

    throw error;
  }
}

async function writeFileAtomic(filePath, content) {
  await ensureParentDir(filePath);

  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );

  await fs.writeFile(tempPath, content, "utf8");
  await fs.rename(tempPath, filePath);
}

function withStoreLock(action) {
  const next = storeLock.then(action, action);
  storeLock = next.catch(() => null);
  return next;
}

function parsePendingCodes(content) {
  return String(content || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const [code, uuid, nick, expiresAtMillis, vipKeys] = line.split(LINE_SEPARATOR);
      return {
        code: sanitizeField(code),
        uuid: sanitizeField(uuid),
        nick: sanitizeField(nick),
        expiresAtMillis: Number(expiresAtMillis),
        vipKeys: normalizeVipKeys(vipKeys),
      };
    })
    .filter((entry) => CODE_PATTERN.test(entry.code) && entry.uuid && entry.nick);
}

function parseLinkedAccounts(content) {
  return String(content || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const [uuid, nick, discordId, discordTag, linkedAt, vipKeys] = line.split(LINE_SEPARATOR);
      return {
        uuid: sanitizeField(uuid),
        nick: sanitizeField(nick),
        discordId: sanitizeField(discordId),
        discordTag: sanitizeField(discordTag),
        linkedAt: sanitizeField(linkedAt),
        vipKeys: normalizeVipKeys(vipKeys),
      };
    })
    .filter((entry) => entry.uuid && entry.nick && entry.discordId);
}

function serializePendingCodes(entries) {
  const lines = ["# code;uuid;nick;expiresAtMillis;vipKeys"];

  entries
    .sort((left, right) => left.code.localeCompare(right.code))
    .forEach((entry) => {
      lines.push([
        sanitizeField(entry.code),
        sanitizeField(entry.uuid),
        sanitizeField(entry.nick),
        Number(entry.expiresAtMillis) || 0,
        normalizeVipKeys(entry.vipKeys).join(","),
      ].join(LINE_SEPARATOR));
    });

  return `${lines.join("\n")}\n`;
}

function serializeLinkedAccounts(entries) {
  const lines = ["# uuid;nick;discordId;discordTag;linkedAt;vipKeys"];

  entries
    .sort((left, right) => left.nick.localeCompare(right.nick, "pt-BR", { sensitivity: "base" }))
    .forEach((entry) => {
      lines.push([
        sanitizeField(entry.uuid),
        sanitizeField(entry.nick),
        sanitizeField(entry.discordId),
        sanitizeField(entry.discordTag),
        sanitizeField(entry.linkedAt),
        normalizeVipKeys(entry.vipKeys).join(","),
      ].join(LINE_SEPARATOR));
    });

  return `${lines.join("\n")}\n`;
}

async function readPendingCodes() {
  return parsePendingCodes(await readTextFile(config.link.pendingCodesFilePath));
}

async function readLinkedAccounts() {
  return parseLinkedAccounts(await readTextFile(config.link.linkedAccountsFilePath));
}

function removeExpiredCodes(entries, now = Date.now()) {
  return entries.filter((entry) => Number(entry.expiresAtMillis) > now);
}

async function consumeLinkCode(input) {
  return withStoreLock(async () => {
    const code = normalizeCode(input.code);
    const discordId = sanitizeField(input.discordId);
    const discordTag = sanitizeField(input.discordTag || discordId);
    const now = Date.now();
    const pendingCodes = removeExpiredCodes(await readPendingCodes(), now);
    const linkedAccounts = await readLinkedAccounts();
    const pendingEntry = pendingCodes.find((entry) => entry.code === code);

    if (!pendingEntry) {
      await writeFileAtomic(config.link.pendingCodesFilePath, serializePendingCodes(pendingCodes));
      throw new LinkValidationError("Código inválido ou expirado. Gere outro com `/discord conectar` no Minecraft.");
    }

    const linkedByUuid = linkedAccounts.find((entry) => entry.uuid === pendingEntry.uuid);
    if (linkedByUuid && linkedByUuid.discordId !== discordId) {
      throw new LinkValidationError("Essa conta do Minecraft já está vinculada a outro Discord.");
    }

    const linkedByDiscord = linkedAccounts.find((entry) => entry.discordId === discordId);
    if (linkedByDiscord && linkedByDiscord.uuid !== pendingEntry.uuid) {
      throw new LinkValidationError("Seu Discord já está vinculado a outra conta do Minecraft.");
    }

    const linkedAccount = {
      uuid: pendingEntry.uuid,
      nick: pendingEntry.nick,
      discordId,
      discordTag,
      linkedAt: new Date(now).toISOString(),
      vipKeys: pendingEntry.vipKeys,
    };

    const remainingCodes = pendingCodes.filter((entry) => entry.code !== code);
    const nextLinkedAccounts = [
      ...linkedAccounts.filter(
        (entry) => entry.uuid !== linkedAccount.uuid && entry.discordId !== linkedAccount.discordId,
      ),
      linkedAccount,
    ];

    await writeFileAtomic(config.link.pendingCodesFilePath, serializePendingCodes(remainingCodes));
    await writeFileAtomic(config.link.linkedAccountsFilePath, serializeLinkedAccounts(nextLinkedAccounts));

    return linkedAccount;
  });
}

module.exports = {
  LinkValidationError,
  consumeLinkCode,
  normalizeCode,
  readLinkedAccounts,
  readPendingCodes,
};
