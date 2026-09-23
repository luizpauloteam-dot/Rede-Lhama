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

const BUILDER_APPLICATION_IDS = {
  modal: "builder:application",
  openButton: "builder:open",
  approvePrefix: "builder:approve",
  rejectPrefix: "builder:reject",
  profile: "builder:profile",
  experience: "builder:experience",
  plugins: "builder:plugins",
  motivation: "builder:motivation",
  portfolio: "builder:portfolio",
};

const APPLICATION_FIELDS = [
  { id: STAFF_APPLICATION_IDS.profile, label: "Apresente-se", placeholder: "Como prefere ser chamado, sua rotina e em quais horários consegue ajudar." },
  { id: STAFF_APPLICATION_IDS.experience, label: "Vivência em comunidades", placeholder: "Conte sua experiência com Minecraft, Discord ou outras equipes." },
  { id: STAFF_APPLICATION_IDS.conflict, label: "Atendimento e conflitos", placeholder: "Como agiria diante de um jogador irritado ou uma situação delicada?" },
  { id: STAFF_APPLICATION_IDS.responsibility, label: "Postura como staff", placeholder: "Como usaria as ferramentas da equipe com imparcialidade e responsabilidade?" },
  { id: STAFF_APPLICATION_IDS.motivation, label: "Por que quer participar?", placeholder: "Explique o que pode acrescentar à comunidade e por que devemos escolhê-lo." },
];

const BUILDER_APPLICATION_FIELDS = [
  { id: BUILDER_APPLICATION_IDS.profile, label: "Sobre você", placeholder: "Fale sobre você (nome, nome no jogo, idade, trabalha, estuda, disponibilidade de horário etc.)." },
  { id: BUILDER_APPLICATION_IDS.experience, label: "Sua experiência", placeholder: "Nos conte sobre sua experiência com Minecraft e se já foi construtor, em quais servidores." },
  { id: BUILDER_APPLICATION_IDS.plugins, label: "Afinidade com plugins", placeholder: "Utiliza plugins auxiliares de construção (Voxel, goBrush...)? Se sim, cite-os e seu nível com eles." },
  { id: BUILDER_APPLICATION_IDS.motivation, label: "Por que se candidatou à vaga?", placeholder: "Seja você mesmo, mostre seu potencial e o motivo pelo qual deveríamos lhe aceitar." },
  { id: BUILDER_APPLICATION_IDS.portfolio, label: "Construções de sua autoria", placeholder: "Anexe ao menos 5 imagens com boa qualidade. Site recomendado: https://imgur.com/" },
];

function buildTextInput(field) {
  return new LabelBuilder().setLabel(field.label).setTextInputComponent(
    new TextInputBuilder().setCustomId(field.id).setStyle(TextInputStyle.Paragraph).setPlaceholder(field.placeholder)
      .setMinLength(20).setMaxLength(1000).setRequired(true),
  );
}

function buildApplicationModal({ ids, title, fields }) {
  return new ModalBuilder().setCustomId(ids.modal).setTitle(title).addComponents(...fields.map(buildTextInput));
}

function buildApplicationPanel({ ids, title, description, details, buttonLabel, emoji }) {
  return [new ContainerBuilder({
    components: [
      { type: ComponentType.TextDisplay, content: `# ${title}\n${description}` },
      { type: ComponentType.Separator, divider: true, spacing: 1 },
      {
        type: ComponentType.Section, components: [{ type: ComponentType.TextDisplay, content: details }],
        accessory: new ButtonBuilder().setCustomId(ids.openButton).setLabel(buttonLabel).setEmoji(emoji).setStyle(ButtonStyle.Primary).toJSON(),
      },
    ],
  }).setAccentColor(0xE8A64A).toJSON()];
}

function buildApplicationEmbed({ applicant, answers, title }) {
  return new EmbedBuilder().setColor(0xE8A64A).setTitle(title)
    .setDescription(`Enviada por ${applicant} (${applicant.id})`)
    .setThumbnail(applicant.displayAvatarURL({ size: 256 }))
    .addFields(answers.map(({ label, value }) => ({ name: label, value }))).setTimestamp();
}

