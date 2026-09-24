const { Events } = require("discord.js");

const { config, formatResults, isValidImage, processImages, sendLog } = require("../utils/image-upload");
const { createLogger } = require("../utils/logger");

const log = createLogger("image-upload");

async function execute(message, client) {
  if (!message.guild || message.author.bot || message.channelId !== config.imageUpload.uploadChannelId) return;

  const attachments = [...message.attachments.values()];
  await message.delete().catch((error) => log.warn("Não foi possível apagar a mensagem original.", error));

  try {
    if (!attachments.length) throw new Error("Envie uma ou mais imagens como anexo neste canal.");
    const invalid = attachments.find((attachment) => !isValidImage(attachment));
    if (invalid) throw new Error("Só são aceitas imagens PNG, JPG, GIF e WEBP.");
    const results = await processImages(client, {
      user: message.author,
      channel: message.channel,
      attachments,
    });
    await message.author.send(`Imagens processadas com sucesso:\n${formatResults(results)}`);
  } catch (error) {
    log.warn(`Falha no upload solicitado por ${message.author.id}.`, error.message);
    await message.author.send(`Não foi possível concluir o upload: ${error.message}`).catch(() => null);
    await sendLog(client, {
      user: message.author,
      channel: message.channel,
      error: error.message,
    });
  }
}

module.exports = { name: Events.MessageCreate, execute };
