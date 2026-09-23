const { MessageFlags, PermissionFlagsBits } = require("discord.js");
const config = require("../config");
const { validateTargetChannel } = require("./discord-channel-access");
const { createLogger } = require("./logger");
const { TEAM_IDS, buildTeamRecord } = require("./team-components");
const { buildApprovalMessage } = require("./staff-application-components");
const { resolveTeamRoles, planTeamChange } = require("./team-roles");

const log = createLogger("equipe");
// Only protects concurrent operations; Discord remains the source of truth for membership.
const pendingChanges = new Set();

function validateTeamChange({ guild, actor, bot, member, role, type }) {
  if (!actor.permissions.has(PermissionFlagsBits.ManageRoles)) return "Você precisa da permissão Gerenciar cargos.";
  if (!bot.permissions.has(PermissionFlagsBits.ManageRoles)) return "Preciso da permissão Gerenciar cargos.";
  if (!role || role.id === guild.id || role.managed) return "Selecione um cargo comum da equipe, sem integração.";
  if (bot.roles.highest.comparePositionTo(role) <= 0) return "O cargo escolhido precisa estar abaixo do meu cargo mais alto.";
  if (actor.id !== guild.ownerId && actor.roles.highest.comparePositionTo(role) <= 0) return "O cargo escolhido precisa estar abaixo do seu cargo mais alto.";
  if (!member || member.user.bot) return "Selecione um membro humano que esteja neste servidor.";
  if (member.id === guild.ownerId || bot.roles.highest.comparePositionTo(member.roles.highest) <= 0) return "Não posso alterar os cargos desse membro por causa da hierarquia.";
  if (actor.id !== guild.ownerId && actor.roles.highest.comparePositionTo(member.roles.highest) <= 0) return "Você só pode alterar membros abaixo de você na hierarquia.";
  if (type === "entrar" && member.roles.cache.has(role.id)) return "Esse membro já possui o cargo selecionado.";
  if (type === "remover" && !member.roles.cache.has(role.id)) return "Esse membro não possui o cargo selecionado.";
  return null;
}

async function handleTeamInteraction(interaction) {
  if (!interaction.isModalSubmit() || !interaction.customId.startsWith(TEAM_IDS.modalPrefix)) return;
  let lockKey;
  let changed = false;
  let published = false;
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const [type, expectedMemberId = ""] = interaction.customId.slice(TEAM_IDS.modalPrefix.length).split(":");
    if (!interaction.inGuild() || !["entrar", "remover"].includes(type)) {
      await interaction.editReply("Alteração de equipe inválida. Use /equipe dentro do servidor.");
      return;
    }
    const users = interaction.fields.getSelectedUsers(TEAM_IDS.member, true);
    const roleIds = interaction.fields.getStringSelectValues(TEAM_IDS.role);
    const photos = interaction.fields.getUploadedFiles(TEAM_IDS.photo, true);
    const photo = photos.first();
    if (users.size !== 1 || roleIds.length !== 1 || photos.size !== 1) {
      await interaction.editReply("Selecione exatamente um membro, um cargo e uma foto.");
      return;
    }
    if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(photo.contentType) || !photo.width || !photo.height) {
      await interaction.editReply("Envie uma foto PNG, JPG, WEBP ou GIF válida.");
      return;
    }
    if (photo.size > interaction.attachmentSizeLimit) {
      await interaction.editReply("A foto ultrapassa o limite de upload deste servidor.");
      return;
    }
    const memberId = users.firstKey();
    if (expectedMemberId && memberId !== expectedMemberId) {
      await interaction.editReply("O membro selecionado não corresponde à candidatura aprovada.");
      return;
    }
    const roleId = roleIds[0];
    const key = `${interaction.guildId}:${memberId}`;
    if (pendingChanges.has(key)) {
      await interaction.editReply("Já existe uma alteração em andamento para esse membro. Aguarde.");
      return;
    }
    pendingChanges.add(key);
    lockKey = key;
    const guild = interaction.guild;
    const [actor, bot, member, guildRoles] = await Promise.all([
      guild.members.fetch({ user: interaction.user.id, force: true }),
      guild.members.fetchMe({ force: true }),
      guild.members.fetch({ user: memberId, force: true }).catch((error) => {
        if (error.code === 10007) return null;
        throw error;
      }),
      guild.roles.fetch(),
    ]);
    const role = guildRoles.get(roleId);
    const error = validateTeamChange({ guild, actor, bot, member, role, type });
    if (error) {
      await interaction.editReply(error);
      return;
    }
    let plan;
    try {
      plan = planTeamChange({ member, role, type, ...resolveTeamRoles(guildRoles) });
    } catch (planError) {
      await interaction.editReply({ content: planError.message, allowedMentions: { parse: [] } });
      return;
    }
    for (const changedRoleId of plan.changedRoleIds) {
      const changedRole = guildRoles.get(changedRoleId);
      const permissionError = validateTeamChange({ guild, actor, bot, member, role: changedRole,
        type: member.roles.cache.has(changedRoleId) ? "remover" : "entrar" });
      if (permissionError) {
        await interaction.editReply(permissionError);
        return;
      }
    }
    const { error: channelError, targetChannel } = await validateTargetChannel({
      guild, guildId: guild.id, channelId: config.team.logChannelId || interaction.channelId, member: actor, botMember: bot,
    });
    if (channelError) {
      await interaction.editReply(channelError);
      return;
    }
    if (!targetChannel.permissionsFor(bot)?.has([PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks])) {
      await interaction.editReply("Preciso das permissões Anexar arquivos e Inserir links no canal do registro.");
      return;
    }
    const record = buildTeamRecord({ type: plan.changeType, memberId, roleId: role.id, previousRoleId: plan.previousRoleId, photo });
    const reason = `/equipe ${plan.changeType} por ${interaction.user.id}; interação ${interaction.id}`;
    await member.roles.set(plan.roleIds.filter((id) => id !== guild.id), reason);
    changed = true;
    const message = await targetChannel.send(record);
    published = true;
    let approvalNotice = "";
    if (type === "entrar" && expectedMemberId) {
      try {
        await member.send({
          content: buildApprovalMessage({ name: member.displayName, reviewer: interaction.user, role: role.name }),
          allowedMentions: { parse: [] },
        });
        approvalNotice = " A mensagem de aprovação foi enviada por DM.";
      } catch (dmError) {
        log.warn(`Não foi possível enviar a aprovação por DM para ${member.id}.`, dmError);
        approvalNotice = " Não consegui enviar a DM de aprovação; confira se a pessoa aceita mensagens diretas.";
      }
    }
    await interaction.editReply(`Cargo ${type === "entrar" ? "adicionado" : "removido"} e registro publicado: ${message.url}.${approvalNotice}`);
  } catch (error) {
    log.error(`Falha na alteração de equipe (interação ${interaction.id}, cargo alterado: ${changed}, registro publicado: ${published}).`, error);
    const content = published
      ? "O cargo foi alterado e o registro foi publicado, mas houve uma falha na confirmação."
      : changed
        ? "O cargo foi alterado, mas não consegui publicar o registro com a foto. Avise a administração para registrar a alteração manualmente."
        : "Não consegui concluir a alteração de equipe. Confira os cargos e as permissões e tente novamente.";
    try {
      if (interaction.deferred || interaction.replied) await interaction.editReply(content);
      else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    } catch (replyError) {
      log.error("Falha ao informar o resultado da alteração de equipe.", replyError);
    }
  } finally {
    if (lockKey) pendingChanges.delete(lockKey);
  }
}

module.exports = { handleTeamInteraction, validateTeamChange };
