// api/save-quote.js
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.POSTGRES_URL, // auto provided by Vercel Postgres
  ssl: { rejectUnauthorized: false }
});

function send(res, code, data) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.end(JSON.stringify(data));
}

async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS quotations (
      id            bigserial PRIMARY KEY,
      created_at    timestamptz NOT NULL DEFAULT now(),
      quotation_no  text,
      customer_name text,
      mobile        text,
      amount        numeric,
      title         text,
      signer        text
    )
  `);
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    return send(res, 405, { ok: false, error: 'Method not allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const { qno = '', name = '', mobile = '', amount = '', title = '', signer = '' } = body;

    await ensureTable();

    const sql = `
      INSERT INTO quotations (quotation_no, customer_name, mobile, amount, title, signer)
      VALUES ($1,$2,$3,$4,$5,$6)
      RETURNING id, created_at
    `;
    const vals = [qno, name, mobile, amount, title, signer];
    const { rows } = await pool.query(sql, vals);

    return send(res, 200, { ok: true, id: rows[0].id, created_at: rows[0].created_at });
  } catch (err) {
    console.error(err);
    return send(res, 500, { ok: false, error: String(err) });
  }
};
