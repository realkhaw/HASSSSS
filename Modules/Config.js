const fs = require('node:fs');
const path = require('node:path');

function setupEnv(filePath = path.resolve(__dirname, '../.env')) {
  let contents;
  try {
    contents = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }

  for (const line of contents.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || Object.hasOwn(process.env, match[1])) continue;

    let value = match[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, '');
    }
    process.env[match[1]] = value;
  }
}

function firstConfigured(...names) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return null;
}

function getConfig() {
  return {
    discordToken: firstConfigured('DISCORD_BOT_TOKEN', 'DISCORD_TOKEN'),
    discordClientId: firstConfigured('DISCORD_CLIENT_ID'),
    guildId: firstConfigured('DISCORD_SERVER_ID', 'GUILD_ID'),
    channelId: firstConfigured('DISCORD_CHANEL_ID', 'DISCORD_CHANNEL_ID', 'CHANNEL_ID'),
    junkieApiKey: firstConfigured('JNK_API_KEY', 'JUNKIE_API_KEY'),
    junkieProviderId: firstConfigured(
      'JNK_PROVIDER',
      'JUNKIE_PROVIDER_ID',
    ),
    junkieServiceId: firstConfigured('JUNKIE_SERVICE_ID', 'JUNKIE_PRODUCT_ID'),
    paymentClientId: firstConfigured('PAYMENT_CLIENT_ID'),
    paymentClientSecret: firstConfigured('PAYMENT_CLIENT_SECRET'),
  };
}

module.exports = { setupEnv, getConfig };
