const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');

const BANNER_URL = 'https://raw.githubusercontent.com/vita8it/Novel/main/Assets/Banner.png';
const PANEL_FOOTER = '© 2026 Novel LLC. All rights reserved.';

function createPanelMessage() {
  const embed = new EmbedBuilder()
    .setColor(0xd61e73)
    .setTitle("Novel's Manager")
    .setDescription('For paymentable, keep your license secure.\nซื้อเสร็จให้ไปเปิดใช้งานที่ https://discord.com/channels/1550719518865760338/1553079048874500196')
    .setFooter({ text: PANEL_FOOTER })
    .setImage(BANNER_URL);
  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('panel:purchase')
      .setLabel(' Purchase')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🛒'),
    new ButtonBuilder()
      .setCustomId('panel:topup')
      .setLabel(' Topup')
      .setStyle(ButtonStyle.Success)
      .setEmoji('🧧'),
    new ButtonBuilder()
      .setCustomId('panel:overview')
      .setLabel(' Overview')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('ℹ️'),
  );

  return { embeds: [embed], components: [buttons] };
}

async function publish(client, channelId) {
  const channel = await client.channels.fetch(channelId);
  if (!channel?.isTextBased() || !channel.messages) {
    throw new Error('Configured panel channel is not a text channel.');
  }

  const messages = await channel.messages.fetch({ limit: 100 });
  const existingPanel = messages.find(
    (message) =>
      message.author.id === client.user.id &&
      message.embeds.some((embed) => embed.title === "Novel's Manager") &&
      message.components.some((row) =>
        row.components.some((component) => component.customId === 'panel:purchase'),
      ),
  );
  if (existingPanel) {
    await existingPanel.edit(createPanelMessage());
    return existingPanel;
  }
  return channel.send(createPanelMessage());
}

module.exports = { publish };
