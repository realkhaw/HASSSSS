const { randomUUID } = require('node:crypto');
const { getConfig } = require('./Config');
const database = require('./DatabaseModule');

const REDEEM_URL = 'https://paywithme.xnoxstudio.in.th/api/angpao/redeem';
const REQUEST_TIMEOUT_MS = 12000;
const MAX_LOGGED_RESPONSE_LENGTH = 5000;
const SENSITIVE_FIELD = /authorization|secret|token|voucher|password|phone|mobile|wallet|email/i;

function sanitizeApiResponse(value, field = '') {
  if (SENSITIVE_FIELD.test(field)) return '[REDACTED]';
  if (Array.isArray(value)) return value.map((entry) => sanitizeApiResponse(entry));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, sanitizeApiResponse(entry, key)]),
    );
  }
  if (typeof value === 'string') {
    return value
      .replace(
        /https?:\/\/gift\.truemoney\.com\/campaign\/\?v=[^&\s]+/gi,
        'https://gift.truemoney.com/campaign/?v=[REDACTED]',
      )
      .slice(0, 1000);
  }
  return value;
}

function logApiResponse(response, payload) {
  const serialized = JSON.stringify(
    {
      status: response.status,
      ok: response.ok,
      body: sanitizeApiResponse(payload),
    },
    null,
    2,
  );
  const output = serialized.length > MAX_LOGGED_RESPONSE_LENGTH
    ? `${serialized.slice(0, MAX_LOGGED_RESPONSE_LENGTH)}\n... [truncated]`
    : serialized;
  console.info(`Xnox PayWithMe API response:\n${output}`);
}

class PaymentApiError extends Error {
  constructor(status, code) {
    super(`Payment API request failed (HTTP ${status}${code ? `, ${code}` : ''}).`);
    this.name = 'PaymentApiError';
    this.status = status;
    this.code = code;
  }
}

function validateVoucher(voucher) {
  let url;
  try {
    url = new URL(voucher.trim());
  } catch {
    throw new Error('Invalid TrueMoney Angpao link.');
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'gift.truemoney.com' ||
    url.pathname.replace(/\/+$/, '') !== '/campaign' ||
    !url.searchParams.get('v')
  ) {
    throw new Error('Use a valid https://gift.truemoney.com/campaign/?v=... link.');
  }
  return url.toString();
}

async function callRedeemApi(voucher) {
  const { paymentClientId, paymentClientSecret } = getConfig();
  if (!paymentClientId || !paymentClientSecret) {
    const error = new Error('Payment Client ID or Client Secret is not configured.');
    error.name = 'PaymentConfigurationError';
    throw error;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(REDEEM_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'X-Client-Id': paymentClientId,
        'X-Client-Secret': paymentClientSecret,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ voucher }),
    });

    let payload;
    try {
      payload = await response.json();
    } catch {
      console.error(
        `Xnox PayWithMe API returned a non-JSON or empty response (HTTP ${response.status}).`,
      );
      throw new PaymentApiError(response.status);
    }
    logApiResponse(response, payload);

    if (!response.ok) {
      throw new PaymentApiError(
        response.status,
        typeof payload.code === 'string' ? payload.code : undefined,
      );
    }
    return payload;
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error(
        'Payment request timed out. Check your TrueMoney wallet before contacting support; do not submit this voucher again.',
      );
      timeoutError.name = 'PaymentTimeoutError';
      throw timeoutError;
    }
    if (!(error instanceof PaymentApiError)) {
      const networkError = new Error(
        'Payment API connection failed; the redemption result is uncertain.',
      );
      networkError.name = 'PaymentNetworkError';
      throw networkError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function creditConfirmedPayment(paymentId, userId, amount) {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new Error(
      'The voucher was accepted, but its amount could not be safely credited. Contact support and do not submit it again.',
    );
  }

  return database.transaction((db) => {
    const user = database.ensureUser(db, userId);
    if (!Number.isSafeInteger(user.balance + amount)) {
      throw new Error(
        'The voucher was accepted, but its amount could not be safely credited. Contact support.',
      );
    }

    const timestamp = new Date().toISOString();
    user.balance += amount;
    user.transactions.push({
      id: paymentId,
      type: 'topup',
      amount,
      currency: 'THB',
      status: 'completed',
      createdAt: timestamp,
      provider: 'TrueMoney Angpao',
    });
    return { id: paymentId, amount, balance: user.balance };
  });
}

async function redeemVoucher(userId, submittedVoucher) {
  const voucher = validateVoucher(submittedVoucher);
  const { paymentClientId, paymentClientSecret } = getConfig();
  if (!paymentClientId || !paymentClientSecret) {
    const error = new Error('Payment Client ID or Client Secret is not configured.');
    error.name = 'PaymentConfigurationError';
    throw error;
  }
  const paymentId = randomUUID();

  const result = await callRedeemApi(voucher);

  if (result.success !== true) {
    return {
      success: false,
      message: typeof result.message === 'string'
        ? result.message
        : 'TrueMoney did not confirm this voucher.',
    };
  }

  const credited = await creditConfirmedPayment(paymentId, userId, result.amount);
  return { success: true, ...credited };
}

module.exports = {
  PaymentApiError,
  redeemVoucher,
  validateVoucher,
};
