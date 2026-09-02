// Ежедневное напоминание в 20:00 (Europe/Kiev) всем пользователям бота — записать траты за день.
// Расписание задаётся в netlify.toml ([functions."reminder-cron"] schedule = "0 17 * * *").
// Работает напрямую через Supabase REST API — без зависимости от lib/db.js.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL;

async function getAllUserIds() {
  const res = await fetch(SUPABASE_URL + '/rest/v1/users?select=user_id', {
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: 'Bearer ' + SUPABASE_SERVICE_KEY,
    },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error('Supabase error ' + res.status + ': ' + t.slice(0, 300));
  }
  const rows = await res.json();
  return rows.map(function (r) { return r.user_id; });
}

async function sendReminder(userId) {
  const text =
    '🌙 Вечер — самое время записать сегодняшние траты!\n\n' +
    'Не дай мелким покупкам потеряться. Открой Wallet и добавь операции за день — это займёт меньше минуты.';
  const body = {
    chat_id: userId,
    text: text,
    reply_markup: {
      inline_keyboard: [[{ text: '💰 Открыть Wallet', web_app: { url: WEBAPP_URL } }]],
    },
  };
  const res = await fetch('https://api.telegram.org/bot' + BOT_TOKEN + '/sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    // Не бросаем ошибку дальше — один "заблокировавший бота" пользователь не должен ломать рассылку остальным.
    console.error('Не удалось отправить напоминание ' + userId + ': ' + res.status + ' ' + t.slice(0, 200));
    return false;
  }
  return true;
}

exports.handler = async () => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !BOT_TOKEN || !WEBAPP_URL) {
    console.error('Не настроены переменные окружения для reminder-cron');
    return { statusCode: 500, body: 'Missing env vars' };
  }
  try {
    const userIds = await getAllUserIds();
    let sent = 0;
    for (const userId of userIds) {
      const ok = await sendReminder(userId);
      if (ok) sent++;
    }
    console.log(`Напоминание отправлено ${sent} из ${userIds.length} пользователей`);
    return { statusCode: 200, body: JSON.stringify({ ok: true, sent: sent, total: userIds.length }) };
  } catch (e) {
    console.error(e);
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
