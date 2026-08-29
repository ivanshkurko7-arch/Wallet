const { verifyTelegramData } = require('./lib/verify');
const { classifyText } = require('./lib/classify');

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
    verifyTelegramData(body.init_data); // подтверждаем, что запрос от авторизованного пользователя Telegram

    const text = (body.text || '').trim();
    if (!text) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'text не передан' }) };
    }

    const result = await classifyText(text, body.categories || {}, body.accounts || []);
    return { statusCode: 200, headers: CORS, body: JSON.stringify(result) };
  } catch (e) {
    console.error(e);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }
};
