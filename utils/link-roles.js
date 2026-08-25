const config = require("../config");

function getRoleIdsForLink(linkedAccount) {
  const roleIds = new Set();

  if (config.link.memberRoleId) {
    roleIds.add(config.link.memberRoleId);
  }

  for (const vipKey of linkedAccount.vipKeys || []) {
    const roleId = config.link.vipRoleMap[vipKey];
    if (roleId) {
      roleIds.add(roleId);
    }
  }

  return [...roleIds];
}

async function resolveGuildMember(guild, userId, fallbackMember) {
  if (fallbackMember?.roles?.add) {
    return fallbackMember;
  }

  return guild.members.fetch(userId).catch(() => null);
}

async function assignConfiguredRoles({ guild, member, userId, linkedAccount }) {
  const roleIds = getRoleIdsForLink(linkedAccount);
  if (!roleIds.length) {
    return {
      added: [],
      failed: [],
    };
  }

  const added = [];
  const failed = [];
  const guildMember = await resolveGuildMember(guild, userId, member);

  if (!guildMember?.roles?.add) {
    return {
      added,
      failed: roleIds,
    };
  }

  for (const roleId of roleIds) {
    const role = guild.roles.cache.get(roleId) || (await guild.roles.fetch(roleId).catch(() => null));

    if (!role) {
      failed.push(roleId);
      continue;
    }

    await guildMember.roles
      .add(role, "Conta vinculada com o servidor")
      .then(() => added.push(role.name))
      .catch(() => failed.push(role.name || roleId));
  }

  return {
    added,
    failed,
  };
}

function buildSuccessMessage(linkedAccount, roleResult) {
  const lines = [
    `Conta vinculada com sucesso: \`${linkedAccount.nick}\`.`,
  ];

  if (roleResult.added.length) {
    lines.push(`Cargos entregues: ${roleResult.added.map((roleName) => `\`${roleName}\``).join(", ")}.`);
  }

  if (roleResult.failed.length) {
    lines.push("A conta foi vinculada, mas não consegui entregar todos os cargos. Avise a staff.");
  }

  return lines.join("\n");
}

module.exports = {
  assignConfiguredRoles,
  buildSuccessMessage,
  getRoleIdsForLink,
};
