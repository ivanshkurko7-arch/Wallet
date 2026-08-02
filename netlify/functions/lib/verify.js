const crypto = require('crypto');

function verifyTelegramData(initData) {
  if (!initData) throw new Error('No init data');

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) throw new Error('No hash in init data');
  params.delete('hash');

  const entries = [...params.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData')
    .update(process.env.BOT_TOKEN)
    .digest();

  const calculatedHash = crypto.createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  if (calculatedHash !== hash) {
    throw new Error('Invalid Telegram data');
  }

  const userRaw = params.get('user');
  if (!userRaw) throw new Error('No user in init data');
  return JSON.parse(userRaw);
}

module.exports = { verifyTelegramData };
