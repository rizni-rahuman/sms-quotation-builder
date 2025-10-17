// api/save-quote.js
const { Pool } = require('pg');

const connectionString =
  process.env.NEON_DATABASE_URL ||
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  process.env.POSTGRES_URL_NON_POOLING;

const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false }
});

const PREFIX = 'SMS-QUO-';
const PAD = 4;     // 0001, 0002 ...
const COUNTER_PREFIX = 'SMS-QUO'; // row key in quote_counters

function send(res, code, data) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.end(JSON.stringify(data));
}

async function ensureTables(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS quote_counters (
      prefix       text PRIMARY KEY,
      last_number  integer NOT NULL DEFAULT 0,
      updated_at   timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS quotations (
      id            bigserial PRIMARY KEY,
      created_at    timestamptz NOT NULL DEFAULT now(),
      quotation_no  text NOT NULL,
      version       integer NOT NULL DEFAULT 1,
      customer_name text,
      mobile        text,
      amount        numeric,
      title         text,
      signer        text,
      UNIQUE (quotation_no, version)
    );
    CREATE TABLE IF NOT EXISTS quotation_latest (
      quotation_no   text PRIMARY KEY,
      latest_version integer NOT NULL,
      updated_at     timestamptz NOT NULL DEFAULT now()
    );
  `);
}

/** Atomically increments and returns next integer for the given prefix */
async function nextCounter(client, prefixKey) {
  // Ensure row exists then increment in a single transaction
  await client.query(
    `INSERT INTO quote_counters(prefix, last_number)
     VALUES ($1, 0)
     ON CONFLICT (prefix) DO NOTHING`,
    [prefixKey]
  );
  const { rows } = await client.query(
    `UPDATE quote_counters
       SET last_number = last_number + 1, updated_at = now()
     WHERE prefix = $1
     RETURNING last_number`,
    [prefixKey]
  );
  return rows[0].last_number; // integer
}

/** Formats like SMS-QUO-0001 */
function formatQuotationNo(n) {
  return PREFIX + String(n).padStart(PAD, '0');
}

module.exports = async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method not allowed' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  let { qno = '', name = '', mobile = '', amount = '', title = '', signer = '' } = body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await ensureTables(client);

    // If client provided a number like SMS-QUO-0123, bump the counter up to that
  if (qno && qno.trim()) {
    const m = qno.trim().match(/^SMS-QUO-(\d+)$/);
    if (m) {
      const providedN = parseInt(m[1], 10);
      await client.query(
        `INSERT INTO quote_counters(prefix,last_number)
         VALUES ($1, 0)
         ON CONFLICT (prefix) DO NOTHING`,
        [COUNTER_PREFIX]
      );
      await client.query(
        `UPDATE quote_counters
           SET last_number = GREATEST(last_number, $2), updated_at = now()
         WHERE prefix = $1`,
        [COUNTER_PREFIX, providedN]
      );
    }
  }

    // 1) If no qno was sent, generate one from counter
    if (!qno || !qno.trim()) {
      const next = await nextCounter(client, COUNTER_PREFIX);
      qno = formatQuotationNo(next);
    }

    // 2) Compute version: first is 1, then max+1 for same quotation_no
    const { rows: vrows } = await client.query(
      `SELECT COALESCE(MAX(version), 0) + 1 AS next_version
         FROM quotations
        WHERE quotation_no = $1`,
      [qno]
    );
    const version = Number(vrows[0].next_version) || 1;

    // 3) Insert quotation
    const insertSQL = `
      INSERT INTO quotations
        (quotation_no, version, customer_name, mobile, amount, title, signer)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING id, created_at
    `;
    const insertVals = [qno, version, name, mobile, amount, title, signer];
    const { rows } = await client.query(insertSQL, insertVals);

    // 4) Update "latest" tracker
    await client.query(
      `INSERT INTO quotation_latest (quotation_no, latest_version, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (quotation_no)
       DO UPDATE SET latest_version = EXCLUDED.latest_version,
                     updated_at = now()`,
      [qno, version]
    );

    await client.query('COMMIT');
    return send(res, 200, {
      ok: true,
      id: rows[0].id,
      created_at: rows[0].created_at,
      quotation_no: qno,
      version
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    return send(res, 500, { ok: false, error: String(err) });
  } finally {
    client.release();
  }
};
