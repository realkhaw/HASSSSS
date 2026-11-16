const { EmbedBuilder } = require('discord.js');
const { purchaseKey, InsufficientBalanceError } = require('../Modules/PurchaseModule');
const { respondPrivately } = require('../Modules/PrivateResponseModule');

function getErrorMessage(error) {
  if (error instanceof InsufficientBalanceError) {
    return 'You need at least 50 Point to purchase a key.';
  }
  if (error.name === 'PurchaseOutcomeUncertainError') {
    return error.message;
  }
  if (error.name === 'JunkieApiError' && error.status === 401) {
    return 'Junkie API rejected its configured credentials. Your Point has been refunded; please contact an administrator.';
  }
  if (error.name === 'JunkieApiError' && error.status === 403) {
    return 'The Junkie API key does not have permission to create keys. Your Point has been refunded; please contact an administrator.';
  }
  if (error.name === 'JunkieApiError' && error.status >= 400 && error.status < 500) {
    return `Junkie could not create the key (HTTP ${error.status}). Your Point has been refunded.`;
  }
  if (
    error.message === 'Junkie API key is not configured.' ||
    error.message === 'JUNKIE_PRODUCT_ID must contain a numeric Junkie service ID.' ||
    error.message === 'JUNKIE_PRODUCT_ID must contain a valid numeric Junkie service ID.' ||
    error.message === 'JUNKIE_PROVIDER_ID must be a valid numeric ID.' ||
    error.message === 'JUNKIE_PROVIDER_ID must be configured before keys can be purchased.'
  ) {
    return 'Key purchasing is not configured correctly. Your Point has been refunded; please contact an administrator.';
  }
  if (error.message.startsWith('Configured Junkie provider')) {
    return 'The configured Junkie provider could not be found. Your Point has been refunded; please contact an administrator.';
  }
  return null;
}

module.exports = {
  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });
    try {
      const result = await purchaseKey(interaction.user.id);
      const safeKey = result.key.replace(/[`\\]/g, '\\$&').replace(/[\r\n]/g, '');
      const embed = new EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle('Purchase successful')
        .setDescription(`Your permanent license key: \`${safeKey}\``)
        .addFields({
          name: 'Remaining Point',
          value: result.balance.toLocaleString('en-US'),
          inline: true,
        });
      await respondPrivately(interaction, { embeds: [embed] });
    } catch (error) {
      const message = getErrorMessage(error);
      if (!message) throw error;
      await respondPrivately(interaction, message);
    }
  },
};
