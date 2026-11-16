const RESPONSE_TOKEN_TTL_MS = 14 * 60 * 1000;
const previousResponses = new Map();

function getResponseKey(interaction) {
  return `${interaction.user.id}:${interaction.channelId ?? 'unknown-channel'}`;
}

function isMissingResponse(error) {
  const code = Number(error?.code);
  return error?.status === 404 || code === 10008 || code === 10015;
}

function removeExpiredResponses(now) {
  for (const [key, response] of previousResponses) {
    if (response.expiresAt <= now) previousResponses.delete(key);
  }
}

async function respondPrivately(interaction, response) {
  const messageOptions = typeof response === 'string' ? { content: response } : response;
  let currentReplyMode;
  if (interaction.deferred) {
    currentReplyMode = 'deferred';
  } else if (interaction.replied) {
    currentReplyMode = 'replied';
  } else {
    await interaction.deferReply({ ephemeral: true });
    currentReplyMode = 'deferred';
  }

  const now = Date.now();
  removeExpiredResponses(now);

  const key = getResponseKey(interaction);
  const previous = previousResponses.get(key);
  if (previous) {
    try {
      await previous.webhook.editMessage(previous.messageId, messageOptions);
      if (currentReplyMode === 'deferred') await interaction.deleteReply();
      return;
    } catch (error) {
      if (!isMissingResponse(error)) throw error;
      console.warn('Previous private response is no longer editable; sending a new private response.');
      previousResponses.delete(key);
    }
  }

  const message = currentReplyMode === 'deferred'
    ? await interaction.editReply(messageOptions)
    : await interaction.followUp({ ...messageOptions, ephemeral: true });

  previousResponses.set(key, {
    webhook: interaction.webhook,
    messageId: message.id,
    expiresAt: interaction.createdTimestamp + RESPONSE_TOKEN_TTL_MS,
  });
}

module.exports = { respondPrivately };
