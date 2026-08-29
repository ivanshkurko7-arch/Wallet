const { callClaude, extractJSON } = require('./anthropic');

// Разбирает свободный текст ("купил бананы 200 грн") в структурированную операцию.
async function classifyText(text, categories, accounts) {
  const expenseCats = (categories && categories.expense) || [];
  const incomeCats = (categories && categories.income) || [];
  const accs = accounts || [];

  const system =
    'Ты помощник для учёта личных финансов. Пользователь присылает короткое описание операции на русском или ' +
    'украинском языке (например: "бананы 200", "купил картошку 150 грн", "получил зарплату 30000"). ' +
    'Определи: тип операции (expense — расход, income — доход; если не уверен — expense), ' +
    'сумму (только число, без валюты), наиболее подходящую категорию из списка ниже, и краткий комментарий ' +
    '(что купили или за что доход, 2-4 слова).\n\n' +
    'Категории расходов: ' + (expenseCats.join(', ') || 'Прочее') + '.\n' +
    'Категории доходов: ' + (incomeCats.join(', ') || 'Прочие доходы') + '.\n' +
    (accs.length ? ('Счета: ' + accs.join(', ') + '. Если счёт явно не упомянут в тексте — верни account: null.\n') : '') +
    '\nОтвечай СТРОГО в формате JSON без каких-либо пояснений и без markdown-разметки:\n' +
    '{"type":"expense" | "income","amount":число,"category":"название строго из списка выше","account":"название из списка или null","comment":"краткое описание"}\n' +
    'Если ни одна категория явно не подходит — используй последнюю в соответствующем списке (обычно это "Прочее" / "Прочие доходы"). ' +
    'Если сумму определить не удалось — верни amount: null.';

  const raw = await callClaude({
    system: system,
    messages: [{ role: 'user', content: text }],
    maxTokens: 300,
  });
  return extractJSON(raw);
}

module.exports = { classifyText };
