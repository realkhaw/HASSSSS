const { createHash, randomUUID } = require('node:crypto');
const { getConfig } = require('./Config');
const database = require('./DatabaseModule');

const REDEEM_URL = 'https://paywithme.xnoxstudio.in.th/api/angpao/redeem';
const REQUEST_TIMEOUT_MS = 12000;

class PaymentApiError extends Error {
  constructor(status, code) {
    super(`Payment API request failed (HTTP ${status}${code ? `, ${code}` : ''}).`);
    this.name = 'PaymentApiError';
    this.status = status;
    this.code = code;
  }
}

class VoucherAlreadyUsedError extends Error {
  constructor(payment, userId) {
    super('This voucher has already been submitted and cannot be retried.');
    this.name = 'VoucherAlreadyUsedError';
    this.rejectedBySameWallet =
      payment.userId === userId &&
      payment.status === 'failed' &&
      payment.failureCode === 'CANNOT_GET_OWN_VOUCHER';
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

function voucherFingerprint(voucher) {
  const token = new URL(voucher).searchParams.get('v');
  return createHash('sha256').update(token).digest('hex');
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
      throw new PaymentApiError(response.status);
    }

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

async function setPaymentStatus(paymentId, status, extra = {}) {
  await database.transaction((db) => {
    const payment = db.processedPayments.find((entry) => entry.id === paymentId);
    if (!payment) throw new Error('Top-up transaction record is missing.');
    if (payment.status !== 'processing') return;
    Object.assign(payment, extra, { status, updatedAt: new Date().toISOString() });
  });
}

async function creditConfirmedPayment(paymentId, userId, amount, message) {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    await setPaymentStatus(paymentId, 'review', {
      providerMessage: 'API confirmed redemption but returned an invalid amount.',
    });
    throw new Error(
      'The voucher was accepted, but its amount could not be safely credited. Contact support and do not submit it again.',
    );
  }

  const result = await database.transaction((db) => {
    const payment = db.processedPayments.find((entry) => entry.id === paymentId);
    if (!payment) throw new Error('Top-up transaction record is missing.');
    if (payment.status !== 'processing') {
      throw new Error('This top-up transaction has already been processed.');
    }

    const user = database.ensureUser(db, userId);
    if (!Number.isSafeInteger(user.balance + amount)) {
      payment.status = 'review';
      payment.updatedAt = new Date().toISOString();
      return { error: 'The confirmed amount exceeds the account balance limit.' };
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
    payment.status = 'completed';
    payment.amount = amount;
    payment.providerMessage = typeof message === 'string' ? message : null;
    payment.updatedAt = timestamp;
    return { id: paymentId, amount, balance: user.balance };
  });
  if (result.error) {
    throw new Error(
      'The voucher was accepted, but its amount could not be safely credited. Contact support.',
    );
  }
  return result;
}

async function redeemVoucher(userId, submittedVoucher) {
  const voucher = validateVoucher(submittedVoucher);
  const { paymentClientId, paymentClientSecret } = getConfig();
  if (!paymentClientId || !paymentClientSecret) {
    const error = new Error('Payment Client ID or Client Secret is not configured.');
    error.name = 'PaymentConfigurationError';
    throw error;
  }
  const fingerprint = voucherFingerprint(voucher);
  const paymentId = randomUUID();

  await database.transaction((db) => {
    const previousPayment = db.processedPayments.find(
      (payment) => payment.voucherFingerprint === fingerprint,
    );
    if (previousPayment) {
      throw new VoucherAlreadyUsedError(previousPayment, userId);
    }
    database.ensureUser(db, userId);
    db.processedPayments.push({
      id: paymentId,
      userId,
      voucherFingerprint: fingerprint,
      amount: null,
      currency: 'THB',
      status: 'processing',
      createdAt: new Date().toISOString(),
    });
  });

  let result;
  try {
    result = await callRedeemApi(voucher);
  } catch (error) {
    await setPaymentStatus(paymentId, 'uncertain', {
      failureCode: error.code || error.name,
    });
    throw error;
  }

  if (result.success !== true) {
    await setPaymentStatus(paymentId, 'failed', {
      failureCode: typeof result.code === 'string' ? result.code : 'UNKNOWN',
      providerMessage: typeof result.message === 'string' ? result.message : null,
    });
    return {
      success: false,
      message: typeof result.message === 'string'
        ? result.message
        : 'TrueMoney did not confirm this voucher.',
    };
  }

  const credited = await creditConfirmedPayment(
    paymentId,
    userId,
    result.amount,
    result.message,
  );
  return { success: true, ...credited };
}

module.exports = {
  PaymentApiError,
  VoucherAlreadyUsedError,
  redeemVoucher,
  validateVoucher,
};
