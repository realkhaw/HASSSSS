const {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const {
  PaymentApiError,
  redeemVoucher,
} = require('../Modules/TopupModule');
const { respondPrivately } = require('../Modules/PrivateResponseModule');

const MODAL_PREFIX = 'topup:angpao:';

function getErrorMessage(error) {
  if (error.name === 'PaymentConfigurationError') {
    return 'Top-up is not configured. Please contact an administrator.';
  }
  if (error.name === 'PaymentTimeoutError' || error.name === 'AbortError') {
    return 'Payment request timed out. Check your TrueMoney wallet before contacting support; do not submit this voucher again.';
  }
  if (error.name === 'PaymentNetworkError') {
    return 'Could not confirm the voucher result. Check your TrueMoney wallet and contact support; do not submit the voucher again.';
  }
  if (error instanceof PaymentApiError) {
    if (error.status === 401) return 'Payment API rejected its configured credentials. Please contact an administrator.';
    if (error.status === 409) return 'This voucher is already being redeemed. Do not submit it again; contact support if needed.';
    if (error.status === 502) return 'TrueMoney could not confirm the voucher. Check your wallet and contact support; do not submit it again.';
    if (error.code === 'TRUEMONEY_NOT_SET') return 'The store has not configured its TrueMoney Wallet number. Please contact an administrator.';
    if (error.code === 'INVALID_VOUCHER') return 'The Angpao link is invalid. Please check the link and try a new voucher.';
    return `Payment service returned an error (HTTP ${error.status}). Please contact support.`;
  }
  if (
    error.message === 'Invalid TrueMoney Angpao link.' ||
    error.message === 'Use a valid https://gift.truemoney.com/campaign/?v=... link.'
  ) {
    return error.message;
  }
  if (error.message.startsWith('The voucher was accepted')) return error.message;
  return null;
}

async function submitVoucher(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const voucher = interaction.fields.getTextInputValue('voucher_url').trim();

  console.info('Top-up redemption started.');
  let result;
  try {
    result = await redeemVoucher(interaction.user.id, voucher);
  } catch (error) {
    const name = typeof error?.name === 'string' ? error.name : 'Error';
    const status = Number.isInteger(error?.status) ? ` (HTTP ${error.status})` : '';
    const code = typeof error?.code === 'string' ? ` [${error.code}]` : '';
    const detail = typeof error?.message === 'string' ? `: ${error.message}` : '';
    console.error(`Top-up redemption failed: ${name}${status}${code}${detail}`);

    const message = getErrorMessage(error);
    if (message) {
      await respondPrivately(interaction, message);
      return;
    }
    throw error;
  }

  if (!result.success) {
    console.info('Top-up voucher was not accepted by the payment provider.');
    await respondPrivately(interaction, result.message);
    return;
  }

  console.info('Top-up redemption confirmed.');
  await respondPrivately(
    interaction,
    `Top-up confirmed: **${result.amount.toLocaleString('en-US')} THB** added to your Point.\nTransaction reference: \`${result.id}\`\nNew balance: **${result.balance.toLocaleString('en-US')} Point**`,
  );
}

module.exports = {
  async showModal(interaction) {
    const input = new TextInputBuilder()
      .setCustomId('voucher_url')
      .setLabel('TrueMoney Angpao link')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('https://gift.truemoney.com/campaign/?v=...')
      .setRequired(true)
      .setMaxLength(500);
    const modal = new ModalBuilder()
      .setCustomId(`${MODAL_PREFIX}${interaction.user.id}`)
      .setTitle('Top up with Angpao')
      .addComponents(new ActionRowBuilder().addComponents(input));

    await interaction.showModal(modal);
  },

  async handleModalSubmit(interaction) {
    if (interaction.customId !== `${MODAL_PREFIX}${interaction.user.id}`) {
      await respondPrivately(interaction, {
        content: 'This top-up form does not belong to your account.',
      });
      return;
    }
    await submitVoucher(interaction);
  },
};
