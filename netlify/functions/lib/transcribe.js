// Распознавание голосовых сообщений Telegram-бота.
// Требует переменную окружения OPENAI_API_KEY (Claude API не принимает аудио на вход,
// поэтому для превращения голоса в текст используется отдельный сервис — OpenAI Whisper).

async function transcribeVoice(buffer) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error(
      'Голосовой ввод через бота не настроен: добавьте переменную окружения OPENAI_API_KEY в Netlify ' +
      '(Project configuration → Environment variables). Ключ можно получить на platform.openai.com.'
    );
  }
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: 'audio/ogg' }), 'voice.ogg');
  form.append('model', 'whisper-1');
  form.append('language', 'ru');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + process.env.OPENAI_API_KEY },
    body: form,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error('Whisper API error ' + res.status + ': ' + t.slice(0, 300));
  }
  const data = await res.json();
  return data.text || '';
}

module.exports = { transcribeVoice };
