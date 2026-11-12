const { getConfig } = require('./Config');

const API_BASE = 'https://api.jnkie.com/api/v2';
const REQUEST_TIMEOUT_MS = 8000;

class JunkieApiError extends Error {
  constructor(status, outcomeUncertain = false) {
    super(`Junkie API request failed (${status}).`);
    this.name = 'JunkieApiError';
    this.status = status;
    this.outcomeUncertain = outcomeUncertain;
  }
}

function getApiKey() {
  const apiKey = getConfig().junkieApiKey;
  if (!apiKey) throw new Error('Junkie API key is not configured.');
  return apiKey;
}

async function request(method, endpoint, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      method,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${getApiKey()}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new JunkieApiError(response.status, true);
    }
    if (!response.ok) {
      throw new JunkieApiError(response.status, response.status >= 500);
    }
    return payload;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Junkie API request timed out.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function isExpired(key) {
  if (!key.expires_at) return false;
  const expiry = Date.parse(key.expires_at);
  return !Number.isFinite(expiry) || expiry <= Date.now();
}

async function resolveProviderId(configuredProvider) {
  if (!configuredProvider) return null;
  if (/^\d+$/.test(configuredProvider)) return configuredProvider;

  const result = await request('GET', '/providers');
  const matches = (result.providers || []).filter(
    (provider) =>
      typeof provider.name === 'string' &&
      provider.name.toLocaleLowerCase() === configuredProvider.toLocaleLowerCase(),
  );
  if (matches.length !== 1 || !Number.isInteger(matches[0].id)) {
    throw new Error('Configured Junkie provider name was not found or is ambiguous.');
  }
  return String(matches[0].id);
}

async function createLicenseKey(userId) {
  const config = getConfig();
  if (!config.junkieApiKey) throw new Error('Junkie API key is not configured.');
  if (!config.junkieProviderId) {
    throw new Error('JUNKIE_PROVIDER_ID must be configured before keys can be purchased.');
  }
  if (config.junkieServiceId && !/^\d+$/.test(config.junkieServiceId)) {
    throw new Error('JUNKIE_PRODUCT_ID must contain a numeric Junkie service ID.');
  }

  const providerId = await resolveProviderId(config.junkieProviderId);
  if (!providerId) {
    throw new Error('JUNKIE_PROVIDER_ID must be configured before keys can be purchased.');
  }
  const numericProviderId = Number(providerId);
  if (
    !Number.isSafeInteger(numericProviderId) ||
    numericProviderId < 1
  ) {
    throw new Error('JUNKIE_PROVIDER_ID must be a valid numeric ID.');
  }

  const body = {
    provider_id: numericProviderId,
    validity_minutes: null,
    discord_id: userId,
  };
  if (config.junkieServiceId) {
    const numericServiceId = Number(config.junkieServiceId);
    if (!Number.isSafeInteger(numericServiceId) || numericServiceId < 1) {
      throw new Error('JUNKIE_PRODUCT_ID must contain a valid numeric Junkie service ID.');
    }
    body.service_id = numericServiceId;
  }

  let result;
  try {
    result = await request('POST', '/keys', body);
  } catch (error) {
    if (!(error instanceof JunkieApiError) || error.outcomeUncertain) {
      error.outcomeUncertain = true;
    }
    throw error;
  }

  if (
    !result.key ||
    !Number.isInteger(result.key.id) ||
    typeof result.key.key_value !== 'string' ||
    !result.key.key_value
  ) {
    const error = new Error('Junkie returned an invalid key creation response.');
    error.outcomeUncertain = true;
    throw error;
  }
  return result.key;
}

module.exports = {
  createLicenseKey,
  isExpired,
};