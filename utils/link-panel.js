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
          "# Vincule sua conta do Discord à conta do servidor",
          "Sincronize a sua conta com o servidor para desbloquear recursos no Discord e garantir maior segurança para a sua conta.",
        ].join("\n"),
      ),
      {
        type: ComponentType.Separator,
        divider: true,
        spacing: 1,
      },
      buildText(
        [
          "**Benefícios ao vincular sua conta:**",
          "- Acesso às salas de voz privadas no Discord.",
          "- Possibilidade de enviar sugestões para melhorar nossos servidores.",
          "- Divulgação do seu clã no canal de divulgação de clãs.",
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
          "**Como posso vincular minha conta?**",
          "**Primeiro no Minecraft:**",
          "1. Entre no servidor.",
          "2. No jogo, digite `/discord conectar` e copie o código de 4 dígitos.",
          "",
          "**Agora, vamos ao Discord:**",
          "1. Clique no botão ao lado.",
          "2. Digite o código que você copiou.",
        ].join("\n"),
      ),
      {
        type: ComponentType.Section,
        components: [
          buildText("Pronto. A sua conta agora está vinculada."),
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
            description: "Banner de vinculação do servidor",
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
    .setLabel("Código de 4 dígitos")
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
