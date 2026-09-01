const { callClaude, extractJSON } = require('./anthropic');

// Разбирает фото чека на список трат по категориям и сверяет сумму позиций с напечатанным итогом.
// Возвращает { items, total, needsReview }:
//   items       — массив [{category, amount, comment}]
//   total       — итоговая сумма, распознанная с чека (или null, если не удалось прочитать)
//   needsReview — true, если сумма позиций заметно (>1%) расходится с напечатанным итогом —
//                 значит, где-то вероятна ошибка распознавания и результат стоит перепроверить вручную.
async function classifyReceipt(imageBase64, mediaType, categories) {
  if (typeof imageBase64 !== 'string' || !imageBase64) {
    throw new Error('Изображение не передано');
  }
  const approxBytes = Math.floor(imageBase64.length * 3 / 4);
  const MAX_BYTES = 5 * 1024 * 1024; // 5 МБ — с запасом достаточно для фото чека в норм. качестве
  if (approxBytes > MAX_BYTES) {
    throw new Error('Изображение слишком большое (максимум 5 МБ). Сфотографируйте в меньшем разрешении.');
  }

  const expenseCats = (categories && categories.expense) || [];

  const system =
    'Ты помощник для учёта личных финансов. На фото — чек из магазина или скриншот оплаты.\n\n' +
    'КРИТИЧЕСКИ ВАЖНО про сумму:\n' +
    'На чеке ВСЕГДА есть итоговая строка с готовой суммой — она подписана как "СУМА", "ИТОГО", "ВСЬОГО", ' +
    '"К ОПЛАТЕ", "TOTAL" или похоже, и обычно стоит после списка товаров, перед способом оплаты. ' +
    'Считывай именно ЭТУ печатную сумму как источник истины — цифра за цифрой, очень внимательно, ' +
    'не путай запятую/точку и не пропускай последнюю цифру.\n\n' +
    'Разбери товарные позиции и сгруппируй их по категориям расходов из этого списка: ' +
    (expenseCats.join(', ') || 'Прочее') + '.\n' +
    'Если все товары одной категории (например, только продукты) — верни один элемент с этой итоговой суммой.\n' +
    'Если товары явно из разных категорий — раздели чек на несколько элементов по категориям, сложив стоимость ' +
    'позиций внутри каждой категории по ценам, напечатанным рядом с каждой позицией (не на глаз).\n\n' +
    'Отвечай СТРОГО в виде JSON-ОБЪЕКТА без пояснений и без markdown-разметки:\n' +
    '{"total": число_с_чека_или_null, "items": [{"category":"название строго из списка выше","amount":число,"comment":"кратко что за товары"}]}\n' +
    'Поле "total" — это ИМЕННО напечатанная на чеке итоговая сумма, а не сумма items (даже если они должны совпадать). ' +
    'Если изображение не читается или это не чек/платёж — верни {"total": null, "items": []}.';

  const raw = await callClaude({
    system: system,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: imageBase64 } },
        { type: 'text', text: 'Разбери этот чек по категориям расходов. Сумму бери строго из напечатанной итоговой строки чека.' },
      ],
    }],
    maxTokens: 700,
  });

  const parsed = extractJSON(raw);
  const items = Array.isArray(parsed && parsed.items) ? parsed.items : (Array.isArray(parsed) ? parsed : []);
  const total = (parsed && typeof parsed.total === 'number') ? parsed.total : null;

  const itemsSum = items.reduce(function (s, it) { return s + (Number(it && it.amount) || 0); }, 0);
  let needsReview = false;
  if (total != null && itemsSum > 0) {
    const diff = Math.abs(itemsSum - total);
    const tolerance = Math.max(1, total * 0.01); // 1% или минимум 1 единица валюты
    needsReview = diff > tolerance;
  }

  return { items: items, total: total, needsReview: needsReview };
}

module.exports = { classifyReceipt };
