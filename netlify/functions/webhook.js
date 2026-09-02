const { Telegraf, Markup } = require('telegraf');
const db = require('./lib/db');
const { classifyText } = require('./lib/classify');
const { classifyReceipt } = require('./lib/receipt');
const { transcribeVoice } = require('./lib/transcribe');

const bot = new Telegraf(process.env.BOT_TOKEN);
const WEBAPP_URL = process.env.WEBAPP_URL;

function mainKeyboard() {
  return Markup.keyboard([
    Markup.button.webApp('💰 Открыть Wallet', WEBAPP_URL),
  ]).resize();
}

bot.start(async (ctx) => {
  const user = ctx.from;
  await db.getOrCreateUser(user.id, user.username, user.first_name);
  const code = await db.getInviteCode(user.id);
  const text =
    `💜 Добро пожаловать в <b>Wallet</b>, ${user.first_name}!\n\n` +
    'Я помогу вести семейный бюджет без лишней возни: записывай траты и доходы прямо в чате, ' +
    'сканируй чеки, диктуй голосом — сам всё разберу и разложу по категориям.\n\n' +
    `🔑 Твой код приглашения: <b>${code}</b>\n` +
    'Отправь его партнёру — пусть введёт в боте команду:\n' +
    `<code>/link ${code}</code>\n` +
    'чтобы бюджет стал общим.\n\n' +
    '<b>Как пользоваться:</b>\n' +
    '• Просто напиши: <code>купил хлеб 50</code>\n' +
    '• Пришли фото чека — разложу по категориям сам\n' +
    '• Надиктуй голосом — распознаю и запишу\n\n' +
    'Открывай приложение кнопкой снизу 👇';
  await ctx.reply(text, { parse_mode: 'HTML', ...mainKeyboard() });
});

bot.command('code', async (ctx) => {
  const code = await db.getInviteCode(ctx.from.id);
  if (!code) {
    await ctx.reply('Сначала отправьте /start');
    return;
  }
  await ctx.reply(
    `Ваш код приглашения: <b>${code}</b>\nПартнёр должен ввести: <code>/link ${code}</code>`,
    { parse_mode: 'HTML' }
  );
});

bot.command('link', async (ctx) => {
  const user = ctx.from;
  await db.getOrCreateUser(user.id, user.username, user.first_name);
  const args = ctx.message.text.split(' ').slice(1).join(' ').trim();
  if (!args) {
    await ctx.reply('Использование: /link КОД\nКод можно узнать у партнёра командой /code');
    return;
  }
  const { message } = await db.linkFamilies(user.id, args);
  await ctx.reply(message);
});

bot.command('app', async (ctx) => {
  await ctx.reply('Открыть кошелёк:', mainKeyboard());
});

// Показывает ваш Telegram ID — нужен один раз, чтобы настроить ADMIN_USER_ID и получить доступ к /users
bot.command('whoami', async (ctx) => {
  const u = ctx.from;
  await ctx.reply(
    `Твой Telegram ID: <code>${u.id}</code>\n` +
    `Имя: ${u.first_name || '—'}\n` +
    `Username: ${u.username ? '@' + u.username : '—'}\n\n` +
    'Чтобы получить доступ к команде /users, добавь этот ID как переменную окружения ADMIN_USER_ID в Netlify.',
    { parse_mode: 'HTML' }
  );
});

