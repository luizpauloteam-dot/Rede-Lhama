const {
  AttachmentBuilder, ComponentType, ContainerBuilder, FileUploadBuilder, LabelBuilder,
  MessageFlags, ModalBuilder, StringSelectMenuBuilder, ThumbnailBuilder, UserSelectMenuBuilder,
} = require("discord.js");
const config = require("../config");

const TEAM_IDS = {
  modalPrefix: "equipe:modal:",
  member: "equipe:membro",
  role: "equipe:cargo",
  photo: "equipe:foto",
};

function buildTeamModal(type, ranks) {
  if (!["entrar", "remover"].includes(type)) throw new Error("Tipo de alteração de equipe inválido.");
  return new ModalBuilder()
    .setCustomId(`${TEAM_IDS.modalPrefix}${type}`)
    .setTitle(type === "entrar" ? "Entrar na equipe" : "Remover da equipe")
    .addComponents(
      new LabelBuilder().setLabel("Membro").setUserSelectMenuComponent(
        new UserSelectMenuBuilder().setCustomId(TEAM_IDS.member).setMinValues(1).setMaxValues(1).setRequired(true),
      ),
      new LabelBuilder().setLabel("Cargo da equipe").setStringSelectMenuComponent(
        new StringSelectMenuBuilder().setCustomId(TEAM_IDS.role).setMinValues(1).setMaxValues(1).setRequired(true)
          .addOptions(ranks.map(({ role }) => ({ label: role.name.slice(0, 100), value: role.id }))),
      ),
      new LabelBuilder().setLabel("Foto do registro").setFileUploadComponent(
        new FileUploadBuilder().setCustomId(TEAM_IDS.photo).setMinValues(1).setMaxValues(1).setRequired(true),
      ),
    );
}

function buildTeamRecord({ type, memberId, roleId, previousRoleId, photo }) {
  const extension = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" }[photo.contentType];
  const name = `equipe.${extension}`;
  const title = [config.team.titleEmoji, "• Alteração na Equipe"].filter(Boolean).join(" ");
  const descriptions = {
    entrar: `<@${memberId}> agora exerce o cargo de <@&${roleId}> na equipe.`,
    remover: `<@${memberId}> deixou de exercer o cargo de <@&${roleId}> na equipe.`,
    promover: `<@${memberId}> recebeu uma **promoção** de <@&${previousRoleId}> para <@&${roleId}> na equipe.`,
    rebaixar: `<@${memberId}> recebeu um **rebaixamento** de <@&${previousRoleId}> para <@&${roleId}> na equipe.`,
  };
  return {
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [], users: [memberId], roles: [...new Set([previousRoleId, roleId].filter(Boolean))] },
    files: [new AttachmentBuilder(photo.url, { name })],
    components: [new ContainerBuilder({ components: [
      {
        type: ComponentType.Section,
        components: [
          { type: ComponentType.TextDisplay, content: `# ${title}` },
          { type: ComponentType.TextDisplay, content: descriptions[type] },
        ],
        accessory: new ThumbnailBuilder()
          .setURL(`attachment://${name}`)
          .setDescription("Foto do membro da equipe")
          .toJSON(),
      },
    ] }).setAccentColor(Number.parseInt(config.team.color, 16)).toJSON()],
  };
}

module.exports = { TEAM_IDS, buildTeamModal, buildTeamRecord };
