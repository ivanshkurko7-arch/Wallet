# Семейный бюджет — Telegram-бот + Mini App (Netlify + Supabase)

Версия проекта под **Netlify** (serverless-функции) с базой данных на **Supabase** (бесплатный Postgres в облаке).
Работает 24/7, ничего не нужно держать включённым у себя.

## Структура
- `netlify/functions/webhook.js` — бот (принимает сообщения от Telegram через webhook)
- `netlify/functions/summary.js` — API: баланс, категории, участники
- `netlify/functions/transactions.js` — API: список операций / добавление новой
- `netlify/functions/lib/db.js` — работа с базой (Supabase)
- `netlify/functions/lib/verify.js` — проверка подписи данных из Mini App
- `public/index.html` — интерфейс приложения
- `supabase_schema.sql` — SQL для создания таблиц

## Шаг 1. База данных (Supabase)
1. Зарегистрируйтесь на https://supabase.com (бесплатно)
2. **New project** → придумайте название и пароль → дождитесь создания (1-2 минуты)
3. Слева **SQL Editor → New query** → вставьте содержимое файла `supabase_schema.sql` → **Run**
4. Слева **Project Settings → Data API** — скопируйте:
   - **Project URL** → это будет `SUPABASE_URL`
5. Там же **Project Settings → API Keys** — скопируйте:
   - **service_role** ключ (не anon!) → это будет `SUPABASE_SERVICE_KEY`
   ⚠️ Это секретный ключ с полным доступом, никому не показывайте и не кладите в публичный код.

## Шаг 2. Бот в Telegram
1. Напишите **@BotFather** → `/newbot` → задайте имя и username
2. Скопируйте токен вида `123456789:AAExxxxx...` → это `BOT_TOKEN`

## Шаг 3. Деплой на Netlify
1. Залейте эту папку к себе на GitHub (новый репозиторий)
2. На https://netlify.com: **Add new site → Import an existing project** → выберите репозиторий
3. Netlify сам подхватит настройки из `netlify.toml`. Жмите **Deploy**
4. После первого деплоя скопируйте адрес сайта, например `https://your-app.netlify.app`
5. **Site configuration → Environment variables** → добавьте:
   - `BOT_TOKEN` = токен из BotFather
   - `SUPABASE_URL` = из шага 1
   - `SUPABASE_SERVICE_KEY` = из шага 1
   - `WEBAPP_URL` = `https://your-app.netlify.app` (адрес вашего сайта, без слэша на конце)
6. **Deploys → Trigger deploy** — пересоберите сайт, чтобы переменные подхватились

## Шаг 4. Подключить webhook бота
Telegram должен знать, куда слать сообщения. Выполните (замените TOKEN и адрес сайта):

```bash
curl "https://api.telegram.org/botTOKEN/setWebhook?url=https://your-app.netlify.app/webhook"
```

Должно вернуться `{"ok":true,"result":true,...}`. Можно выполнить эту команду в терминале компьютера,
или просто открыть эту ссылку в браузере, подставив свои значения.

## Шаг 5. Кнопка меню (необязательно)
В @BotFather: `/mybots` → ваш бот → **Bot Settings → Menu Button** → укажите `https://your-app.netlify.app`

## Шаг 6. Пользуемся
1. Оба пишете боту `/start`
2. Один смотрит код: `/code`
3. Второй вводит `/link КОД`
4. Бюджет общий — открывайте приложение кнопкой "💰 Открыть кошелёк"
   или пишите прямо в чат: `-500 продукты`, `+30000 доход зарплата`

## Проверить, что всё работает
- Откройте `https://your-app.netlify.app/api/summary?init_data=test` в браузере —
  должна вернуться ошибка про неверную подпись (это нормально, значит функция жива)
- Если бот не отвечает — проверьте **Netlify → Functions → webhook → Logs**, там видны все ошибки
