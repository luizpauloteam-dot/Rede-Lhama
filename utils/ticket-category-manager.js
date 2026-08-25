const { ChannelType, PermissionsBitField } = require("discord.js");

const config = require("../config");
const { createLogger } = require("./logger");
const {
  ACTIVE_TICKET_STATUSES,
  Ticket,
  TicketCategory,
} = require("./ticket-models");
const { getTicketCategoryConfig, listTicketCategoryEntries } = require("./ticket-common");
const {
  TICKET_BOT_PERMISSIONS,
  TICKET_STAFF_PERMISSIONS,
  getVisibleStaffRoleIds,
} = require("./ticket-permissions");

const log = createLogger("ticket-categories");
const PENDING_CATEGORY_PREFIX = "pending:";
const PENDING_CATEGORY_TTL_MS = 120000;

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isPendingCategoryId(categoryId) {
  return String(categoryId || "").startsWith(PENDING_CATEGORY_PREFIX);
}

function isRecentPendingRecord(record) {
  if (!isPendingCategoryId(record?.discordCategoryId)) {
    return false;
  }

  return Date.now() - new Date(record.createdAt || 0).getTime() <= PENDING_CATEGORY_TTL_MS;
}

function buildCategoryName(categoryConfig, instance) {
  if (instance <= 1) {
    return categoryConfig.discordCategoryName;
  }

  return `${categoryConfig.discordCategoryName}-${instance}`;
}

function buildCategoryPermissionOverwrites(guild, categoryType) {
  const overwrites = [
    {
      id: guild.id,
      deny: [PermissionsBitField.Flags.ViewChannel],
    },
  ];

  for (const roleId of getVisibleStaffRoleIds(categoryType)) {
    overwrites.push({
      id: roleId,
      allow: TICKET_STAFF_PERMISSIONS,
    });
  }

  if (guild.members.me?.id) {
    overwrites.push({
      id: guild.members.me.id,
      allow: TICKET_BOT_PERMISSIONS,
    });
  }

  return overwrites;
}

async function fetchGuildChannels(guild) {
  await guild.channels.fetch().catch((error) => {
    log.warn(`Não foi possível atualizar cache de canais do servidor ${guild.id}.`, error);
  });
}

async function resolveGuildCategory(guild, categoryId) {
  if (!categoryId || isPendingCategoryId(categoryId)) {
    return null;
  }

  const channel =
    guild.channels.cache.get(categoryId) ||
    (await guild.channels.fetch(categoryId).catch(() => null));

  if (channel?.type !== ChannelType.GuildCategory || channel.guildId !== guild.id) {
    return null;
  }

  return channel;
}

function countCategoryChildren(guild, categoryId) {
  return guild.channels.cache.filter((channel) => channel.parentId === categoryId).size;
}

async function cleanupInvalidCategoryRecords(guild) {
  const records = await TicketCategory.find({ guildId: guild.id });

  for (const record of records) {
    if (isRecentPendingRecord(record)) {
      continue;
    }

    if (record.discordCategoryId === config.tickets.categoryAnchorId) {
      await TicketCategory.deleteOne({ _id: record._id });
      log.warn(`Registro inválido removido por apontar para a categoria âncora protegida (${record.discordCategoryId}).`);
      continue;
    }

    if (isPendingCategoryId(record.discordCategoryId)) {
      await TicketCategory.deleteOne({ _id: record._id });
      log.warn(`Reserva antiga de categoria removida: ${record.discordCategoryId}.`);
      continue;
    }

    const category = await resolveGuildCategory(guild, record.discordCategoryId);
    if (!category) {
      await TicketCategory.deleteOne({ _id: record._id });
      log.warn(`Registro de categoria removido porque o canal não existe mais: ${record.discordCategoryId}.`);
    }
  }
}

async function reorderManagedCategories(guild) {
  if (!config.tickets.categoryAnchorId) {
    return;
  }

  await fetchGuildChannels(guild);

  const anchor = await resolveGuildCategory(guild, config.tickets.categoryAnchorId);
  if (!anchor) {
    log.warn(`Categoria âncora de tickets não encontrada: ${config.tickets.categoryAnchorId}`);
    return;
  }

  const records = await TicketCategory.find({ guildId: guild.id }).sort({ categoryType: 1, instance: 1 });
  const orderMap = new Map(listTicketCategoryEntries().map((category) => [category.type, category.order]));
  const managedCategories = [];

  for (const record of records) {
    if (isPendingCategoryId(record.discordCategoryId)) {
      continue;
    }

    const category = await resolveGuildCategory(guild, record.discordCategoryId);
    if (!category) {
      continue;
    }

    managedCategories.push({
      channel: category,
      order: orderMap.get(record.categoryType) || 999,
      instance: record.instance,
    });
  }

  managedCategories.sort((left, right) => {
    if (left.order !== right.order) {
      return left.order - right.order;
    }

    return left.instance - right.instance;
  });

  if (!managedCategories.length) {
    return;
  }

  await guild.channels
    .setPositions(
      managedCategories.map((item, index) => ({
        channel: item.channel.id,
        position: anchor.position + index + 1,
      })),
    )
    .catch((error) => {
      log.warn("Não foi possível reposicionar categorias de tickets.", error);
    });
}

