const {
  ButtonStyle,
  ComponentType,
  ContainerBuilder,
} = require("discord.js");

const config = require("../config");

function escapeDiscordText(value) {
  return String(value || "")
    .replace(/\u00a7[0-9a-fk-or]/gi, "")
    .replace(/\\/g, "\\\\")
    .replace(/([`*_~|>])/g, "\\$1")
    .trim();
}

function normalizePanelText(value, fallback) {
  const text = escapeDiscordText(value);
  return text || fallback;
}

function getStatusImage(serverStatus) {
  return serverStatus?.online
    ? config.status.images.on
    : config.status.images.manutencao;
}

function getStatusMediaDescription(serverStatus) {
  return serverStatus?.online
    ? "Servidor online"
    : "Servidor offline ou em manutencao";
}

function getPlayerLabel(serverStatus) {
  if (!serverStatus?.online) {
    return config.status.players;
  }

  return `${serverStatus.players}/${serverStatus.maxPlayers}`;
}

function buildDetailLine(serverStatus) {
  if (!serverStatus?.online) {
    return serverStatus?.stale
      ? "Sem atualizacao recente do servidor."
      : "Servidor offline ou em manutencao.";
  }

  return "";
}

function buildStatusContent(serverStatus) {
  const title = serverStatus?.online
    ? normalizePanelText(serverStatus.name, config.status.title)
    : config.status.title;
  const details = buildDetailLine(serverStatus);
  const lines = [`# ${title}`];

  if (details) {
    lines.push(details);
  }

  return lines.join("\n");
}

function buildStatusComponents(serverStatus) {
  const imageUrl = getStatusImage(serverStatus);

  if (!imageUrl) {
    throw new Error("Imagem do status nao configurada.");
  }

  const container = new ContainerBuilder({
    accent_color: config.status.accentColor,
    components: [
      {
        type: ComponentType.Section,
        components: [
          {
            type: ComponentType.TextDisplay,
            content: buildStatusContent(serverStatus),
          },
        ],
        accessory: {
          type: ComponentType.Button,
          style: ButtonStyle.Secondary,
          custom_id: "status_players",
          label: getPlayerLabel(serverStatus),
          disabled: true,
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
              url: imageUrl,
            },
            description: getStatusMediaDescription(serverStatus),
          },
        ],
      },
    ],
  });

  return [container.toJSON()];
}

module.exports = {
  buildStatusComponents,
};
