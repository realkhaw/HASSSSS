const { EmbedBuilder } = require('discord.js');
const database = require('../Modules/DatabaseModule');
const { isExpired } = require('../Modules/JunkieModule');

function getPurchasedLicenseFields(transactions = []) {
  const purchases = transactions
    .filter(
      (transaction) =>
        transaction.type === 'purchase' &&
        transaction.status === 'completed' &&
        typeof transaction.key === 'string' &&
        transaction.key.length > 0,
    )
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));

  const maxLicenseFields = purchases.length > 24 ? 23 : 24;
  const fields = purchases.slice(0, maxLicenseFields).map((purchase, index) => {
    const key = purchase.key.replace(/[`\\]/g, '\\$&').replace(/[\r\n]/g, '');
    const purchasedAt = Date.parse(purchase.createdAt);
    const purchaseTime = Number.isFinite(purchasedAt)
      ? `<t:${Math.floor(purchasedAt / 1000)}:F>`
      : 'Purchase date unavailable';
    return {
      name: `License #${index + 1}`,
      value: `Key: \`${key}\`\nPurchased: ${purchaseTime}`,
    };
  });

  if (purchases.length > maxLicenseFields) {
    fields.push({
      name: 'Older purchases',
      value: `${purchases.length - maxLicenseFields} more license(s).`,
    });
  }
  if (fields.length === 0) {
    fields.push({
      name: 'Purchased Licenses',
      value: 'No purchased licenses yet.',
    });
  }
  return fields;
}

module.exports = {
  async execute(interaction) {
    const db = await database.readDatabase();
    const user = database.getUser(db, interaction.user.id);
    const balance = user?.balance ?? 0;
    const license = user?.license;
    const expired = Boolean(license?.expiresAt && isExpired({ expires_at: license.expiresAt }));
    const active = Boolean(license?.key && license.status === 'active' && !expired);

    const embed = new EmbedBuilder()
      .setColor(active ? 0x2ecc71 : 0x5865f2)
      .setTitle('Account Overview')
      .addFields(
        { name: 'Point', value: balance.toLocaleString('en-US'), inline: true },
        ...getPurchasedLicenseFields(user?.transactions),
      );

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};