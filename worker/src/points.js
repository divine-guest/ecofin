/* ЭкоФин — бонусные баллы.

   Замысел владельца: за приглашённого начислять не деньги, а внутренний
   баланс, которым можно оплатить подписку. Деньги из кассы не уходят,
   «расход» — это скидка, то есть недополученная маржа, а не платёж.

   Три вещи, которые здесь сделаны намеренно.

   1. Это БАЛЛЫ, а не рубли на счёте. Формулировка важна юридически:
      «рубли на балансе, которые можно тратить» — это признаки электронных
      денежных средств, а их выпуск требует лицензии. Баллы, дающие скидку
      и не подлежащие выводу, — обычная маркетинговая программа. Поэтому
      нигде в тексте не пишем «рубли на счёте», только «баллы» и «скидка».

   2. Баллами можно оплатить не больше половины стоимости. Иначе человек
      с десятком приглашений получает год бесплатно и перестаёт быть
      источником денег вообще. С потолком в 50% каждая подписка всё равно
      приносит живые деньги.

   3. Начисляем поэтапно: небольшую часть — когда приглашённый реально
      воспользовался сервисом, основную — когда он впервые заплатил.
      Иначе выгодно штамповать пустые аккаунты. */
import { json, fail, now, normEmail } from "./lib.js";
import { logAction } from "./auth.js";

export const POINTS = {
  /* 1 балл = 1 рубль скидки */
  inviteeSignup: 150,   // приглашённому — сразу, повышает переход по ссылке
  inviterActive: 150,   // пригласившему — когда друг реально поработал
  inviterPaid: 500,     // пригласившему — когда друг впервые заплатил
  maxShareOfPrice: 0.5, // не больше половины цены
};

export const RULES_TEXT =
  "1 балл = 1 ₽ скидки. Баллами можно оплатить до половины стоимости подписки. " +
  "Баллы не выводятся и не обмениваются на деньги.";

/* Начисление и списание идут только через эту функцию — она же ведёт журнал.
   `ref` делает операцию идемпотентной: повторный вызов с тем же ключом
   ничего не начислит второй раз. */
export async function grant(env, email, delta, reason, ref = null) {
  if (!delta) return { ok: false, reason: "нулевая операция" };

  if (ref) {
    const dup = await env.DB.prepare("SELECT 1 FROM point_ops WHERE ref = ?").bind(ref).first();
    if (dup) return { ok: false, reason: "уже начислено" };
  }

  const u = await env.DB.prepare("SELECT points FROM users WHERE email = ?").bind(email).first();
  if (!u) return { ok: false, reason: "нет пользователя" };

  /* В минус баланс не уводим ни при каких обстоятельствах. */
  const next = Math.max(0, (u.points || 0) + delta);
  const applied = next - (u.points || 0);

  await env.DB.batch([
    env.DB.prepare("UPDATE users SET points = ? WHERE email = ?").bind(next, email),
    env.DB.prepare("INSERT INTO point_ops (email, delta, reason, ref, at) VALUES (?, ?, ?, ?, ?)")
      .bind(email, applied, reason, ref, now()),
  ]);
  return { ok: true, balance: next, applied };
}

export async function balanceOf(env, email) {
  const u = await env.DB.prepare("SELECT points FROM users WHERE email = ?").bind(email).first();
  return u ? u.points || 0 : 0;
}

/* Сколько баллов можно применить к этой цене и что останется доплатить. */
export function applyToPrice(balance, priceRub) {
  const maxPoints = Math.floor(priceRub * POINTS.maxShareOfPrice);
  const used = Math.min(balance, maxPoints);
  return { used, toPay: priceRub - used, maxPoints };
}

/* GET /api/points */
export async function status(request, env, origin, user) {
  const rows = await env.DB.prepare(
    "SELECT delta, reason, at FROM point_ops WHERE email = ? ORDER BY at DESC LIMIT 50"
  ).bind(user.email).all();

  const balance = user.points || 0;
  return json(env, origin, {
    balance,
    rules: RULES_TEXT,
    earn: {
      friendSignup: POINTS.inviteeSignup,
      friendActive: POINTS.inviterActive,
      friendPaid: POINTS.inviterPaid,
    },
    maxShare: POINTS.maxShareOfPrice,
    /* Показываем на примере месячной подписки, иначе цифра баланса
       ничего не значит для человека. */
    example: applyToPrice(balance, 490),
    history: (rows.results || []).map(r => ({ delta: r.delta, reason: r.reason, at: r.at })),
  });
}

/* POST /api/admin/points {email, delta, reason} — ручная правка. */
export async function adminAdjust(request, env, origin, admin) {
  const b = await request.json().catch(() => ({}));
  const email = normEmail(b.email);
  const delta = Math.trunc(Number(b.delta) || 0);
  const reason = String(b.reason || "Начисление администратором").slice(0, 140);

  if (!delta) return fail(env, origin, "Укажите, сколько баллов начислить или списать");
  if (Math.abs(delta) > 100000) return fail(env, origin, "Слишком большая сумма за одну операцию");

  const r = await grant(env, email, delta, reason, `admin-${now()}-${email}`);
  if (!r.ok) return fail(env, origin, r.reason === "нет пользователя" ? "Пользователь не найден" : r.reason, 404);

  await logAction(env, admin.email, `Баллы ${delta > 0 ? "+" : ""}${delta} пользователю ${email}: ${reason}`);
  await logAction(env, email, `${delta > 0 ? "Начислено" : "Списано"} ${Math.abs(delta)} баллов: ${reason}`);
  return json(env, origin, { balance: r.balance });
}
