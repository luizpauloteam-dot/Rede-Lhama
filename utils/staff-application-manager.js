const { EmbedBuilder, MessageFlags, PermissionFlagsBits } = require("discord.js");
const config = require("../config");
const { createLogger } = require("./logger");
const { upsertPanelMessage } = require("./panel-message");
const {
  APPLICATION_FIELDS, BUILDER_APPLICATION_FIELDS, BUILDER_APPLICATION_IDS, STAFF_APPLICATION_IDS,
  buildApplicationRejectionModal, buildRejectionMessage,
  buildBuilderApplicationDecisionRow, buildBuilderApplicationEmbed, buildBuilderApplicationModal, buildBuilderApplicationPanel,
  buildStaffApplicationDecisionRow, buildStaffApplicationEmbed, buildStaffApplicationModal, buildStaffApplicationPanel,
} = require("./staff-application-components");
const { buildTeamModal } = require("./team-components");
const { resolveTeamRoles } = require("./team-roles");

const log = createLogger("staff-applications");

function canReviewApplications(member, userId) {
  return Boolean(member?.permissions?.has(PermissionFlagsBits.ManageRoles) ||
    config.staffApplications.reviewerUserIds.includes(userId));
}

async function replyEphemeral(interaction, content) {
  await interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
}

const APPLICATION_TYPES = [
  {
    ids: STAFF_APPLICATION_IDS, fields: APPLICATION_FIELDS, config: config.staffApplications,
    label: "staff", failureMessage: "Não consegui enviar sua candidatura agora. Tente novamente mais tarde.",
    successMessage: "Sua candidatura foi enviada para análise. Boa sorte!", buildDecisionRow: buildStaffApplicationDecisionRow,
    buildEmbed: buildStaffApplicationEmbed, buildModal: buildStaffApplicationModal, buildPanel: buildStaffApplicationPanel,
  },
  {
    ids: BUILDER_APPLICATION_IDS, fields: BUILDER_APPLICATION_FIELDS, config: config.builderApplications,
    label: "construtor(a)", failureMessage: "Não consegui enviar sua candidatura de construtor agora. Tente novamente mais tarde.",
    successMessage: "Sua candidatura de construtor foi enviada para análise. Boa sorte!", buildDecisionRow: buildBuilderApplicationDecisionRow,
    buildEmbed: buildBuilderApplicationEmbed, buildModal: buildBuilderApplicationModal, buildPanel: buildBuilderApplicationPanel,
  },
];

function findApplicationType(customId) {
  if (typeof customId !== "string") return null;
  return APPLICATION_TYPES.find(({ ids }) => customId === ids.openButton || customId === ids.modal ||
    customId.startsWith(`${ids.approvePrefix}:`) || customId.startsWith(`${ids.rejectPrefix}:`) ||
    customId.startsWith(`${ids.rejectPrefix}-submit:`));
}

