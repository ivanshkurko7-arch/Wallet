const { verifyTelegramData } = require('./lib/verify');
const { classifyReceipt } = require('./lib/receipt');

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
    verifyTelegramData(body.init_data);

    if (!body.image) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'image не передан' }) };
    }

    const items = await classifyReceipt(body.image, body.media_type, body.categories || {});
    return { statusCode: 200, headers: CORS, body: JSON.stringify(items) };
  } catch (e) {
    console.error(e);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }
};
