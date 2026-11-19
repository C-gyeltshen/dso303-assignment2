'use strict';
// Connection to PostgreSQL through RDS Proxy. Credentials come from the
// RDS-managed secret in Secrets Manager; the pool is reused across warm invocations.
const { Pool } = require('pg');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

const sm = new SecretsManagerClient({});
let poolPromise;

async function createPool() {
  const res = await sm.send(new GetSecretValueCommand({ SecretId: process.env.DB_SECRET_ARN }));
  const { username, password } = JSON.parse(res.SecretString);
  const pool = new Pool({
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    user: username,
    password,
    port: 5432,
    ssl: { rejectUnauthorized: true }, // RDS Proxy presents an ACM (publicly trusted) certificate
    max: 2,                            // one Lambda handles one request at a time; RDS Proxy does the pooling
    idleTimeoutMillis: 60000,
    connectionTimeoutMillis: 5000,
  });
  pool.on('error', () => { poolPromise = undefined; });
  return pool;
}

async function getPool() {
  if (!poolPromise) poolPromise = createPool().catch((e) => { poolPromise = undefined; throw e; });
  return poolPromise;
}

async function query(text, params) {
  const pool = await getPool();
  try {
    return await pool.query(text, params);
  } catch (err) {
    // During a Multi-AZ failover existing connections are dropped: retry once on a fresh connection.
    if (['ECONNRESET', '57P01', '57P03', '08006', '08003'].includes(err.code)) {
      return pool.query(text, params);
    }
    throw err;
  }
}

async function tx(fn) {
  const pool = await getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { query, tx, getPool };
