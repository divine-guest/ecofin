/* ЭкоФин — реферальная программа.

   До этого реферальный код на сайте только показывался: он никуда не отправлялся
   и ничего не давал. Здесь он становится настоящим — это самый дешёвый источник
   роста, потому что приводит людей без затрат на рекламу.

   Правила намеренно простые и защищённые от накрутки:
   - код привязывается один раз, при регистрации, и потом не меняется;
   - награда обоим начисляется НЕ сразу, а когда приглашённый чем-то воспользовался,
     иначе выгодно штамповать пустые аккаунты;
   - сам себя пригласить нельзя. */
import { json, fail, now, normEmail } from "./lib.js";
import { grant, POINTS } from "./points.js";
import { logAction } from "./auth.js";

/* Награда теперь в баллах, а не в днях подписки. Дни — это отданный
   товар: человек месяц пользуется и не платит. Баллы — скидка, которая
   срабатывает только вместе с реальной оплатой. */
export const REFERRAL_REWARD = {
  inviteeSignup: POINTS.inviteeSignup,
  inviterActive: POINTS.inviterActive,
  inviterPaid: POINTS.inviterPaid,
};

/* Код выводится из email — его не надо хранить и он не меняется.
   Формат PF-XXXX: короткий, читается вслух, без похожих символов. */
export function codeFor(email) {
  let h = 0;
  for (const c of String(email)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";   // без I, O, 0, 1
  let out = "";
  for (let i = 0; i < 5; i++) { out += abc[h % abc.length]; h = Math.floor(h / abc.length); }
  return "PF-" + out;
}

/* Ищем владельца кода перебором: пользователей немного, а хранить отдельную
   таблицу кодов — лишняя сущность, которая может разъехаться с реальностью.
   Если база вырастет, здесь появится индекс по коду. */
async function ownerOfCode(env, code) {
  const rows = await env.DB.prepare("SELECT email FROM users").all();
  for (const r of rows.results || []) {
    if (codeFor(r.email) === code) return r.email;
  }
  return null;
}

/* Вызывается при регистрации. Ошибки намеренно не бросаем: неверный код
   не должен мешать человеку завести аккаунт. */
export async function attachReferral(env, email, rawCode) {
  const code = String(rawCode || "").trim().toUpperCase();
  if (!code || !/^PF-[A-Z2-9]{5}$/.test(code)) return null;

  const inviter = await ownerOfCode(env, code);
  if (!inviter || inviter === email) return null;

  await env.DB.prepare("UPDATE users SET referred_by = ? WHERE email = ? AND referred_by IS NULL")
    .bind(inviter, email).run();
  await logAction(env, inviter, `По вашей ссылке зарегистрировался ${email}`);
  /* Приглашённому баллы сразу: это то, ради чего он перешёл по ссылке. */
  await grant(env, email, REFERRAL_REWARD.inviteeSignup,
    "Бонус за регистрацию по приглашению", `ref-signup-${email}`);
  return inviter;
}

/* Первая половина награды: приглашённый реально поработал, а не просто
   завёл пустой аккаунт. Зовётся после успешного обращения к ИИ. */
export async function rewardIfEarned(env, email) {
  const u = await env.DB.prepare(
    "SELECT email, referred_by, referral_paid FROM users WHERE email = ?"
  ).bind(email).first();
  if (!u || !u.referred_by || u.referral_paid) return false;

  await env.DB.prepare("UPDATE users SET referral_paid = 1 WHERE email = ?").bind(email).run();

  await grant(env, u.referred_by, REFERRAL_REWARD.inviterActive,
    "Друг начал пользоваться сервисом", `ref-active-${email}`);
  await logAction(env, u.referred_by,
    `Начислено ${REFERRAL_REWARD.inviterActive} баллов: приглашённый начал пользоваться сервисом`);
  return true;
}

/* Вторая, основная половина: приглашённый впервые заплатил.
   Зовётся из оплаты — там же, где включается Pro. */
export async function rewardOnPayment(env, email) {
  const u = await env.DB.prepare("SELECT referred_by FROM users WHERE email = ?").bind(email).first();
  if (!u || !u.referred_by) return false;

  const r = await grant(env, u.referred_by, REFERRAL_REWARD.inviterPaid,
    "Друг оформил подписку", `ref-paid-${email}`);
  if (r.ok) {
    await logAction(env, u.referred_by,
      `Начислено ${REFERRAL_REWARD.inviterPaid} баллов: приглашённый оформил подписку`);
  }
  return r.ok;
}

/* GET /api/referral — что показать в кабинете. */
export async function status(request, env, origin, user) {
  const invited = await env.DB.prepare(
    "SELECT email, created_at, referral_paid FROM users WHERE referred_by = ? ORDER BY created_at DESC LIMIT 50"
  ).bind(user.email).all();

  const list = (invited.results || []).map(r => ({
    /* Полный адрес приглашённого показывать нельзя — это чужие персональные
       данные. Достаточно намёка, чтобы человек узнал своего друга. */
    hint: r.email.replace(/^(.).*(.)@(.*)$/, "$1***$2@$3"),
    at: r.created_at,
    rewarded: Boolean(r.referral_paid),
  }));

  const earned = await env.DB.prepare(
    "SELECT COALESCE(SUM(delta), 0) AS n FROM point_ops WHERE email = ? AND ref LIKE 'ref-%'"
  ).bind(user.email).first();

  return json(env, origin, {
    code: codeFor(user.email),
    link: `${env.SITE_URL || "https://ecofin26.ru/"}auth.html?ref=${codeFor(user.email)}`,
    reward: REFERRAL_REWARD,
    balance: user.points || 0,
    invited: list,
    earnedPoints: earned ? earned.n : 0,
  });
}

/* GET /api/referral/check?code= — показать приглашённому, кто его позвал,
   до регистрации. Отдаём только имя, без почты. */
export async function preview(request, env, origin) {
  const code = String(new URL(request.url).searchParams.get("code") || "").trim().toUpperCase();
  if (!/^PF-[A-Z2-9]{5}$/.test(code)) return fail(env, origin, "Код не найден", 404);

  const email = await ownerOfCode(env, code);
  if (!email) return fail(env, origin, "Код не найден", 404);

  const u = await env.DB.prepare("SELECT name FROM users WHERE email = ?").bind(normEmail(email)).first();
  return json(env, origin, {
    valid: true,
    inviter: (u?.name || "").split(" ")[0],
    bonus: REFERRAL_REWARD.inviteeSignup,
  });
}
