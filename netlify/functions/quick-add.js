const db = require('./lib/db');
const { classifyText } = require('./lib/classify');

// CORS здесь не критичен для безопасности — это защищено самим секретным ключом, а не origin'ом:
// вызывающая сторона — приложение "Команды" на iPhone, а не веб-страница в браузере.
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
    const key = (body.key || '').trim();
    if (!key) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'key не передан' }) };
    }

    const user = await db.getUserByShortcutKey(key);
    if (!user) {
      return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: 'Неверный ключ доступа' }) };
    }

    // Режим 1: свободный текст — тот же ИИ-разбор, что использует бот ("бananas 200")
    if (body.text) {
      const text = String(body.text).trim();
      if (!text) {
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'text пустой' }) };
      }
      const parsed = await classifyText(text, { expense: db.DEFAULT_CATEGORIES, income: [] }, []);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      const created = [];
      for (const item of list) {
        const amount = Number(item && item.amount);
        if (!amount) continue;
        const type = item.type === 'income' ? 'income' : 'expense';
        const tx = await db.addTransaction(
          user.user_id, amount, type,
          item.category || 'Прочее', item.comment || '', item.account || 'Наличные'
        );
        created.push({ id: tx.id, amount: amount, category: item.category || 'Прочее' });
      }
      if (!created.length) {
        return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Не удалось распознать сумму в тексте' }) };
      }
      return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, created: created }) };
    }

    // Режим 2: структурированные поля — если шорткат сам спрашивает сумму/категорию отдельными шагами
    const amount = Number(body.amount);
    if (!amount || amount <= 0) {
      return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Передайте amount (число) или text (описание операции)' }) };
    }
    const type = body.type === 'income' ? 'income' : 'expense';
    const tx = await db.addTransaction(
      user.user_id, amount, type,
      body.category || 'Прочее', body.comment || '', body.account || 'Наличные'
    );
    return { statusCode: 200, headers: CORS, body: JSON.stringify({ ok: true, id: tx.id }) };
  } catch (e) {
    console.error(e);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }
};
