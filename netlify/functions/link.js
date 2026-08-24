const db = require('./lib/db');
const { verifyTelegramData } = require('./lib/verify');

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return { statusCode: 405, headers: CORS, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    const body = JSON.parse(event.body || '{}');
    const user = verifyTelegramData(body.init_data);
    await db.getOrCreateUser(user.id, user.username, user.first_name);

    const code = (body.code || '').trim();
    if (!code) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Код не передан' }) };
    }

    const { message } = await db.linkFamilies(user.id, code);

    // Формат ответа как в telegram-боте (bot.command('link', ...)): всегда есть message,
    // независимо от того, успех это или ошибка (например «Код не найден»).
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, message }) };
  } catch (e) {
    console.error(e);
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }
};
