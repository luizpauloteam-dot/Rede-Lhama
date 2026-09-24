const { Events, MessageFlags } = require("discord.js");

const {
  config,
  createUserResultCard,
  isValidImage,
  processImages,
  sendLog,
} = require("../utils/image-upload");
const { createLogger } = require("../utils/logger");

const log = createLogger("image-upload");

async function execute(message, client) {
  if (!message.guild || message.author.bot || message.channelId !== config.imageUpload.uploadChannelId) return;

  const attachments = [...message.attachments.values()];
  let results;
  let errorMessage = "";

  try {
    if (!attachments.length) throw new Error("Envie uma ou mais imagens como anexo neste canal.");
    if (attachments.some((attachment) => !isValidImage(attachment))) {
      throw new Error("Só são aceitas imagens PNG, JPG, GIF e WEBP.");
    }
    results = await processImages(client, {
      user: message.author,
      channel: message.channel,
      attachments,
    });
  } catch (error) {
    errorMessage = error.message;
    log.warn(`Falha no upload solicitado por ${message.author.id}.`, errorMessage);
    if (!attachments.length || attachments.some((attachment) => !isValidImage(attachment))) {
      await sendLog(client, { user: message.author, channel: message.channel, error: errorMessage });
    }
  } finally {
    // Discord pode invalidar a URL CDN quando a mensagem/anexo é removido.
    await message.delete().catch((error) => log.warn("Não foi possível apagar a mensagem original.", error));
  }

  const card = createUserResultCard(results || [], errorMessage);
  await message.author.send({
    flags: MessageFlags.IsComponentsV2,
    components: [card],
  }).catch(() => {
    log.warn(`Não foi possível enviar a DM do upload para ${message.author.id}.`);
  });
}

module.exports = { name: Events.MessageCreate, execute };
