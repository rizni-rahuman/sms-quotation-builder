// api/peek-quote-no.js
const { Pool } = require('pg');

const connectionString =
  process.env.NEON_DATABASE_URL ||
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  process.env.POSTGRES_URL_NON_POOLING;

const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });

const PREFIX = 'SMS-QUO-';
const PAD = 4;
const COUNTER_PREFIX = 'SMS-QUO';

function send(res, code, data) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(JSON.stringify(data));
}
const fmt = n => PREFIX + String(n).padStart(PAD, '0');

module.exports = async (_req, res) => {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS quote_counters(
        prefix text PRIMARY KEY,
        last_number integer NOT NULL DEFAULT 0,
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    // ensure row exists (but do NOT increment)
    await client.query(
      `INSERT INTO quote_counters(prefix,last_number) VALUES ($1,0)
       ON CONFLICT (prefix) DO NOTHING`,
      [COUNTER_PREFIX]
    );
    const { rows } = await client.query(
      `SELECT last_number FROM quote_counters WHERE prefix=$1`,
      [COUNTER_PREFIX]
    );
    const next = Number(rows[0]?.last_number || 0) + 1;
    send(res, 200, { ok: true, quotation_no: fmt(next) });
  } catch (e) {
    console.error(e);
    send(res, 500, { ok: false, error: String(e) });
  } finally {
    client.release();
  }
};
