const { randomUUID } = require('node:crypto');
const database = require('./DatabaseModule');
const { createLicenseKey } = require('./JunkieModule');

const PURCHASE_PRICE = 50;
let purchaseQueue = Promise.resolve();

class InsufficientBalanceError extends Error {
  constructor() {
    super('Insufficient Point balance.');
    this.name = 'InsufficientBalanceError';
  }
}

class PurchaseOutcomeUncertainError extends Error {
  constructor(purchaseId) {
    super(
      `The key provider did not confirm the purchase. ${PURCHASE_PRICE} Point is reserved; contact support with reference ${purchaseId} and do not retry.`,
    );
    this.name = 'PurchaseOutcomeUncertainError';
  }
}

function serializePurchase(callback) {
  const operation = purchaseQueue.then(callback);
  purchaseQueue = operation.catch(() => {});
  return operation;
}

async function updatePurchase(userId, purchaseId, updater) {
  await database.transaction((db) => {
    const user = database.getUser(db, userId);
    const transaction = user?.transactions.find((entry) => entry.id === purchaseId);
    if (!transaction || transaction.status !== 'processing') {
      throw new Error('Purchase transaction is missing or has already been updated.');
    }
    updater(user, transaction);
  });
}

async function purchaseKey(userId) {
  return serializePurchase(async () => {
    const purchaseId = randomUUID();
    await database.transaction((db) => {
      const user = database.ensureUser(db, userId);
      if (user.balance < PURCHASE_PRICE) throw new InsufficientBalanceError();
      user.balance -= PURCHASE_PRICE;
      user.transactions.push({
        id: purchaseId,
        type: 'purchase',
        amount: PURCHASE_PRICE,
        currency: 'Point',
        status: 'processing',
        createdAt: new Date().toISOString(),
      });
    });

    let key;
    try {
      key = await createLicenseKey(userId);
    } catch (error) {
      if (error.outcomeUncertain) {
        await updatePurchase(userId, purchaseId, (_user, transaction) => {
          transaction.status = 'uncertain';
          transaction.updatedAt = new Date().toISOString();
        });
        throw new PurchaseOutcomeUncertainError(purchaseId);
      }

      await updatePurchase(userId, purchaseId, (user, transaction) => {
        user.balance += PURCHASE_PRICE;
        transaction.status = 'failed';
        transaction.refundedAt = new Date().toISOString();
      });
      throw error;
    }

    let balance;
    await updatePurchase(userId, purchaseId, (user, transaction) => {
      const timestamp = new Date().toISOString();
      user.license = {
        key: key.key_value,
        keyId: key.id,
        status: 'active',
        expiresAt: key.expires_at || null,
        validityMinutes: key.validity_minutes ?? null,
        activatedAt: timestamp,
      };
      transaction.status = 'completed';
      transaction.key = key.key_value;
      transaction.keyId = key.id;
      transaction.updatedAt = timestamp;
      balance = user.balance;
    });

    return { key: key.key_value, balance };
  });
}

module.exports = { InsufficientBalanceError, purchaseKey };
