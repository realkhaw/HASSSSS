const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const databasePath = path.resolve(process.env.DATABASE_PATH || path.join(__dirname, '../database.json'));
let transactionQueue = Promise.resolve();

function createEmptyDatabase() {
  return { users: {}, processedPayments: [] };
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateDatabase(database) {
  if (!isRecord(database)) throw new Error('Database root must be an object.');
  if (database.users === undefined) database.users = {};
  if (database.processedPayments === undefined) database.processedPayments = [];
  if (!isRecord(database.users) || !Array.isArray(database.processedPayments)) {
    throw new Error('Database has an invalid users or processedPayments field.');
  }

  for (const [userId, user] of Object.entries(database.users)) {
    if (!/^\d{17,20}$/.test(userId) || !isRecord(user)) {
      throw new Error('Database contains an invalid user record.');
    }
    if (
      (user.balance !== undefined &&
        (!Number.isSafeInteger(user.balance) || user.balance < 0)) ||
      (user.transactions !== undefined && !Array.isArray(user.transactions))
    ) {
      throw new Error('Database contains invalid account data.');
    }
    if (
      user.license !== undefined &&
      user.license !== null &&
      (!isRecord(user.license) ||
        (user.license.key !== null && typeof user.license.key !== 'string'))
    ) {
      throw new Error('Database contains an invalid license record.');
    }
  }
  return database;
}

async function readDatabase() {
  let contents;
  try {
    contents = await fs.readFile(databasePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return createEmptyDatabase();
    throw error;
  }

  if (!contents.trim()) return createEmptyDatabase();
  let parsed;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new Error('database.json is not valid JSON.');
  }
  return validateDatabase(parsed);
}

async function writeDatabase(database) {
  const temporaryPath = `${databasePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    const handle = await fs.open(temporaryPath, 'wx', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(database, null, 2)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.rename(temporaryPath, databasePath);
  } catch (error) {
    await fs.unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

function getUser(database, userId) {
  return database.users[userId] || null;
}

function ensureUser(database, userId) {
  if (!/^\d{17,20}$/.test(userId)) throw new Error('Invalid Discord user ID.');
  if (!database.users[userId]) {
    database.users[userId] = {
      balance: 0,
      license: {
        key: null,
        keyId: null,
        status: 'inactive',
        expiresAt: null,
        activatedAt: null,
      },
      transactions: [],
    };
  } else {
    const user = database.users[userId];
    if (user.balance === undefined) user.balance = 0;
    if (user.license === undefined) {
      user.license = {
        key: null,
        keyId: null,
        status: 'inactive',
        expiresAt: null,
        activatedAt: null,
      };
    }
    if (user.transactions === undefined) user.transactions = [];
  }
  return database.users[userId];
}

function transaction(mutator) {
  const operation = transactionQueue.then(async () => {
    const database = await readDatabase();
    const result = await mutator(database);
    validateDatabase(database);
    await writeDatabase(database);
    return result;
  });
  transactionQueue = operation.catch(() => {});
  return operation;
}

module.exports = {
  ensureUser,
  getUser,
  readDatabase,
  transaction,
};