// Список всех пользователей бота — доступно только владельцу (ADMIN_USER_ID)
bot.command('users', async (ctx) => {
  const adminIds = (process.env.ADMIN_USER_ID || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  if (!adminIds.includes(String(ctx.from.id))) {
    return; // молча игнорируем — не палим, что команда вообще существует
  }
  try {
    const [usersRes, familiesRes] = await Promise.all([
      fetch(process.env.SUPABASE_URL + '/rest/v1/users?select=user_id,username,first_name,family_id&order=user_id.asc', {
        headers: { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_KEY },
      }),
      fetch(process.env.SUPABASE_URL + '/rest/v1/families?select=id,invite_code', {
        headers: { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: 'Bearer ' + process.env.SUPABASE_SERVICE_KEY },
      }),
    ]);
    if (!usersRes.ok || !familiesRes.ok) {
      await ctx.reply('Не получилось получить список пользователей из базы.');
      return;
    }
    const users = await usersRes.json();
    const families = await familiesRes.json();

    let text = `👥 <b>Пользователи бота (${users.length})</b>\n👪 Семей: ${families.length}\n\n`;
    users.forEach(function (u, i) {
      const name = u.first_name || 'Без имени';
      const uname = u.username ? '@' + u.username : '—';
      text += `${i + 1}. ${name} (${uname}) — id <code>${u.user_id}</code> · семья #${u.family_id}\n`;
    });

    // Telegram режет сообщения длиннее ~4096 символов — на всякий случай режем на части
    const CHUNK = 3800;
    for (let i = 0; i < text.length; i += CHUNK) {
      await ctx.reply(text.slice(i, i + CHUNK), { parse_mode: 'HTML' });
    }
  } catch (e) {
    console.error(e);
    await ctx.reply('Ошибка при получении списка: ' + e.message);
  }
});

// Сохраняет одну распознанную операцию, возвращает строку для отчёта или null, если сумма не распознана.
async function saveOneTransaction(user, parsed) {
  const amount = Number(parsed && parsed.amount);
  if (!parsed || !amount || Number.isNaN(amount)) return null;
  const type = parsed.type === 'income' ? 'income' : 'expense';
  const category = parsed.category || 'Прочее';
  const comment = parsed.comment || '';
  const account = parsed.account || 'Наличные';
  await db.addTransaction(user.id, amount, type, category, comment, account);
  const emoji = type === 'income' ? '📈' : '📉';
  const sign = type === 'income' ? '+' : '−';
  return `${emoji} ${sign}${Math.round(amount)} ₴ · ${category}${comment ? ' · ' + comment : ''}`;
}

// Сохраняет одну или несколько операций (parsed — массив или один объект) и отвечает итогом.
async function saveAndReply(ctx, user, parsed) {
  const list = Array.isArray(parsed) ? parsed : [parsed];
  const lines = [];
  for (const item of list) {
    const line = await saveOneTransaction(user, item);
    if (line) lines.push(line);
  }
  if (!lines.length) {
    await ctx.reply('Не понял сумму. Попробуй ещё раз, например: -500 продукты');
    return;
  }
  const header = lines.length > 1 ? `Записал ${lines.length} операции:\n` : 'Записано: ';
  await ctx.reply(header + lines.join('\n'));
}

// Быстрый ввод с явным знаком: "-500 продукты" / "+30000 зарплата".
// Можно перечислить несколько через запятую: "-200 картошка, -3422 лекарства, -450 такси"
bot.hears(/^[+-]\s?\d/, async (ctx) => {
  const user = ctx.from;
  await db.getOrCreateUser(user.id, user.username, user.first_name);
  try {
    const parsed = await classifyText(
      ctx.message.text.trim(),
      { expense: db.DEFAULT_CATEGORIES, income: [] },
      []
    );
    await saveAndReply(ctx, user, parsed);
  } catch (e) {
    console.error(e);
    await ctx.reply('Не получилось разобрать сообщение: ' + e.message);
  }
});

// Свободный текст без знака: "купил бananas 200", "картошка 200, лекарства 3422, такси 450"
// Реагируем только если в сообщении вообще есть цифры — иначе это обычная переписка, не трата.
bot.on('text', async (ctx) => {
  const text = (ctx.message.text || '').trim();
  if (!text || text.startsWith('/')) return;
  if (/^[+-]\s?\d/.test(text)) return; // уже обработано выше
  if (!/\d/.test(text)) return; // нет суммы — не похоже на операцию, не тратим вызов ИИ

  const user = ctx.from;
  await db.getOrCreateUser(user.id, user.username, user.first_name);
  try {
    const parsed = await classifyText(text, { expense: db.DEFAULT_CATEGORIES, income: [] }, []);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    const hasAmount = list.some(function (it) { return it && it.amount; });
    if (!hasAmount) return; // ИИ решил, что это не про деньги — молча пропускаем
    await saveAndReply(ctx, user, list);
  } catch (e) {
    console.error(e);
    // Намеренно не отвечаем ошибкой на обычные сообщения, чтобы не мешать переписке
  }
});

// Фото чека — распознаём и раскладываем по категориям
bot.on('photo', async (ctx) => {
  const user = ctx.from;
  await db.getOrCreateUser(user.id, user.username, user.first_name);
  try {
    const wait = await ctx.reply('🧾 Читаю чек…');
    const photos = ctx.message.photo;
    const fileId = photos[photos.length - 1].file_id; // самое большое доступное разрешение
    const fileUrl = await ctx.telegram.getFileLink(fileId);
    const imgRes = await fetch(fileUrl.href || fileUrl.toString());
    const buf = Buffer.from(await imgRes.arrayBuffer());
    const base64 = buf.toString('base64');

    const result = await classifyReceipt(base64, 'image/jpeg', { expense: db.DEFAULT_CATEGORIES });
    const items = result.items || [];
    if (!items.length) {
      await ctx.reply('Не получилось распознать чек. Попробуй сфотографировать более чётко и целиком.');
      return;
    }
    let replyText = result.needsReview
      ? '⚠️ Сумма позиций не совпадает с итогом чека' + (result.total != null ? ` (на чеке: ${Math.round(result.total)} ₴)` : '') + ' — проверь записи ниже и поправь при необходимости.\n\n🧾 Записал по чеку:\n'
      : '🧾 Записал по чеку:\n';
    for (const item of items) {
      const amount = Number(item.amount);
      if (!amount) continue;
      await db.addTransaction(user.id, amount, 'expense', item.category || 'Прочее', item.comment || '', 'Наличные');
      replyText += `−${Math.round(amount)} ₴ · ${item.category}${item.comment ? ' · ' + item.comment : ''}\n`;
    }
    await ctx.reply(replyText);
    try { await ctx.deleteMessage(wait.message_id); } catch (e2) { /* не критично */ }
  } catch (e) {
    console.error(e);
    await ctx.reply('Не получилось обработать чек: ' + e.message);
  }
});

// Голосовое сообщение — распознаём речь и записываем операцию
bot.on('voice', async (ctx) => {
  const user = ctx.from;
  await db.getOrCreateUser(user.id, user.username, user.first_name);
  try {
    await ctx.reply('🎤 Слушаю…');
    const fileUrl = await ctx.telegram.getFileLink(ctx.message.voice.file_id);
    const audioRes = await fetch(fileUrl.href || fileUrl.toString());
    const buf = Buffer.from(await audioRes.arrayBuffer());
    const text = await transcribeVoice(buf);
    if (!text || !text.trim()) {
      await ctx.reply('Не расслышал. Попробуй ещё раз чуть громче и чётче.');
      return;
    }
    const parsed = await classifyText(text, { expense: db.DEFAULT_CATEGORIES, income: [] }, []);
    await saveAndReply(ctx, user, parsed);
  } catch (e) {
    console.error(e);
    await ctx.reply('Не получилось обработать голосовое: ' + e.message);
  }
});

exports.handler = async (event) => {
  try {
    const update = JSON.parse(event.body);
    await bot.handleUpdate(update);
  } catch (e) {
    console.error('Webhook error:', e);
  }
  // Telegram ждёт 200, иначе будет повторять доставку
  return { statusCode: 200, body: '' };
};
