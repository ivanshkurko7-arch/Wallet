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
    await supabase.from('users')
      .update({ username, first_name: firstName })
      .eq('user_id', userId);
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

async function addTransaction(userId, amount, type, category, comment, account) {
  const familyId = await getFamilyId(userId);
  if (!familyId) throw new Error('Пользователь не найден, отправьте /start в бота');
  const { data, error } = await supabase.from('transactions').insert({
    family_id: familyId,
    user_id: userId,
    amount,
    type,
    category,
    comment: comment || '',
    account: account || 'Наличные',
    created_at: Math.floor(Date.now() / 1000),
  }).select().single();
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

async function getFamilyMembers(familyId) {
  const { data } = await supabase
    .from('users').select('user_id, first_name, username').eq('family_id', familyId);
  return data || [];
}

async function getTransactions(familyId, limit = 200) {
  const { data, error } = await supabase
    .from('transactions')
    .select('*, users!inner(first_name, username)')
    .eq('family_id', familyId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data || []).map((t) => ({
    ...t,
    first_name: t.users ? t.users.first_name : null,
    username: t.users ? t.users.username : null,
  }));
}

async function getSummary(familyId) {
  const transactions = await getTransactions(familyId, 100000);
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
  deleteTransaction,
  getFamilyMembers,
  getTransactions,
  getSummary,
};
