const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const DEFAULT_CATEGORIES = [
  'Еда', 'Транспорт', 'Жильё', 'Развлечения',
  'Здоровье', 'Одежда', 'Подписки', 'Прочее',
];

const DEFAULT_ACCOUNTS = [
  'Карта', 'Наличные', 'Валюта', 'Крипта', 'Другое',
];

const SESSION_GAP_SEC = 30 * 60;

function genCode(length = 6) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let s = '';
  for (let i = 0; i < length; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

async function getOrCreateUser(userId, username, firstName) {
  const { data: existing } = await supabase
    .from('users').select('*').eq('user_id', userId).maybeSingle();

  if (existing) {
    const updates = { username, first_name: firstName };
    // Учёт активности для админ-панели. Колонки появляются после SQL-миграции — пока их нет,
    // ничего лишнего не пишем, и приложение работает как раньше.
    if ('last_seen_at' in existing) {
      const now = Math.floor(Date.now() / 1000);
      updates.last_seen_at = now;
      // Новая «сессия» — если с прошлой активности прошло больше 30 минут
      if (!existing.last_seen_at || now - Number(existing.last_seen_at) > SESSION_GAP_SEC) {
        updates.visit_count = (Number(existing.visit_count) || 0) + 1;
      }
      if (!existing.first_seen_at) updates.first_seen_at = now;
    }
    await supabase.from('users').update(updates).eq('user_id', userId);
    return existing;
  }

  const { data: family, error: famErr } = await supabase
    .from('families').insert({ invite_code: genCode() }).select().single();
  if (famErr) throw famErr;

  const { data: user, error: userErr } = await supabase
    .from('users')
    .insert({ user_id: userId, username, first_name: firstName, family_id: family.id })
    .select().single();
  if (userErr) throw userErr;

  // Первая активность нового пользователя (если миграция уже выполнена; иначе ошибка игнорируется)
  try {
    const now = Math.floor(Date.now() / 1000);
    await supabase.from('users').update({ first_seen_at: now, last_seen_at: now, visit_count: 1 }).eq('user_id', userId);
  } catch (e) { /* колонок ещё нет — не страшно */ }

  return user;
}

async function getInviteCode(userId) {
  const { data: user } = await supabase
    .from('users').select('family_id').eq('user_id', userId).maybeSingle();
  if (!user) return null;
  const { data: family } = await supabase
    .from('families').select('invite_code').eq('id', user.family_id).maybeSingle();
  return family ? family.invite_code : null;
}

async function getFamilyId(userId) {
  const { data: user } = await supabase
    .from('users').select('family_id').eq('user_id', userId).maybeSingle();
  return user ? user.family_id : null;
}

async function linkFamilies(userId, inviteCode) {
  const code = (inviteCode || '').trim().toUpperCase();
  const { data: targetFamily } = await supabase
    .from('families').select('id').eq('invite_code', code).maybeSingle();
  if (!targetFamily) {
    return { ok: false, message: 'Код не найден. Проверьте правильность.' };
  }

  const { data: me } = await supabase
    .from('users').select('family_id').eq('user_id', userId).maybeSingle();
  if (!me) {
    return { ok: false, message: 'Сначала напишите /start.' };
  }
  if (me.family_id === targetFamily.id) {
    return { ok: false, message: 'Вы уже в этой паре.' };
  }

  const oldFamilyId = me.family_id;

  await supabase.from('users').update({ family_id: targetFamily.id }).eq('user_id', userId);
  await supabase.from('transactions')
    .update({ family_id: targetFamily.id })
    .eq('family_id', oldFamilyId)
    .eq('user_id', userId);

  const { count } = await supabase
    .from('users').select('*', { count: 'exact', head: true }).eq('family_id', oldFamilyId);
  if (count === 0) {
    await supabase.from('families').delete().eq('id', oldFamilyId);
  }

  return { ok: true, message: 'Готово! Теперь у вас общий бюджет.' };
}

// createdAt — необязательный unix-таймстамп (секунды). Если не передан — берём текущее время.
async function addTransaction(userId, amount, type, category, comment, account, createdAt) {
  const familyId = await getFamilyId(userId);
  if (!familyId) throw new Error('Пользователь не найден, отправьте /start в бота');
  const ts = (createdAt != null && Number.isFinite(Number(createdAt)) && Number(createdAt) > 0)
    ? Math.floor(Number(createdAt))
    : Math.floor(Date.now() / 1000);
  const { data, error } = await supabase.from('transactions').insert({
    family_id: familyId,
    user_id: userId,
    amount,
    type,
    category,
    comment: comment || '',
    account: account || 'Наличные',
    created_at: ts,
  }).select().single();
  if (error) throw error;
  return data;
}

// Редактирование существующей операции. fields — объект с любым подмножеством полей
// { amount, type, category, comment, account, created_at }. Меняются только переданные поля.
async function updateTransaction(userId, transactionId, fields) {
  const familyId = await getFamilyId(userId);
  if (!familyId) throw new Error('Пользователь не найден, отправьте /start в бота');

  const { data: tx, error: selectError } = await supabase
    .from('transactions').select('*').eq('id', transactionId).maybeSingle();
  if (selectError) throw selectError;
  // Сравниваем как строки: bigint из Postgres может прийти и числом, и строкой
  // в зависимости от версии драйвера — строгое === могло бы ошибочно отклонить редактирование.
  if (!tx || String(tx.family_id) !== String(familyId)) {
    throw new Error('Операция не найдена');
  }

  const updates = {};
  if (fields.amount !== undefined && fields.amount !== null) updates.amount = Number(fields.amount);
  if (fields.type !== undefined && fields.type) updates.type = fields.type;
  if (fields.category !== undefined && fields.category) updates.category = fields.category;
  if (fields.comment !== undefined) updates.comment = fields.comment || '';
  if (fields.account !== undefined && fields.account) updates.account = fields.account;
  if (fields.created_at !== undefined && fields.created_at != null && Number.isFinite(Number(fields.created_at))) {
    updates.created_at = Math.floor(Number(fields.created_at));
  }

  const { data, error } = await supabase
    .from('transactions').update(updates).eq('id', transactionId).select().single();
  if (error) throw error;
  return data;
}

async function deleteTransaction(userId, transactionId) {
  const familyId = await getFamilyId(userId);
  if (!familyId) throw new Error('Пользователь не найден, отправьте /start в бота');

  const { data: tx, error: selectError } = await supabase
    .from('transactions').select('*').eq('id', transactionId).maybeSingle();
  if (selectError) throw selectError;

  // Compare as strings: Postgres bigint columns can come back as either a JS
  // number or a numeric string depending on the driver/version, so a strict
  // === comparison could wrongly reject a legitimate delete.
  if (!tx || String(tx.family_id) !== String(familyId)) {
    throw new Error('Операция не найдена');
  }

  const { error, count } = await supabase
    .from('transactions').delete({ count: 'exact' }).eq('id', transactionId);
  if (error) throw error;
  if (!count) throw new Error('Операция уже была удалена');
  return tx;
}

// Массовое удаление СВОИХ операций пользователя за период (start/end — unix-секунды).
// Если start/end не переданы — удаляются все его операции. Операции других участников
// общего бюджета не затрагиваются. Возвращает количество удалённых записей.
async function deleteTransactionsInRange(userId, start, end) {
  const familyId = await getFamilyId(userId);
  if (!familyId) throw new Error('Пользователь не найден, отправьте /start в бота');
  let query = supabase.from('transactions').delete({ count: 'exact' })
    .eq('family_id', familyId).eq('user_id', userId);
  if (start != null && Number.isFinite(Number(start))) query = query.gte('created_at', Math.floor(Number(start)));
  if (end != null && Number.isFinite(Number(end))) query = query.lte('created_at', Math.floor(Number(end)));
  const { error, count } = await query;
  if (error) throw error;
  return count || 0;
}

// Постраничная выборка: Supabase отдаёт максимум 1000 строк за запрос, поэтому читаем частями.
async function fetchAllRows(buildQuery) {
  const PAGE = 1000; let from = 0; const out = [];
  for (;;) {
    const { data, error } = await buildQuery().range(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

// Сводка для админ-панели: кто пользуется, как часто, какой у кого тариф.
async function getAdminStats() {
  const now = Math.floor(Date.now() / 1000);
  const DAY = 86400;
  const users = await fetchAllRows(() => supabase.from('users').select('*').order('user_id', { ascending: true }));
  const txs = await fetchAllRows(() => supabase.from('transactions').select('user_id, created_at').order('id', { ascending: true }));

  const trackingEnabled = users.some((u) => 'last_seen_at' in u);
  const plansEnabled = users.some((u) => 'plan' in u);

  const per = {};
  users.forEach((u) => { per[u.user_id] = { total: 0, d7: 0, d30: 0, last: null, days: new Set() }; });
  txs.forEach((t) => {
    const p = per[t.user_id]; if (!p) return;
    const ts = Number(t.created_at);
    p.total++;
    if (p.last == null || ts > p.last) p.last = ts;
    if (now - ts <= 7 * DAY) p.d7++;
    if (now - ts <= 30 * DAY) { p.d30++; p.days.add(new Date(ts * 1000).toISOString().slice(0, 10)); }
  });

  const famSize = {};
  users.forEach((u) => { famSize[u.family_id] = (famSize[u.family_id] || 0) + 1; });

  const list = users.map((u) => {
    const p = per[u.user_id];
    const plan = (u.plan || 'free');
    const until = u.plan_until != null ? Number(u.plan_until) : null;
    const expired = plan !== 'free' && until != null && until < now;
    const lastSeen = u.last_seen_at != null ? Number(u.last_seen_at) : p.last; // без учёта визитов — по последней операции
    return {
      user_id: u.user_id, first_name: u.first_name || null, username: u.username || null,
      family_id: u.family_id, family_size: famSize[u.family_id] || 1,
      first_seen_at: u.first_seen_at != null ? Number(u.first_seen_at) : null,
      last_seen_at: lastSeen != null ? lastSeen : null,
      visit_count: Number(u.visit_count) || 0,
      tx_total: p.total, tx_7d: p.d7, tx_30d: p.d30, active_days_30: p.days.size, last_tx_at: p.last,
      plan: plan, plan_until: until, plan_status: expired ? 'expired' : (plan === 'free' ? 'free' : 'active'),
    };
  });
  list.sort((a, b) => (b.last_seen_at || 0) - (a.last_seen_at || 0));

  const seen = (u, sec) => u.last_seen_at != null && now - u.last_seen_at <= sec;
  const totals = {
    users: list.length,
    active_24h: list.filter((u) => seen(u, DAY)).length,
    active_7d: list.filter((u) => seen(u, 7 * DAY)).length,
    active_30d: list.filter((u) => seen(u, 30 * DAY)).length,
    new_7d: list.filter((u) => u.first_seen_at != null && now - u.first_seen_at <= 7 * DAY).length,
    new_30d: list.filter((u) => u.first_seen_at != null && now - u.first_seen_at <= 30 * DAY).length,
    families: Object.keys(famSize).length,
    tx_total: txs.length,
    tx_7d: txs.filter((t) => now - Number(t.created_at) <= 7 * DAY).length,
    plans: {
      free: list.filter((u) => u.plan_status === 'free').length,
      active: list.filter((u) => u.plan_status === 'active').length,
      expired: list.filter((u) => u.plan_status === 'expired').length,
    },
  };
  return { generated_at: now, tracking_enabled: trackingEnabled, plans_enabled: plansEnabled, totals: totals, users: list };
}

// Назначение тарифа пользователю. days = null → бессрочно. plan: 'free' | 'pro'.
async function setUserPlan(targetUserId, plan, days) {
  if (!['free', 'pro'].includes(plan)) throw new Error('Неизвестный тариф');
  const until = plan === 'free' || days == null ? null : Math.floor(Date.now() / 1000) + Math.round(Number(days)) * 86400;
  const { data, error } = await supabase.from('users')
    .update({ plan: plan, plan_until: until }).eq('user_id', targetUserId).select().maybeSingle();
  if (error) throw new Error('Не удалось сохранить тариф. Выполните SQL-миграцию (колонки plan, plan_until). ' + error.message);
  if (!data) throw new Error('Пользователь не найден');
  return { user_id: targetUserId, plan: plan, plan_until: until };
}

async function getFamilyMembers(familyId) {
  const { data } = await supabase
    .from('users').select('user_id, first_name, username').eq('family_id', familyId);
  return data || [];
}

// Сохраняет/обновляет ключ быстрого ввода (шорткат) для пользователя.
async function setShortcutKey(userId, key) {
  const { error } = await supabase.from('users').update({ shortcut_key: key }).eq('user_id', userId);
  if (error) throw error;
  return true;
}

// Находит пользователя по ключу быстрого ввода — так авторизуются запросы от iOS-шортката,
// у которого нет доступа к Telegram init_data.
async function getUserByShortcutKey(key) {
  if (!key) return null;
  const { data } = await supabase.from('users').select('*').eq('shortcut_key', key).maybeSingle();
  return data || null;
}

// start/end — необязательные unix-таймстампы (секунды) для фильтрации по периоду.
async function getTransactions(familyId, limit = 200, start, end) {
  let query = supabase
    .from('transactions')
    .select('*, users!inner(first_name, username)')
    .eq('family_id', familyId);
  if (start != null && Number.isFinite(Number(start))) query = query.gte('created_at', Math.floor(Number(start)));
  if (end != null && Number.isFinite(Number(end))) query = query.lte('created_at', Math.floor(Number(end)));

  const { data, error } = await query.order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return (data || []).map((t) => ({
    ...t,
    first_name: t.users ? t.users.first_name : null,
    username: t.users ? t.users.username : null,
  }));
}

// start/end — необязательные unix-таймстампы (секунды) для фильтрации по периоду.
async function getSummary(familyId, start, end) {
  const transactions = await getTransactions(familyId, 100000, start, end);
  const byUser = {};
  const byCategory = {};
  const byAccount = {};
  let totalExpense = 0;
  let totalIncome = 0;

  for (const t of transactions) {
    const name = t.first_name || t.username || String(t.user_id);
    if (!byUser[name]) byUser[name] = { expense: 0, income: 0 };
    const account = t.account || 'Наличные';
    if (!byAccount[account]) byAccount[account] = { expense: 0, income: 0 };
    const amount = Number(t.amount);
    if (t.type === 'expense') {
      byUser[name].expense += amount;
      byAccount[account].expense += amount;
      totalExpense += amount;
      byCategory[t.category] = (byCategory[t.category] || 0) + amount;
    } else {
      byUser[name].income += amount;
      byAccount[account].income += amount;
      totalIncome += amount;
    }
  }

  return {
    by_user: byUser,
    by_category: byCategory,
    by_account: byAccount,
    total_expense: totalExpense,
    total_income: totalIncome,
    balance: totalIncome - totalExpense,
  };
}

module.exports = {
  DEFAULT_CATEGORIES,
  DEFAULT_ACCOUNTS,
  getOrCreateUser,
  getInviteCode,
  getFamilyId,
  linkFamilies,
  addTransaction,
  updateTransaction,
  deleteTransaction,
  getAdminStats,
  setUserPlan,
  deleteTransactionsInRange,
  getFamilyMembers,
  setShortcutKey,
  getUserByShortcutKey,
  getTransactions,
  getSummary,
};
