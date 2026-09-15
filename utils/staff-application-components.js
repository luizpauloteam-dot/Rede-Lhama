const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, ContainerBuilder, EmbedBuilder, LabelBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
} = require("discord.js");

const STAFF_APPLICATION_IDS = {
  modal: "staff:application",
  openButton: "staff:open",
  approvePrefix: "staff:approve",
  rejectPrefix: "staff:reject",
  profile: "staff:profile",
  experience: "staff:experience",
  conflict: "staff:conflict",
  responsibility: "staff:responsibility",
  motivation: "staff:motivation",
};

const APPLICATION_FIELDS = [
  { id: STAFF_APPLICATION_IDS.profile, label: "Apresente-se", placeholder: "Como prefere ser chamado, sua rotina e em quais horários consegue ajudar." },
  { id: STAFF_APPLICATION_IDS.experience, label: "Vivência em comunidades", placeholder: "Conte sua experiência com Minecraft, Discord ou outras equipes." },
  { id: STAFF_APPLICATION_IDS.conflict, label: "Atendimento e conflitos", placeholder: "Como agiria diante de um jogador irritado ou uma situação delicada?" },
  { id: STAFF_APPLICATION_IDS.responsibility, label: "Postura como staff", placeholder: "Como usaria as ferramentas da equipe com imparcialidade e responsabilidade?" },
  { id: STAFF_APPLICATION_IDS.motivation, label: "Por que quer participar?", placeholder: "Explique o que pode acrescentar à comunidade e por que devemos escolhê-lo." },
];

function buildTextInput(field) {
  return new LabelBuilder().setLabel(field.label).setTextInputComponent(
    new TextInputBuilder().setCustomId(field.id).setStyle(TextInputStyle.Paragraph).setPlaceholder(field.placeholder)
      .setMinLength(20).setMaxLength(1000).setRequired(true),
  );
}

function buildStaffApplicationModal() {
  return new ModalBuilder().setCustomId(STAFF_APPLICATION_IDS.modal).setTitle("Candidatura à Staff")
    .addComponents(...APPLICATION_FIELDS.map(buildTextInput));
}

function buildStaffApplicationPanel() {
  return [new ContainerBuilder({
    components: [
      { type: ComponentType.TextDisplay, content: "# Recrutamento da Staff\nQuer ajudar a tornar a comunidade melhor? Envie sua candidatura para a equipe." },
      { type: ComponentType.Separator, divider: true, spacing: 1 },
      {
        type: ComponentType.Section,
        components: [{ type: ComponentType.TextDisplay, content: "Conte um pouco sobre você, sua experiência e como lidaria com a responsabilidade de ser staff." }],
        accessory: new ButtonBuilder().setCustomId(STAFF_APPLICATION_IDS.openButton).setLabel("Candidatar-se à Staff")
          .setEmoji("📝").setStyle(ButtonStyle.Primary).toJSON(),
      },
    ],
  }).setAccentColor(0xE8A64A).toJSON()];
}

function buildStaffApplicationEmbed({ applicant, answers }) {
  return new EmbedBuilder().setColor(0xE8A64A).setTitle("Nova candidatura à staff")
    .setDescription(`Enviada por ${applicant} (${applicant.id})`)
    .setThumbnail(applicant.displayAvatarURL({ size: 256 }))
    .addFields(answers.map(({ label, value }) => ({ name: label, value }))).setTimestamp();
}

function buildStaffApplicationDecisionRow(applicantId, { disabled = false, rejected = false } = {}) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${STAFF_APPLICATION_IDS.approvePrefix}:${applicantId}`).setLabel(rejected ? "Aprovada" : "Aprovar")
      .setEmoji("✅").setStyle(ButtonStyle.Success).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`${STAFF_APPLICATION_IDS.rejectPrefix}:${applicantId}`).setLabel(rejected ? "Reprovada" : "Reprovar")
      .setEmoji("❌").setStyle(ButtonStyle.Danger).setDisabled(disabled),
  ).toJSON();
}

module.exports = {
  APPLICATION_FIELDS, STAFF_APPLICATION_IDS, buildStaffApplicationDecisionRow, buildStaffApplicationEmbed, buildStaffApplicationModal, buildStaffApplicationPanel,
};
