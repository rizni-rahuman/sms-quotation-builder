// api/list-quotes.js
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false }
});

function send(res, code, data) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.end(JSON.stringify(data));
}

module.exports = async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, created_at, quotation_no, customer_name, mobile, amount, title, signer
       FROM quotations
       ORDER BY created_at DESC
       LIMIT 100`
    );
    return send(res, 200, { ok: true, rows });
  } catch (err) {
    console.error(err);
    return send(res, 500, { ok: false, error: String(err) });
  }
};
