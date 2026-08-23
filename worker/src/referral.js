/* ПравоФин — реферальная программа.

   До этого реферальный код на сайте только показывался: он никуда не отправлялся
   и ничего не давал. Здесь он становится настоящим — это самый дешёвый источник
   роста, потому что приводит людей без затрат на рекламу.

   Правила намеренно простые и защищённые от накрутки:
   - код привязывается один раз, при регистрации, и потом не меняется;
   - награда обоим начисляется НЕ сразу, а когда приглашённый чем-то воспользовался,
     иначе выгодно штамповать пустые аккаунты;
   - сам себя пригласить нельзя. */
import { json, fail, now, normEmail } from "./lib.js";
import { extendUntil } from "./quota.js";
import { logAction } from "./auth.js";

export const REFERRAL_DAYS = { inviter: 14, invitee: 14 };

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
  return inviter;
}

/* Начисление награды. Зовём, когда приглашённый впервые реально
   воспользовался сервисом — это отсекает пустые накрученные аккаунты. */
export async function rewardIfEarned(env, email) {
  const u = await env.DB.prepare(
    "SELECT email, referred_by, referral_paid FROM users WHERE email = ?"
  ).bind(email).first();
  if (!u || !u.referred_by || u.referral_paid) return false;

  const inviter = await env.DB.prepare("SELECT email, pro_until FROM users WHERE email = ?")
    .bind(u.referred_by).first();
  if (!inviter) return false;

  const invitee = await env.DB.prepare("SELECT pro_until FROM users WHERE email = ?")
    .bind(email).first();

  await env.DB.batch([
    env.DB.prepare("UPDATE users SET plan = 'pro', pro_until = ? WHERE email = ?")
      .bind(extendUntil(inviter.pro_until, REFERRAL_DAYS.inviter), inviter.email),
    env.DB.prepare("UPDATE users SET plan = 'pro', pro_until = ?, referral_paid = 1 WHERE email = ?")
      .bind(extendUntil(invitee?.pro_until, REFERRAL_DAYS.invitee), email),
    env.DB.prepare(
      `INSERT INTO payments (id, email, amount, plan, source, status, granted_by, created_at, completed_at)
       VALUES (?, ?, 0, ?, 'referral', 'succeeded', ?, ?, ?)`
    ).bind(`ref-${email}`, inviter.email, `${REFERRAL_DAYS.inviter}д`, email, now(), now()),
  ]);

  await logAction(env, inviter.email, `Награда за приглашение: +${REFERRAL_DAYS.inviter} дн. Pro`);
  await logAction(env, email, `Бонус за регистрацию по приглашению: +${REFERRAL_DAYS.invitee} дн. Pro`);
  return true;
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

  return json(env, origin, {
    code: codeFor(user.email),
    link: `${env.SITE_URL || "https://divine-guest.github.io/ecofin/"}auth.html?ref=${codeFor(user.email)}`,
    days: REFERRAL_DAYS,
    invited: list,
    earnedDays: list.filter(x => x.rewarded).length * REFERRAL_DAYS.inviter,
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
    days: REFERRAL_DAYS.invitee,
  });
}
