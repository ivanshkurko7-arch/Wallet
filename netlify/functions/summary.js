const db = require('./lib/db');
const { verifyTelegramData } = require('./lib/verify');

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': 'https://wa1et.netlify.app',
};

exports.handler = async (event) => {
  try {
    const qp = event.queryStringParameters || {};
    const initData = qp.init_data || '';
    const user = verifyTelegramData(initData);
    await db.getOrCreateUser(user.id, user.username, user.first_name);
    const familyId = await db.getFamilyId(user.id);

    const start = qp.start !== undefined ? Number(qp.start) : undefined;
    const end = qp.end !== undefined ? Number(qp.end) : undefined;

    // "Общий баланс" на главном экране — это капитал за всё время, он не должен зависеть
    // от выбранного периода (месяц/всё время), поэтому считаем его отдельным запросом без дат.
    const allTimeSummary = await db.getSummary(familyId);

    // Доход/расход/категории/счета/участники — за выбранный период. Если период не передан
    // (открыт "Всё время") — просто переиспользуем уже посчитанный allTimeSummary, чтобы не
    // делать одинаковый запрос дважды.
    const periodSummary = (start != null || end != null)
      ? await db.getSummary(familyId, start, end)
      : allTimeSummary;

    // Остатки по местам хранения (карта, наличные, крипта...) — это накопленные деньги, а не
    // показатель месяца: они переходят из месяца в месяц и не должны обнуляться с началом нового.
    // Иначе сумма по счетам перестаёт сходиться с общим балансом. Поэтому берём их за всё время,
    // а доход/расход/категории/участников — за выбранный период.
    const summary = {
      ...periodSummary,
      by_account: allTimeSummary.by_account,
      overall_balance: allTimeSummary.balance,
    };
    summary.members = await db.getFamilyMembers(familyId);
    summary.invite_code = await db.getInviteCode(user.id);
    summary.categories = db.DEFAULT_CATEGORIES;

    return { statusCode: 200, headers: CORS, body: JSON.stringify(summary) };
  } catch (e) {
    console.error(e);
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }
};