function buildApplicationDecisionRow(ids, applicantId, { disabled = false, rejected = false } = {}) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${ids.approvePrefix}:${applicantId}`).setLabel(rejected ? "Aprovada" : "Aprovar")
      .setEmoji("✅").setStyle(ButtonStyle.Success).setDisabled(disabled),
    new ButtonBuilder().setCustomId(`${ids.rejectPrefix}:${applicantId}`).setLabel(rejected ? "Reprovada" : "Reprovar")
      .setEmoji("❌").setStyle(ButtonStyle.Danger).setDisabled(disabled),
  ).toJSON();
}

function buildApplicationRejectionModal(applicationType, applicantId, messageId) {
  return new ModalBuilder()
    .setCustomId(`${applicationType}:reject-submit:${applicantId}:${messageId}`)
    .setTitle("Enviar recusa da candidatura")
    .addLabelComponents(
      new LabelBuilder().setLabel("Nome da pessoa").setTextInputComponent(
        new TextInputBuilder().setCustomId("applicant_name").setStyle(TextInputStyle.Short).setMaxLength(80).setRequired(true),
      ),
      new LabelBuilder().setLabel("Motivo").setTextInputComponent(
        new TextInputBuilder().setCustomId("rejection_reason").setStyle(TextInputStyle.Paragraph).setMaxLength(700).setRequired(true),
      ),
      new LabelBuilder().setLabel("PS (opcional)").setTextInputComponent(
        new TextInputBuilder().setCustomId("postscript").setStyle(TextInputStyle.Paragraph).setMaxLength(300).setRequired(false),
      ),
    );
}

function getTimeGreeting(date = new Date()) {
  const hour = Number(new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "numeric",
    hourCycle: "h23",
  }).format(date));
  if (hour >= 5 && hour < 12) return "Bom dia";
  if (hour >= 12 && hour < 18) return "Boa tarde";
  return "Boa noite";
}

function buildRejectionMessage({ name, reviewer, role, reason, postscript }) {
  const lines = [
    `${getTimeGreeting()} ${name}, tudo bem? Sou **${reviewer}**, **fundador** da **Rede Lhama** e estou a entrar em contato com você por conta da sua candidatura para o cargo de **${role}** no servidor. Antes de mais nada, gostaríamos de expressar nosso **agradecimento** pelo seu interesse em fazer parte da nossa equipe pela **dedicação** e tempo que você investiu ao preencher nosso formulário.`,
    "Depois de uma avaliação cuidadosa, chegamos à conclusão de que, por enquanto, **o seu perfil não atende completamente às nossas expectativas para a vaga em questão**. Por esse motivo, não seguiremos para a próxima etapa do processo.",
    `**Motivo:** ${reason}`,
    "Compreendemos que essa não é a notícia que você gostaria de receber, mas esperamos que essa experiência possa contribuir de alguma forma para o seu desenvolvimento. Desejamos todo o sucesso na sua busca por novas oportunidades.",
    "Agradecemos mais uma vez pelo seu formulário e envolvimento.",
  ];
  if (postscript) lines.push(`**PS:** ${postscript}`);
  lines.push("Atenciosamente,\nRede Lhama Team.\n-# Rede Lhama © 2026");
  return lines.join("\n\n");
}

function buildApprovalMessage({ name, reviewer, role }) {
  return [
    `${getTimeGreeting()} ${name}, tudo bem? Sou **${reviewer}**, **fundador** da **Rede Lhama**. Estou entrando em contato sobre sua candidatura para o cargo de **${role}** no servidor.`,
    `Após avaliarmos sua candidatura, tenho o prazer de informar que você foi **aprovado(a)** para fazer parte da equipe. Parabéns e seja bem-vindo(a) à **Rede Lhama**!`,
    "Agradecemos pelo seu interesse, dedicação e tempo investido no formulário. Em breve, a equipe poderá entrar em contato para orientar você sobre os próximos passos.",
    "Atenciosamente,\nRede Lhama Team.\n-# Rede Lhama © 2026",
  ].join("\n\n");
}

function buildStaffApplicationModal() { return buildApplicationModal({ ids: STAFF_APPLICATION_IDS, title: "Candidatura à Staff", fields: APPLICATION_FIELDS }); }
function buildBuilderApplicationModal() { return buildApplicationModal({ ids: BUILDER_APPLICATION_IDS, title: "Construtor(a)", fields: BUILDER_APPLICATION_FIELDS }); }
function buildStaffApplicationPanel() {
  return buildApplicationPanel({ ids: STAFF_APPLICATION_IDS, title: "Recrutamento da Staff", description: "Quer ajudar a tornar a comunidade melhor? Envie sua candidatura para a equipe.", details: "Conte um pouco sobre você, sua experiência e como lidaria com a responsabilidade de ser staff.", buttonLabel: "Candidatar-se à Staff", emoji: "📝" });
}
function buildBuilderApplicationPanel() {
  return buildApplicationPanel({ ids: BUILDER_APPLICATION_IDS, title: "Recrutamento de Construtor(a)", description: "Mostre seu portfólio e venha construir a Rede Lhama com a gente.", details: "Conte sobre sua experiência, suas ferramentas e envie as imagens das suas melhores construções.", buttonLabel: "Candidatar-se a Construtor(a)", emoji: "🏗️" });
}
function buildStaffApplicationEmbed({ applicant, answers }) { return buildApplicationEmbed({ applicant, answers, title: "Nova candidatura à staff" }); }
function buildBuilderApplicationEmbed({ applicant, answers }) { return buildApplicationEmbed({ applicant, answers, title: "Nova candidatura a construtor(a)" }); }
function buildStaffApplicationDecisionRow(applicantId, options) { return buildApplicationDecisionRow(STAFF_APPLICATION_IDS, applicantId, options); }
function buildBuilderApplicationDecisionRow(applicantId, options) { return buildApplicationDecisionRow(BUILDER_APPLICATION_IDS, applicantId, options); }

module.exports = {
  APPLICATION_FIELDS, BUILDER_APPLICATION_FIELDS, BUILDER_APPLICATION_IDS, STAFF_APPLICATION_IDS,
  buildBuilderApplicationDecisionRow, buildBuilderApplicationEmbed, buildBuilderApplicationModal, buildBuilderApplicationPanel,
  buildApplicationRejectionModal, buildApprovalMessage, buildRejectionMessage,
  buildStaffApplicationDecisionRow, buildStaffApplicationEmbed, buildStaffApplicationModal, buildStaffApplicationPanel,
};