async function getAvailableManagedCategory(guild, categoryType) {
  await cleanupInvalidCategoryRecords(guild);
  await fetchGuildChannels(guild);

  const records = await TicketCategory.find({ guildId: guild.id, categoryType }).sort({ instance: 1 });

  for (const record of records) {
    const category = await resolveGuildCategory(guild, record.discordCategoryId);
    if (!category) {
      continue;
    }

    if (countCategoryChildren(guild, category.id) < config.tickets.maxChannelsPerCategory) {
      return {
        category,
        record,
        created: false,
      };
    }
  }

  return null;
}

async function createManagedCategory(guild, categoryType) {
  if (!config.tickets.autoCreateCategories) {
    throw new Error("Criação automática de categorias de tickets está desativada.");
  }

  const categoryConfig = getTicketCategoryConfig(categoryType);
  if (!categoryConfig) {
    throw new Error(`Categoria de ticket inválida: ${categoryType}`);
  }

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const pendingRecord = await TicketCategory.findOne({ guildId: guild.id, categoryType }).sort({ createdAt: -1 });
    if (isRecentPendingRecord(pendingRecord)) {
      await sleep(750);

      const available = await getAvailableManagedCategory(guild, categoryType);
      if (available) {
        return available;
      }

      continue;
    }

    const lastRecord = await TicketCategory.findOne({ guildId: guild.id, categoryType }).sort({ instance: -1 });
    const instance = Number(lastRecord?.instance || 0) + 1;
    const pendingCategoryId = `${PENDING_CATEGORY_PREFIX}${guild.id}:${categoryType}:${instance}:${Date.now()}`;

    let record;
    try {
      record = await TicketCategory.create({
        guildId: guild.id,
        discordCategoryId: pendingCategoryId,
        categoryType,
        instance,
      });
    } catch (error) {
      if (error?.code === 11000) {
        continue;
      }

      throw error;
    }

    let category;
    try {
      category = await guild.channels.create({
        name: buildCategoryName(categoryConfig, instance),
        type: ChannelType.GuildCategory,
        permissionOverwrites: buildCategoryPermissionOverwrites(guild, categoryType),
        reason: "Categoria automática do sistema de tickets.",
      });

      record.discordCategoryId = category.id;
      await record.save();
      await reorderManagedCategories(guild);

      return {
        category,
        record,
        created: true,
      };
    } catch (error) {
      await TicketCategory.deleteOne({ _id: record._id }).catch(() => null);
      if (category?.deletable) {
        await category.delete("Rollback de categoria de ticket após falha.").catch(() => null);
      }
      throw error;
    }
  }

  throw new Error(`Não foi possível reservar uma categoria automática para ${categoryType}.`);
}

async function ensureTicketCategory(guild, categoryType) {
  const available = await getAvailableManagedCategory(guild, categoryType);

  if (available) {
    await reorderManagedCategories(guild);
    return available;
  }

  return createManagedCategory(guild, categoryType);
}

async function cleanupEmptyManagedCategory(guild, categoryId) {
  if (!config.tickets.autoDeleteEmptyCategories || !categoryId) {
    return false;
  }

  if (categoryId === config.tickets.categoryAnchorId) {
    return false;
  }

  const record = await TicketCategory.findOne({
    guildId: guild.id,
    discordCategoryId: categoryId,
  });

  if (!record) {
    return false;
  }

  await fetchGuildChannels(guild);
  const category = await resolveGuildCategory(guild, categoryId);
  if (!category) {
    await TicketCategory.deleteOne({ _id: record._id });
    return true;
  }

  const childCount = countCategoryChildren(guild, categoryId);
  const activeTicketCount = await Ticket.countDocuments({
    guildId: guild.id,
    categoryId,
    status: {
      $in: ACTIVE_TICKET_STATUSES,
    },
  });

  if (childCount > 0 || activeTicketCount > 0) {
    return false;
  }

  await category.delete("Categoria automática de tickets vazia.").catch((error) => {
    log.warn(`Não foi possível excluir categoria automática vazia ${categoryId}.`, error);
  });
  await TicketCategory.deleteOne({ _id: record._id });
  return true;
}

async function syncManagedCategories(client) {
  for (const guild of client.guilds.cache.values()) {
    await cleanupInvalidCategoryRecords(guild);
    await reorderManagedCategories(guild);
  }
}

module.exports = {
  cleanupEmptyManagedCategory,
  ensureTicketCategory,
  reorderManagedCategories,
  resolveGuildCategory,
  syncManagedCategories,
};
