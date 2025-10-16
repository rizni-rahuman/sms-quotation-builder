// api/save.js
const { google } = require('googleapis');

function send(res, code, data) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.end(JSON.stringify(data));
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

  if (req.method !== 'POST') {
    return send(res, 405, { ok: false, error: 'Method not allowed' });
  }

  try {
    // ---- SAFE BODY PARSE (handles already-parsed objects too) ----
    let body = {};
    if (req.body) {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    } else if (req.rawBody) {
      body = JSON.parse(req.rawBody.toString());
    } else {
      // fallback for text/plain payloads
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const s = Buffer.concat(chunks).toString('utf8');
      body = s ? JSON.parse(s) : {};
    }

    const {
      qno = '', name = '', mobile = '',
      amount = '', title = '', signer = ''
    } = body;

    // ---- Google auth ----
    const auth = new google.auth.JWT({
      email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    const sheets = google.sheets({ version: 'v4', auth });

    const timestamp = new Date().toISOString();
    const range = `${process.env.SHEET_NAME || 'Quotations'}!A1`;

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.SHEET_ID,
      range,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[timestamp, qno, name, mobile, amount, title, signer]]
      }
    });

    return send(res, 200, { ok: true });
  } catch (err) {
    console.error(err);
    return send(res, 500, { ok: false, error: String(err) });
  }
};
