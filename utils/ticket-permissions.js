const { PermissionsBitField } = require("discord.js");

const config = require("../config");

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function hasAnyConfiguredRole(member, roleIds) {
  if (!member || !roleIds?.length) {
    return false;
  }

  return roleIds.some((roleId) => member.roles.cache.has(roleId));
}

function hasStaffFallbackPermission(member) {
  return Boolean(member?.permissions?.has(PermissionsBitField.Flags.ManageMessages));
}

function isTicketAdministrator(member) {
  return Boolean(
    member?.permissions?.has(PermissionsBitField.Flags.Administrator) ||
      hasAnyConfiguredRole(member, config.tickets.administratorRoles),
  );
}

function isTicketCoordinator(member) {
  return Boolean(isTicketAdministrator(member) || hasAnyConfiguredRole(member, config.tickets.coordinationRoles));
}

function isTicketSupport(member, categoryType = "") {
  if (categoryType === "coordination") {
    return isTicketCoordinator(member);
  }

  return Boolean(
    isTicketCoordinator(member) ||
      hasAnyConfiguredRole(member, config.tickets.supportRoles) ||
      hasStaffFallbackPermission(member),
  );
}

function getVisibleStaffRoleIds(categoryType) {
  if (categoryType === "coordination") {
    return unique([...config.tickets.coordinationRoles, ...config.tickets.administratorRoles]);
  }

  return unique([
    ...config.tickets.supportRoles,
    ...config.tickets.coordinationRoles,
    ...config.tickets.administratorRoles,
  ]);
}

function buildTicketOverwrites(guild, categoryType, ownerId = "") {
  const flags = PermissionsBitField.Flags;
  const access = [flags.ViewChannel, flags.SendMessages, flags.AttachFiles, flags.ReadMessageHistory, flags.EmbedLinks];
  const staffRoles = getVisibleStaffRoleIds(categoryType).filter((id) => id !== guild.id);
  const overwrites = [
    { id: guild.id, deny: [flags.ViewChannel] },
    ...staffRoles.map((id) => ({ id, allow: [...access, flags.ManageMessages] })),
    { id: guild.members.me.id, allow: [...access, flags.ManageChannels, flags.ManageMessages, flags.ManageRoles] },
  ];
  if (ownerId && ownerId !== guild.members.me.id) overwrites.push({ id: ownerId, allow: access });
  return overwrites;
}

function getTicketNotificationRoleIds(categoryType) {
  const roles = categoryType === "coordination"
    ? getVisibleStaffRoleIds(categoryType)
    : config.tickets.supportRoles;
  return unique(roles).filter((id) => id !== config.tickets.guildId);
}

module.exports = {
  getTicketNotificationRoleIds,
  buildTicketOverwrites,
  getVisibleStaffRoleIds,
  hasAnyConfiguredRole,
  isTicketAdministrator,
  isTicketCoordinator,
  isTicketSupport,
};
