const {
  ActionRowBuilder,
  ButtonStyle,
  ComponentType,
  ContainerBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");

const LINK_PANEL_CUSTOM_IDS = {
  connectButton: "link-panel:connect",
  connectModal: "link-panel:connect-modal",
  codeInput: "link-panel:code",
};

function buildText(content) {
  return {
    type: ComponentType.TextDisplay,
    content,
  };
}

function buildLinkPanelComponents() {
  const container = new ContainerBuilder({
    components: [
      buildText(
        [
          "# Vincule a sua conta do Discord com a do servidor",
          "Sincronize a sua conta com o servidor para desbloquear recursos no Discord e garantir maior seguranca para a sua conta.",
        ].join("\n"),
      ),
      {
        type: ComponentType.Separator,
        divider: true,
        spacing: 1,
      },
      buildText(
        [
          "**Beneficios ao vincular sua conta:**",
          "- Acesso as salas de voz privadas no Discord.",
          "- Possibilidade de enviar sugestoes para melhorar nossos servidores.",
          "- Divulgacao do seu cla no canal divulgacao de clas.",
          "- Acesso a brindes exclusivos em nosso canal de mimos.",
          "- Recebimento do cargo **@Membro** e, caso possua VIP no servidor, do cargo VIP correspondente.",
        ].join("\n"),
      ),
      {
        type: ComponentType.Separator,
        divider: true,
        spacing: 1,
      },
      buildText(
        [
          "**Como posso vincular a minha conta?**",
          "**Primeiro no Minecraft:**",
          "1. Entre no servidor.",
          "2. No jogo, digite `/discord conectar` e copie o codigo de 4 digitos.",
          "",
          "**Agora, vamos ao Discord:**",
          "1. Clique no botao ao lado.",
          "2. Digite o codigo que voce copiou.",
        ].join("\n"),
      ),
      {
        type: ComponentType.Section,
        components: [
          buildText("Pronto. A sua conta agora esta vinculada."),
        ],
        accessory: {
          type: ComponentType.Button,
          style: ButtonStyle.Secondary,
          custom_id: LINK_PANEL_CUSTOM_IDS.connectButton,
          label: "Vincular conta",
        },
      },
      {
        type: ComponentType.Separator,
        divider: true,
        spacing: 1,
      },
      {
        type: ComponentType.MediaGallery,
        items: [
          {
            media: {
              url: "https://i.imgur.com/QVwKl06.jpeg",
            },
            description: "Banner de vinculacao do servidor",
          },
        ],
      },
    ],
  });

  return [container.toJSON()];
}

function buildLinkCodeModal() {
  const codeInput = new TextInputBuilder()
    .setCustomId(LINK_PANEL_CUSTOM_IDS.codeInput)
    .setLabel("Codigo de 4 digitos")
    .setMinLength(4)
    .setMaxLength(4)
    .setPlaceholder("1234")
    .setRequired(true)
    .setStyle(TextInputStyle.Short);

  return new ModalBuilder()
    .setCustomId(LINK_PANEL_CUSTOM_IDS.connectModal)
    .setTitle("Vincular conta")
    .addComponents(new ActionRowBuilder().addComponents(codeInput));
}

module.exports = {
  LINK_PANEL_CUSTOM_IDS,
  buildLinkCodeModal,
  buildLinkPanelComponents,
};
