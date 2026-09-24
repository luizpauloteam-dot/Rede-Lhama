const { MessageFlags, SlashCommandBuilder } = require("discord.js");

const { config, createUserResultCard, isValidImage, processImages } = require("../../utils/image-upload");

const data = new SlashCommandBuilder()
  .setName("upload")
  .setDescription("Envie imagens para o ImgBB e receba os links.");

for (let index = 1; index <= config.imageUpload.maxImages; index += 1) {
  data.addAttachmentOption((option) => option
    .setName(`imagem${index}`)
    .setDescription(`Imagem ${index}${index === 1 ? " (obrigatória)" : " (opcional)"}`)
    .setRequired(index === 1));
}

module.exports = {
  data,
  async run(client, interaction) {
    if (interaction.channelId !== config.imageUpload.uploadChannelId) {
      await interaction.reply({
        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
        components: [createUserResultCard([], "O comando `/upload` só pode ser usado no canal de imagens.")],
      });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const attachments = [];
      for (let index = 1; index <= config.imageUpload.maxImages; index += 1) {
        const attachment = interaction.options.getAttachment(`imagem${index}`);
        if (attachment) attachments.push(attachment);
      }
      const invalid = attachments.find((attachment) => !isValidImage(attachment));
      if (invalid) throw new Error("Só são aceitas imagens PNG, JPG, GIF e WEBP.");

      const results = await processImages(client, {
        user: interaction.user,
        channel: interaction.channel,
        attachments,
      });
      await interaction.editReply({
        flags: MessageFlags.IsComponentsV2,
        components: [createUserResultCard(results)],
      });
    } catch (error) {
      await interaction.editReply({
        flags: MessageFlags.IsComponentsV2,
        components: [createUserResultCard([], error.message)],
      });
    }
  },
};
