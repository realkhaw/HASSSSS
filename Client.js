const {
  Client,
  Events,
  GatewayIntentBits,
  REST,
  Routes,
} = require('discord.js');
const { setupEnv, getConfig } = require('./Modules/Config');
const panel = require('./Commands/Panel');
const overview = require('./Commands/Overview');
const topup = require('./Commands/Topup');
const purchase = require('./Commands/Purchase');

function logError(context, error) {
  const name = typeof error?.name === 'string' ? error.name : 'Error';
  const message = typeof error?.message === 'string' ? error.message : 'Unknown failure';
  const status = Number.isInteger(error?.status) ? ` (HTTP ${error.status})` : '';
  console.error(`${context}: ${name}${status}: ${message}`);
}

async function start() {
  setupEnv();
  const config = getConfig();
  if (!config.discordToken || !config.guildId || !config.channelId) {
    throw new Error(
      'DISCORD_BOT_TOKEN, DISCORD_SERVER_ID, and DISCORD_CHANNEL_ID must be configured.',
    );
  }

  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.once(Events.ClientReady, async (readyClient) => {
    try {
      const rest = new REST({ version: '10' }).setToken(config.discordToken);
      await rest.put(
        Routes.applicationGuildCommands(
          config.discordClientId || readyClient.application.id,
          config.guildId,
        ),
        { body: [] },
      );
      console.info('Legacy guild commands removed.');
    } catch (error) {
      logError('Unable to remove legacy guild commands', error);
    }

    try {
      await panel.publish(client, config.channelId);
      console.info(`Ready as ${readyClient.user.tag}; panel is available.`);
    } catch (error) {
      logError('Unable to publish the panel', error);
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    let handler;
    if (interaction.isButton()) {
      handler = {
        'panel:topup': topup.showModal,
        'panel:overview': overview.execute,
        'panel:purchase': purchase.execute,
      }[interaction.customId];
    } else if (
      interaction.isModalSubmit() &&
      interaction.customId.startsWith('topup:angpao:')
    ) {
      handler = topup.handleModalSubmit;
    }

    if (handler) {
      try {
        await handler(interaction);
      } catch (error) {
        logError('Panel interaction failed', error);
        try {
          if (interaction.deferred || interaction.replied) {
            await interaction.editReply({
              content: 'This action could not be completed. Please try again later.',
            });
          } else {
            await interaction.reply({
              content: 'This action could not be completed. Please try again later.',
              ephemeral: true,
            });
          }
        } catch {
          console.error('Unable to deliver the panel interaction error response.');
        }
      }
    }
  });

  client.on(Events.Error, () => {
    console.error('Discord client error.');
  });

  await client.login(config.discordToken);
  return client;
}

if (require.main === module) {
  start().catch(() => {
    console.error('Unable to start the Discord bot. Check its environment configuration.');
    process.exitCode = 1;
  });
}

module.exports = { start };
