const db = require('./lib/db');
const { verifyTelegramData } = require('./lib/verify');

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': 'https://wa1et.netlify.app',
};

function json(status, body) { return { statusCode: status, headers: CORS, body: JSON.stringify(body) }; }

// Администраторы — Telegram ID из переменной окружения ADMIN_USER_ID (через запятую).
// Проверка всегда на сервере: даже если открыть этот адрес вручную, без прав данные не отдаются.
function isAdmin(userId) {
  const ids = (process.env.ADMIN_USER_ID || '').split(',').map((s) => s.trim()).filter(Boolean);
  return ids.includes(String(userId));
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      const user = verifyTelegramData(body.init_data);
      if (!isAdmin(user.id)) return json(403, { error: 'Нет доступа' });

      if (body.action === 'set_plan') {
        const target = Number(body.user_id);
        if (!Number.isFinite(target)) return json(400, { error: 'user_id не передан' });
        if (!['free', 'pro'].includes(body.plan)) return json(400, { error: 'Неизвестный тариф' });
        const days = body.days == null ? null : Number(body.days);
        if (days != null && (!Number.isFinite(days) || days <= 0 || days > 3650)) {
          return json(400, { error: 'Некорректный срок' });
        }
        const result = await db.setUserPlan(target, body.plan, days);
        return json(200, { ok: true, result: result });
      }
      return json(400, { error: 'Неизвестное действие' });
    }

    // GET — сводка
    const qp = event.queryStringParameters || {};
    const user = verifyTelegramData(qp.init_data || '');
    if (!isAdmin(user.id)) return json(403, { error: 'Нет доступа' });
    const stats = await db.getAdminStats();
    return json(200, stats);
  } catch (e) {
    console.error(e);
    // Ошибка проверки Telegram-подписи — 401, остальное — 500
    const status = /init data|hash|auth/i.test(e.message || '') ? 401 : 500;
    return json(status, { error: e.message });
  }
};
