const config = require("../config");

function resolveConfiguredRole(roles, name) {
  const key = name.toLowerCase();
  const configuredId = config.team.roleIds[key];
  if (configuredId) {
    const role = roles.get(configuredId);
    if (!role) throw new Error(`O cargo ${name} configurado em DISCORD_TEAM_ROLE_MAP não existe neste servidor.`);
    return role;
  }
  const matches = roles.filter((role) => role.name.trim().toLowerCase() === key);
  if (matches.size > 1) throw new Error(`Há mais de um cargo chamado ${name}. Defina seu ID em DISCORD_TEAM_ROLE_MAP.`);
  return matches.first() || null;
}

function resolveTeamRoles(roles) {
  const ranks = config.team.rankNames.flatMap((name, rank) => {
    const role = resolveConfiguredRole(roles, name);
    return role ? [{ role, rank }] : [];
  });
  if (!ranks.length) throw new Error("Nenhum dos cargos da equipe foi encontrado. Confira os nomes ou configure DISCORD_TEAM_ROLE_MAP.");
  if (new Set(ranks.map(({ role }) => role.id)).size !== ranks.length) {
    throw new Error("Cada nível da equipe precisa corresponder a um cargo diferente em DISCORD_TEAM_ROLE_MAP.");
  }
  const baseRole = resolveConfiguredRole(roles, config.team.baseRoleName);
  if (!baseRole) throw new Error("O cargo base Team não foi encontrado. Confira o nome ou configure seu ID em DISCORD_TEAM_ROLE_MAP.");
  if (ranks.some(({ role }) => role.id === baseRole.id)) throw new Error("O cargo base Team precisa ser diferente dos cargos principais da equipe.");
  return { ranks, baseRole };
}

function planTeamChange({ member, role, type, ranks, baseRole }) {
  const selected = ranks.find((entry) => entry.role.id === role.id);
  if (!selected) throw new Error("Selecione um dos cargos configurados da equipe.");
  const current = ranks.filter((entry) => member.roles.cache.has(entry.role.id));
  const previous = current[0];
  const changeType = type === "remover" ? "remover"
    : !previous ? "entrar"
      : selected.rank < previous.rank ? "promover" : "rebaixar";
  const removeIds = type === "remover" ? [role.id] : current.map((entry) => entry.role.id);
  const addIds = type === "entrar" ? [role.id] : [];
  const remainsInTeam = type === "entrar" || current.some((entry) => entry.role.id !== role.id);
  if (remainsInTeam && !member.roles.cache.has(baseRole.id)) addIds.push(baseRole.id);
  if (!remainsInTeam && member.roles.cache.has(baseRole.id)) removeIds.push(baseRole.id);
  const desired = new Set(member.roles.cache.keys());
  for (const id of removeIds) desired.delete(id);
  for (const id of addIds) desired.add(id);
  return { changeType, previousRoleId: type === "entrar" ? previous?.role.id : undefined,
    roleIds: [...desired], changedRoleIds: [...new Set([...removeIds, ...addIds])] };
}

module.exports = { resolveTeamRoles, planTeamChange };
