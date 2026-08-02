const db = require('./lib/db');
const { verifyTelegramData } = require('./lib/verify');

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
};

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const user = verifyTelegramData(body.init_data);

      await db.getOrCreateUser(user.id, user.username, user.first_name);

      if (!['expense', 'income'].includes(body.type)) {
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'type must be expense or income' }) };
      }

      await db.addTransaction(user.id, Number(body.amount), body.type, body.category, body.comment || '');
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true }) };
    }

    // GET — список операций
    const initData = (event.queryStringParameters && event.queryStringParameters.init_data) || '';
    const limit = parseInt((event.queryStringParameters && event.queryStringParameters.limit) || '50', 10);
    const user = verifyTelegramData(initData);

    const familyId = await db.getFamilyId(user.id);
    if (!familyId) {
      return { statusCode: 200, headers: CORS, body: JSON.stringify([]) };
    }

    const txs = await db.getTransactions(familyId, limit);
    return { statusCode: 200, headers: CORS, body: JSON.stringify(txs) };
  } catch (e) {
    console.error(e);
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }
};
