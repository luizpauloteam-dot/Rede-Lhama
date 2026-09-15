const { EmbedBuilder, MessageFlags, PermissionFlagsBits } = require("discord.js");
const config = require("../config");
const { createLogger } = require("./logger");
const { upsertPanelMessage } = require("./panel-message");
const {
  APPLICATION_FIELDS, STAFF_APPLICATION_IDS, buildStaffApplicationDecisionRow, buildStaffApplicationEmbed, buildStaffApplicationModal, buildStaffApplicationPanel,
} = require("./staff-application-components");
const { buildTeamModal } = require("./team-components");
const { resolveTeamRoles } = require("./team-roles");

const log = createLogger("staff-applications");

function canReviewApplications(member) {
  return Boolean(member?.permissions?.has(PermissionFlagsBits.ManageRoles));
}

async function replyEphemeral(interaction, content) {
  await interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
}

async function handleReviewButton(interaction, action, applicantId) {
  if (!interaction.inGuild() || !canReviewApplications(interaction.member)) {
    await replyEphemeral(interaction, "Você precisa da permissão Gerenciar cargos para analisar candidaturas.");
    return;
  }
  if (action === "approve") {
    const roles = await interaction.guild.roles.fetch();
    let ranks;
    try {
      ({ ranks } = resolveTeamRoles(roles));
    } catch (error) {
      await replyEphemeral(interaction, error.message);
      return;
    }
    await interaction.showModal(buildTeamModal("entrar", ranks, applicantId));
    return;
  }
  const applicationEmbed = EmbedBuilder.from(interaction.message.embeds[0])
    .setColor(0xED4245)
    .setFooter({ text: `Candidatura reprovada por ${interaction.user.tag}` });
  await interaction.update({
    embeds: [applicationEmbed],
    components: [buildStaffApplicationDecisionRow(applicantId, { disabled: true, rejected: true })],
    allowedMentions: { parse: [] },
  });
}

async function upsertStaffApplicationPanel(client, channel) {
  return upsertPanelMessage({
    client,
    channel,
    components: buildStaffApplicationPanel(),
    customId: STAFF_APPLICATION_IDS.openButton,
    stateFilePath: config.staffApplications.panelMessageFilePath,
  });
}

async function handleStaffApplicationInteraction(interaction) {
  if (interaction.isButton() && interaction.customId === STAFF_APPLICATION_IDS.openButton) {
    await interaction.showModal(buildStaffApplicationModal());
    return;
  }
  if (interaction.isButton()) {
    const [, action, applicantId] = interaction.customId.split(":");
    if (["approve", "reject"].includes(action) && applicantId) {
      await handleReviewButton(interaction, action, applicantId);
      return;
    }
  }
  if (!interaction.isModalSubmit() || interaction.customId !== STAFF_APPLICATION_IDS.modal) return;
  try {
    if (!interaction.inGuild() || !config.staffApplications.reviewChannelId) {
      await interaction.reply({ content: "Não foi possível receber esta candidatura.", flags: MessageFlags.Ephemeral });
      return;
    }
    const reviewChannel = await interaction.guild.channels.fetch(config.staffApplications.reviewChannelId);
    const permissions = reviewChannel?.permissionsFor(interaction.guild.members.me);
    if (!reviewChannel?.isTextBased() || !permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
      await interaction.reply({ content: "O canal de análise não está disponível. Avise a administração.", flags: MessageFlags.Ephemeral });
      return;
    }
    const answers = APPLICATION_FIELDS.map((field) => ({ label: field.label, value: interaction.fields.getTextInputValue(field.id) }));
    await reviewChannel.send({
      embeds: [buildStaffApplicationEmbed({ applicant: interaction.user, answers })],
      components: [buildStaffApplicationDecisionRow(interaction.user.id)],
      allowedMentions: { parse: [] },
    });
    await interaction.reply({ content: "Sua candidatura foi enviada para análise. Boa sorte!", flags: MessageFlags.Ephemeral });
  } catch (error) {
    log.error(`Falha ao registrar candidatura à staff (interação ${interaction.id}).`, error);
    const payload = { content: "Não consegui enviar sua candidatura agora. Tente novamente mais tarde.", flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => null);
    else await interaction.reply(payload).catch(() => null);
  }
}

module.exports = { handleStaffApplicationInteraction, upsertStaffApplicationPanel };
