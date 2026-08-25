const { PermissionsBitField } = require("discord.js");

const config = require("../config");

const TICKET_USER_PERMISSIONS = [
  PermissionsBitField.Flags.ViewChannel,
  PermissionsBitField.Flags.SendMessages,
  PermissionsBitField.Flags.AttachFiles,
  PermissionsBitField.Flags.ReadMessageHistory,
  PermissionsBitField.Flags.UseApplicationCommands,
];

const TICKET_STAFF_PERMISSIONS = [
  ...TICKET_USER_PERMISSIONS,
  PermissionsBitField.Flags.ManageMessages,
];

const TICKET_BOT_PERMISSIONS = [
  ...TICKET_STAFF_PERMISSIONS,
  PermissionsBitField.Flags.ManageChannels,
  PermissionsBitField.Flags.ManageRoles,
];

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
    member?.permissions?.has([
      PermissionsBitField.Flags.ManageChannels,
      PermissionsBitField.Flags.ManageMessages,
    ]),
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

function isProtectedTicketMember(member) {
  return Boolean(
    member?.user?.bot ||
      isTicketAdministrator(member) ||
      hasAnyConfiguredRole(member, config.tickets.coordinationRoles) ||
      hasAnyConfiguredRole(member, config.tickets.supportRoles),
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

function buildTicketPermissionOverwrites(guild, ownerId, categoryType) {
  const overwrites = [
    {
      id: guild.id,
      deny: [PermissionsBitField.Flags.ViewChannel],
    },
    {
      id: ownerId,
      allow: TICKET_USER_PERMISSIONS,
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

module.exports = {
  TICKET_BOT_PERMISSIONS,
  TICKET_STAFF_PERMISSIONS,
  TICKET_USER_PERMISSIONS,
  buildTicketPermissionOverwrites,
  getVisibleStaffRoleIds,
  hasAnyConfiguredRole,
  isProtectedTicketMember,
  isTicketAdministrator,
  isTicketCoordinator,
  isTicketSupport,
};
