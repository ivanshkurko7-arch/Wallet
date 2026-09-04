const db = require('./lib/db');
const { verifyTelegramData } = require('./lib/verify');
const { notifyFamily } = require('./lib/notify');

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': 'https://wa1et.netlify.app',
};

function fmt(n) {
  return new Intl.NumberFormat('uk-UA').format(Math.round(n));
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const user = verifyTelegramData(body.init_data);
      await db.getOrCreateUser(user.id, user.username, user.first_name);
      if (!['expense', 'income'].includes(body.type)) {
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'type must be expense or income' }) };
      }
      const tx = await db.addTransaction(
        user.id,
        Number(body.amount),
        body.type,
        body.category,
        body.comment || '',
        body.account || 'Наличные',
        body.created_at
      );
      // Уведомляем всех участников семьи о новой операции
      const familyId = await db.getFamilyId(user.id);
      const members = await db.getFamilyMembers(familyId);
      const emoji = body.type === 'expense' ? '📉' : '📈';
      const sign = body.type === 'expense' ? '−' : '+';
      const name = user.first_name || user.username || 'Кто-то';
      const text =
        `${emoji} <b>${name}</b> добавил(а): ${sign}${fmt(body.amount)} ₴\n` +
        `${body.category} · ${body.account || 'Наличные'}` +
        (body.comment ? `\n${body.comment}` : '');
      await notifyFamily(members, text, user.id);
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, id: tx.id }) };
    }

    if (event.httpMethod === 'PATCH') {
      const body = JSON.parse(event.body || '{}');
      const user = verifyTelegramData(body.init_data);
      if (body.id === undefined || body.id === null) {
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'id операции не передан' }) };
      }
      if (body.type !== undefined && !['expense', 'income'].includes(body.type)) {
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'type must be expense or income' }) };
      }
      const updated = await db.updateTransaction(user.id, body.id, {
        amount: body.amount,
        type: body.type,
        category: body.category,
        comment: body.comment,
        account: body.account,
        created_at: body.created_at,
      });

      // Уведомляем участников семьи об изменении операции
      const familyId = await db.getFamilyId(user.id);
      const members = await db.getFamilyMembers(familyId);
      const emoji = updated.type === 'expense' ? '📉' : '📈';
      const sign = updated.type === 'expense' ? '−' : '+';
      const name = user.first_name || user.username || 'Кто-то';
      const text =
        `✏️ <b>${name}</b> изменил(а) операцию: ${sign}${fmt(updated.amount)} ₴\n` +
        `${updated.category} · ${updated.account || 'Наличные'}`;
      await notifyFamily(members, text, user.id);

      return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, id: updated.id }) };
    }

    if (event.httpMethod === 'DELETE') {
      const body = JSON.parse(event.body || '{}');
      const user = verifyTelegramData(body.init_data);
      if (body.id === undefined || body.id === null) {
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'id операции не передан' }) };
      }
      const deleted = await db.deleteTransaction(user.id, body.id);
      const familyId = await db.getFamilyId(user.id);
      const members = await db.getFamilyMembers(familyId);
      const name = user.first_name || user.username || 'Кто-то';
      const sign = deleted.type === 'expense' ? '−' : '+';
      const text =
        `🗑 <b>${name}</b> удалил(а) операцию: ${sign}${fmt(deleted.amount)} ₴ (${deleted.category})`;
      await notifyFamily(members, text, user.id);
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true }) };
    }

    // GET — список операций, с опциональным фильтром по периоду (start/end — unix-секунды)
    const qp = event.queryStringParameters || {};
    const initData = qp.init_data || '';
    const limit = parseInt(qp.limit || '50', 10);
    const start = qp.start !== undefined ? Number(qp.start) : undefined;
    const end = qp.end !== undefined ? Number(qp.end) : undefined;
    const user = verifyTelegramData(initData);
    const familyId = await db.getFamilyId(user.id);
    if (!familyId) {
      return { statusCode: 200, headers: CORS, body: JSON.stringify([]) };
    }
    const txs = await db.getTransactions(familyId, limit, start, end);
    return { statusCode: 200, headers: CORS, body: JSON.stringify(txs) };
  } catch (e) {
    console.error(e);
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }
};
