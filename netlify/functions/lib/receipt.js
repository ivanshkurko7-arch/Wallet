const { callClaude, extractJSON } = require('./anthropic');

// Разбирает фото чека на список трат по категориям.
async function classifyReceipt(imageBase64, mediaType, categories) {
  const expenseCats = (categories && categories.expense) || [];

  const system =
    'Ты помощник для учёта личных финансов. На фото — чек из магазина или скриншот оплаты. ' +
    'Разбери все товарные позиции и сгруппируй их по категориям расходов из этого списка: ' +
    (expenseCats.join(', ') || 'Прочее') + '.\n' +
    'Если все товары одной категории (например, только продукты) — верни один элемент с общей суммой чека. ' +
    'Если товары явно из разных категорий (например, в одном чеке бытовая техника и продукты) — раздели чек на ' +
    'несколько элементов, по одному на категорию, с их частичными суммами.\n' +
    'Сумма — это реально уплаченная сумма (с учётом скидок), только число, без валюты.\n\n' +
    'Отвечай СТРОГО в виде JSON-массива без пояснений и без markdown-разметки:\n' +
    '[{"category":"название строго из списка выше","amount":число,"comment":"кратко что за товары"}]\n' +
    'Если изображение не читается или это не чек/платёж — верни пустой массив [].';

  const raw = await callClaude({
    system: system,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: imageBase64 } },
        { type: 'text', text: 'Разбери этот чек по категориям расходов.' },
      ],
    }],
    maxTokens: 700,
  });
  const result = extractJSON(raw);
  return Array.isArray(result) ? result : [];
}

module.exports = { classifyReceipt };
