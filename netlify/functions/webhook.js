const { Telegraf, Markup } = require('telegraf');
const db = require('./lib/db');

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
    'Добавлять траты можно прямо в чате, например:\n' +
    '<code>-500 продукты</code> — расход 500\n' +
    '<code>+30000 доход зарплата</code> — доход 30000\n\n' +
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

bot.hears(/^[+-]\s?\d/, async (ctx) => {
  const user = ctx.from;
  await db.getOrCreateUser(user.id, user.username, user.first_name);

  const text = ctx.message.text.trim();
  const sign = text[0];
  const rest = text.slice(1).trim();
  const spaceIdx = rest.indexOf(' ');
  const amountStr = spaceIdx === -1 ? rest : rest.slice(0, spaceIdx);
  const comment = spaceIdx === -1 ? '' : rest.slice(spaceIdx + 1).trim();

  const amount = parseFloat(amountStr.replace(',', '.'));
  if (Number.isNaN(amount)) {
    await ctx.reply('Не понял сумму. Пример: -500 продукты');
    return;
  }

  const type = sign === '+' ? 'income' : 'expense';
  let category = 'Прочее';
  for (const cat of db.DEFAULT_CATEGORIES) {
    if (comment.toLowerCase().includes(cat.toLowerCase())) {
      category = cat;
      break;
    }
  }

  await db.addTransaction(user.id, amount, type, category, comment);

  const emoji = type === 'income' ? '📈' : '📉';
  await ctx.reply(`${emoji} Записано: ${Math.round(amount)} ₽ (${category})\n${comment}`);
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
