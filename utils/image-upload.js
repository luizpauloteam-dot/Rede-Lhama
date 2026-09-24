const { EmbedBuilder } = require("discord.js");

const config = require("../config");
const { createLogger } = require("./logger");

const log = createLogger("image-upload");

function isValidImage(attachment) {
  const contentType = String(attachment.contentType || "").split(";")[0].toLowerCase();
  return config.imageUpload.allowedTypes.includes(contentType);
}

async function uploadToImgBB(attachment) {
  if (!config.imageUpload.apiKey) {
    throw new Error("Integração ImgBB sem chave de API configurada.");
  }
  if (attachment.size > config.imageUpload.maxImageSize) {
    throw new Error(`A imagem ${attachment.name} ultrapassa o limite de 32 MB.`);
  }

  const imageResponse = await fetch(attachment.url);
  if (!imageResponse.ok) throw new Error(`Não foi possível baixar ${attachment.name} do Discord.`);

  const formData = new FormData();
  formData.append("image", await imageResponse.blob(), attachment.name);
  const response = await fetch(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(config.imageUpload.apiKey)}`, {
    method: "POST",
    body: formData,
  });
  const data = await response.json();
  if (!response.ok || !data.success) {
    throw new Error(data?.error?.message || "O ImgBB recusou o upload.");
  }

  return { name: attachment.name, size: attachment.size, url: data.data.url };
}

async function sendLog(client, { user, channel, results = [], error = "" }) {
  try {
    const logChannel = await client.channels.fetch(config.imageUpload.logChannelId);
    if (!logChannel?.isTextBased()) {
      log.warn("Canal de log do uploader inválido ou inacessível.");
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(error ? 0xE74C3C : 0x2ECC71)
      .setTitle(error ? "Upload de imagens com erro" : "Upload de imagens concluído")
      .addFields(
        { name: "Usuário", value: `${user} (${user.id})` },
        { name: "Canal", value: `${channel}`, inline: true },
        { name: "Imagens", value: String(results.length), inline: true },
      )
      .setTimestamp();

    if (error) embed.addFields({ name: "Erro", value: error.slice(0, 1024) });
    if (results.length) {
      const links = results.map((image, index) => `**${index + 1}.** [${image.name}](${image.url})`).join("\n");
      embed.addFields({ name: "Links gerados", value: links.slice(0, 1024) });
    }
    await logChannel.send({ embeds: [embed] });
  } catch (sendError) {
    log.error("Falha ao publicar log de upload.", sendError);
  }
}

async function processImages(client, { user, channel, attachments }) {
  const images = attachments.filter(isValidImage);
  if (!images.length) throw new Error("Nenhuma imagem válida foi encontrada. Formatos aceitos: PNG, JPG, GIF e WEBP.");
  if (images.length > config.imageUpload.maxImages) {
    throw new Error(`O máximo permitido é de ${config.imageUpload.maxImages} imagens por envio.`);
  }
  const oversized = images.find((image) => image.size > config.imageUpload.maxImageSize);
  if (oversized) throw new Error(`A imagem ${oversized.name} ultrapassa o limite de 32 MB.`);

  const results = [];
  try {
    for (const image of images) results.push(await uploadToImgBB(image));
    await sendLog(client, { user, channel, results });
    return results;
  } catch (error) {
    await sendLog(client, { user, channel, results, error: error.message });
    throw error;
  }
}

function formatResults(results) {
  return results.map((image, index) => `**Imagem ${index + 1}:** ${image.url}`).join("\n");
}

module.exports = { config, formatResults, isValidImage, processImages, sendLog };
