const BOT_TOKEN = process.env.BOT_TOKEN;

async function sendTelegramMessage(chatId, text) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      console.error('Telegram sendMessage failed:', errText);
    }
  } catch (e) {
    console.error('Telegram sendMessage error:', e);
  }
}

async function notifyFamily(members, text, excludeUserId = null) {
  const targets = members.filter((m) => m.user_id !== excludeUserId);
  await Promise.all(targets.map((m) => sendTelegramMessage(m.user_id, text)));
}

module.exports = { sendTelegramMessage, notifyFamily };
