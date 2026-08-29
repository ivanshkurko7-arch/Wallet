const { Telegraf, Markup } = require('telegraf');
const db = require('./lib/db');
const { classifyText } = require('./lib/classify');
const { classifyReceipt } = require('./lib/receipt');
const { transcribeVoice } = require('./lib/transcribe');

const bot = new Telegraf(process.env.BOT_TOKEN);
const WEBAPP_URL = process.env.WEBAPP_URL;

function mainKeyboard() {
  return Markup.inlineKeyboard([
    Markup.button.webApp('💰 Открыть кошелёк', WEBAPP_URL),
  ]);
}

bot.start(async (ctx) => {
  const user = ctx.from;
  await db.getOrCreateUser(user.id, user.username, user.first_name);
  const code = await db.getInviteCode(user.id);
  const text =
    `Привет, ${user.first_name}! 👋\n\n` +
    'Это бот для учёта общих трат и доходов.\n\n' +
    `Ваш код приглашения: <b>${code}</b>\n` +
    'Отправьте его партнёру — пусть введёт в боте команду:\n' +
    `<code>/link ${code}</code>\n` +
    'чтобы у вас стал общий бюджет.\n\n' +
    'Добавлять траты можно прямо в чате:\n' +
    '• Просто напишите: <code>купил бananas 200</code> или <code>-500 продукты</code>\n' +
    '• Пришлите фото чека — разложу по категориям автоматически\n' +
    '• Отправьте голосовое сообщение — распознаю и запишу\n\n' +
    'Или откройте приложение кнопкой ниже 👇';
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

// Сохраняет распознанную ИИ операцию и отвечает пользователю подтверждением.
async function saveAndReply(ctx, user, parsed) {
  const amount = Number(parsed && parsed.amount);
  if (!parsed || !amount || Number.isNaN(amount)) {
    await ctx.reply('Не понял сумму. Попробуй ещё раз, например: -500 продукты');
    return;
  }
  const type = parsed.type === 'income' ? 'income' : 'expense';
  const category = parsed.category || 'Прочее';
  const comment = parsed.comment || '';
  const account = parsed.account || 'Наличные';
  await db.addTransaction(user.id, amount, type, category, comment, account);
  const emoji = type === 'income' ? '📈' : '📉';
  const sign = type === 'income' ? '+' : '−';
  await ctx.reply(`${emoji} Записано: ${sign}${Math.round(amount)} ₴ · ${category}${comment ? ' · ' + comment : ''}`);
}

// Быстрый ввод с явным знаком: "-500 продукты" / "+30000 зарплата"
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

// Свободный текст без знака: "купил бananas 200", "заплатил за такси 150"
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
    if (!parsed || !parsed.amount) return; // ИИ решил, что это не про деньги — молча пропускаем
    await saveAndReply(ctx, user, parsed);
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

    const items = await classifyReceipt(base64, 'image/jpeg', { expense: db.DEFAULT_CATEGORIES });
    if (!items.length) {
      await ctx.reply('Не получилось распознать чек. Попробуй сфотографировать более чётко и целиком.');
      return;
    }
    let replyText = '🧾 Записал по чеку:\n';
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