async function handleReviewButton(interaction, applicationType, action, applicantId) {
  if (!interaction.inGuild() || !canReviewApplications(interaction.member, interaction.user.id)) {
    await replyEphemeral(interaction, "Você não tem permissão para analisar candidaturas.");
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
  await interaction.showModal(buildApplicationRejectionModal(
    applicationType === APPLICATION_TYPES[1] ? "builder" : "staff", applicantId, interaction.message.id,
  ));
}

async function handleRejectionModal(interaction, applicationType) {
  if (!interaction.inGuild() || !canReviewApplications(interaction.member, interaction.user.id)) {
    await replyEphemeral(interaction, "Você não tem permissão para analisar candidaturas.");
    return;
  }
  const [, , applicantId, messageId] = interaction.customId.split(":");
  const name = interaction.fields.getTextInputValue("applicant_name").trim();
  const reason = interaction.fields.getTextInputValue("rejection_reason").trim();
  const postscript = interaction.fields.getTextInputValue("postscript").trim();
  if (!applicantId || !messageId || !name || !reason) {
    await replyEphemeral(interaction, "Preencha o nome e o motivo para enviar a recusa. Abra o formulário novamente.");
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const applicant = await interaction.client.users.fetch(applicantId);
    const role = applicationType === APPLICATION_TYPES[1] ? "Construtor" : "Staff";
    await applicant.send({
      content: buildRejectionMessage({ name, reviewer: interaction.user, role, reason, postscript }),
      allowedMentions: { parse: [] },
    });
    const reviewMessage = await interaction.channel.messages.fetch(messageId);
    const applicationEmbed = EmbedBuilder.from(reviewMessage.embeds[0])
      .setColor(0xED4245)
      .setFooter({ text: `Candidatura reprovada por ${interaction.user.tag}` });
    await reviewMessage.edit({
      embeds: [applicationEmbed],
      components: [applicationType.buildDecisionRow(applicantId, { disabled: true, rejected: true })],
      allowedMentions: { parse: [] },
    });
    await interaction.editReply("Recusa enviada por mensagem direta e candidatura marcada como reprovada.");
  } catch (error) {
    log.error(`Falha ao enviar recusa da candidatura ${applicantId} (interação ${interaction.id}).`, error);
    await interaction.editReply("Não consegui enviar a mensagem. Verifique se a pessoa aceita mensagens diretas e tente novamente.");
  }
}

async function upsertStaffApplicationPanel(client, channel) {
  return upsertApplicationPanel(client, channel, APPLICATION_TYPES[0]);
}

async function upsertBuilderApplicationPanel(client, channel) {
  return upsertApplicationPanel(client, channel, APPLICATION_TYPES[1]);
}

async function upsertApplicationPanel(client, channel, applicationType) {
  return upsertPanelMessage({
    client,
    channel,
    components: applicationType.buildPanel(),
    customId: applicationType.ids.openButton,
    stateFilePath: applicationType.config.panelMessageFilePath,
  });
}

async function handleStaffApplicationInteraction(interaction) {
  const applicationType = findApplicationType(interaction.customId);
  if (interaction.isModalSubmit() && applicationType && interaction.customId.startsWith(`${applicationType.ids.rejectPrefix}-submit:`)) {
    await handleRejectionModal(interaction, applicationType);
    return;
  }
  if (interaction.isButton() && applicationType && interaction.customId === applicationType.ids.openButton) {
    await interaction.showModal(applicationType.buildModal());
    return;
  }
  if (interaction.isButton()) {
    const [, action, applicantId] = interaction.customId.split(":");
    if (applicationType && ["approve", "reject"].includes(action) && applicantId) {
      await handleReviewButton(interaction, applicationType, action, applicantId);
      return;
    }
  }
  if (!interaction.isModalSubmit() || !applicationType || interaction.customId !== applicationType.ids.modal) return;
  try {
    if (!interaction.inGuild() || !applicationType.config.reviewChannelId) {
      await interaction.reply({ content: "Não foi possível receber esta candidatura.", flags: MessageFlags.Ephemeral });
      return;
    }
    const reviewChannel = await interaction.guild.channels.fetch(applicationType.config.reviewChannelId);
    const permissions = reviewChannel?.permissionsFor(interaction.guild.members.me);
    if (!reviewChannel?.isTextBased() || !permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
      await interaction.reply({ content: "O canal de análise não está disponível. Avise a administração.", flags: MessageFlags.Ephemeral });
      return;
    }
    const answers = applicationType.fields.map((field) => ({ label: field.label, value: interaction.fields.getTextInputValue(field.id) }));
    await reviewChannel.send({
      embeds: [applicationType.buildEmbed({ applicant: interaction.user, answers })],
      components: [applicationType.buildDecisionRow(interaction.user.id)],
      allowedMentions: { parse: [] },
    });
    await interaction.reply({ content: applicationType.successMessage, flags: MessageFlags.Ephemeral });
  } catch (error) {
    log.error(`Falha ao registrar candidatura a ${applicationType.label} (interação ${interaction.id}).`, error);
    const payload = { content: applicationType.failureMessage, flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => null);
    else await interaction.reply(payload).catch(() => null);
  }
}

module.exports = { handleStaffApplicationInteraction, upsertBuilderApplicationPanel, upsertStaffApplicationPanel };
