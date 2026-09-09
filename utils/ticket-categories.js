const { ChannelType } = require("discord.js");
const config = require("../config");
const { Ticket, TicketCategory, ACTIVE_TICKET_STATUSES } = require("./ticket-models");
const { buildTicketOverwrites } = require("./ticket-permissions");

const CATEGORY_CAPACITY = 50;
// Serialize creation and cleanup, including the channel creation, in this bot process.
let pending = Promise.resolve();
function withCategoryLock(operation) {
  const result = pending.then(operation);
  pending = result.catch(() => {});
  return result;
}

function isProtectedCategory(id) {
  return id === config.tickets.anchorCategoryId || config.tickets.protectedCategoryIds.includes(id);
}

async function orderCategories(guild) {
  const channels = await guild.channels.fetch();
  const anchor = channels.get(config.tickets.anchorCategoryId);
  if (guild.id !== config.tickets.guildId || anchor?.type !== ChannelType.GuildCategory) {
    throw new Error("Categoria principal de atendimento não encontrada no servidor oficial.");
  }
  const records = await TicketCategory.find({ guildId: guild.id });
  const managed = records.filter((record) => !isProtectedCategory(record.discordCategoryId) &&
    channels.get(record.discordCategoryId)?.type === ChannelType.GuildCategory);
  managed.sort((a, b) => (config.tickets.categories[a.categoryType]?.order || 99) -
    (config.tickets.categories[b.categoryType]?.order || 99) || a.instance - b.instance);
  // Never submit the anchor (or any ordinary category) to a position mutation.
  for (let index = 0; index < managed.length; index += 1) {
    const channel = channels.get(managed[index].discordCategoryId);
    await channel.setPosition(anchor.position + index + 1);
  }
}

async function resolveTicketCategory(guild, categoryType) {
  if (guild.id !== config.tickets.guildId || !config.tickets.categories[categoryType]) {
    throw new Error("Servidor ou categoria de ticket inválidos.");
  }
  const channels = await guild.channels.fetch();
  const anchor = channels.get(config.tickets.anchorCategoryId);
  if (anchor?.type !== ChannelType.GuildCategory) throw new Error("Categoria principal não encontrada.");
  const records = await TicketCategory.find({ guildId: guild.id, categoryType }).sort({ instance: 1 });
  for (const record of records) {
    const category = channels.get(record.discordCategoryId);
    if (isProtectedCategory(record.discordCategoryId)) continue;
    if (!category) {
      await TicketCategory.deleteOne({ _id: record._id });
      continue;
    }
    if (category.type !== ChannelType.GuildCategory) continue;
    if (channels.filter((channel) => channel.parentId === category.id).size < CATEGORY_CAPACITY) {
      await orderCategories(guild);
      return category;
    }
  }
  const instance = Math.max(0, ...records.map((record) => record.instance)) + 1;
  const name = config.tickets.categories[categoryType].categoryName + (instance > 1 ? `-${instance}` : "");
  const category = await guild.channels.create({
    name, type: ChannelType.GuildCategory,
    permissionOverwrites: buildTicketOverwrites(guild, categoryType),
    reason: "Categoria automática do sistema de tickets",
  });
  // A category is only eligible for cleanup after its provenance is persisted.
  await TicketCategory.create({ guildId: guild.id, discordCategoryId: category.id, categoryType, instance });
  await orderCategories(guild);
  return category;
}

async function cleanupTicketCategory(guild, categoryId) {
  if (guild.id !== config.tickets.guildId || !categoryId || isProtectedCategory(categoryId)) return false;
  const record = await TicketCategory.findOne({ guildId: guild.id, discordCategoryId: categoryId });
  if (!record) return false;
  const channels = await guild.channels.fetch();
  const category = channels.get(categoryId);
  if (!category) {
    await TicketCategory.deleteOne({ _id: record._id });
    return false;
  }
  if (category.type !== ChannelType.GuildCategory || channels.some((channel) => channel.parentId === categoryId)) return false;
  if (await Ticket.exists({ guildId: guild.id, categoryId, status: { $in: ACTIVE_TICKET_STATUSES } })) return false;
  await category.delete("Último canal removido da categoria automática de tickets");
  await TicketCategory.deleteOne({ _id: record._id });
  return true;
}

module.exports = { withCategoryLock, resolveTicketCategory, cleanupTicketCategory, orderCategories, isProtectedCategory };
