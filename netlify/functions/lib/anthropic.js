// Общий помощник для вызова Anthropic API (Claude) из Netlify Functions.
// Требует переменную окружения ANTHROPIC_API_KEY (Netlify → Project configuration → Environment variables).

const MODEL = 'claude-haiku-4-5-20251001'; // быстрая и дешёвая модель — достаточно для категоризации

async function callClaude({ system, messages, maxTokens }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY не настроен на сервере');
  }
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens || 1024,
      system: system,
      messages: messages,
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error('Anthropic API error ' + res.status + ': ' + errText.slice(0, 300));
  }
  const data = await res.json();
  const textBlock = (data.content || []).find(function (b) { return b.type === 'text'; });
  return textBlock ? textBlock.text : '';
}

function extractJSON(text) {
  const cleaned = String(text).replace(/```json/gi, '').replace(/```/g, '').trim();
  return JSON.parse(cleaned);
}

module.exports = { callClaude, extractJSON };
