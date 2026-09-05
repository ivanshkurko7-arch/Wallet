const db = require('./lib/db');
const { verifyTelegramData } = require('./lib/verify');

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': 'https://wa1et.netlify.app',
};

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
    }
    const body = JSON.parse(event.body || '{}');
    const user = verifyTelegramData(body.init_data);
    await db.getOrCreateUser(user.id, user.username, user.first_name);

    const key = (body.key || '').trim();
    if (!key) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'key не передан' }) };
    }

    await db.setShortcutKey(user.id, key);
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    console.error(e);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }
};
