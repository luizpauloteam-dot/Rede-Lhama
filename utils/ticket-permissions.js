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
  return Boolean(
    member?.permissions?.has(PermissionsBitField.Flags.ManageMessages) ||
      member?.permissions?.has(PermissionsBitField.Flags.ManageThreads),
  );
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

module.exports = {
  getVisibleStaffRoleIds,
  hasAnyConfiguredRole,
  isTicketAdministrator,
  isTicketCoordinator,
  isTicketSupport,
};
