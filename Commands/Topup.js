const {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const {
  PaymentApiError,
  VoucherAlreadyUsedError,
  redeemVoucher,
} = require('../Modules/TopupModule');

const MODAL_PREFIX = 'topup:angpao:';

function getErrorMessage(error) {
  if (error instanceof VoucherAlreadyUsedError) {
    if (error.rejectedBySameWallet) {
      return 'This Angpao was created from the same TrueMoney Wallet as the store, so TrueMoney rejected it and no Point was added. Please use a new voucher created from a different wallet. Check the voucher status in TrueMoney before trying again.';
    }
    return 'This voucher has already been submitted. Do not send it again; contact support if your wallet was charged.';
  }
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

  try {
    const result = await redeemVoucher(interaction.user.id, voucher);
    if (!result.success) {
      await interaction.editReply(result.message);
      return;
    }

    await interaction.editReply(
      `Top-up confirmed: **${result.amount.toLocaleString('en-US')} THB** added to your Point.\nTransaction reference: \`${result.id}\`\nNew balance: **${result.balance.toLocaleString('en-US')} Point**`,
    );
  } catch (error) {
    const message = getErrorMessage(error);
    if (message) {
      await interaction.editReply(message);
      return;
    }
    throw error;
  }
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
      await interaction.reply({
        content: 'This top-up form does not belong to your account.',
        ephemeral: true,
      });
      return;
    }
    await submitVoucher(interaction);
  },
};
