const db = require('./lib/db');
const { verifyTelegramData } = require('./lib/verify');

const CORS = {
  'Content-Type': 'application/json',
     'Access-Control-Allow-Origin': 'https://wa1et.netlify.app',
};

exports.handler = async (event) => {
  try {
    const initData = (event.queryStringParameters && event.queryStringParameters.init_data) || '';
    const user = verifyTelegramData(initData);

    await db.getOrCreateUser(user.id, user.username, user.first_name);
    const familyId = await db.getFamilyId(user.id);

    const summary = await db.getSummary(familyId);
    summary.members = await db.getFamilyMembers(familyId);
    summary.invite_code = await db.getInviteCode(user.id);
    summary.categories = db.DEFAULT_CATEGORIES;

    return { statusCode: 200, headers: CORS, body: JSON.stringify(summary) };
  } catch (e) {
    console.error(e);
    return { statusCode: 401, headers: CORS, body: JSON.stringify({ error: e.message }) };
  }
};
