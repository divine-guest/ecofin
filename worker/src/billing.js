/* ПравоФин — оплата подписки через ЮKassa.
   Pro включается ТОЛЬКО после того, как статус платежа подтверждён запросом
   к API ЮKassa. Ответ браузера и тело вебхука сами по себе ничего не активируют. */
import { CFG, json, fail, now, normEmail, publicUser } from "./lib.js";
import { PLANS, PERIOD_DAYS, publicPlans, yearlyDiscount } from "./plans.js";
import { extendUntil } from "./quota.js";
import { logAction } from "./auth.js";
import { balanceOf, applyToPrice, grant, POINTS, RULES_TEXT } from "./points.js";
import { rewardOnPayment } from "./referral.js";

const YK = "https://api.yookassa.ru/v3";

const configured = env => Boolean(env.YOOKASSA_SHOP_ID && env.YOOKASSA_SECRET_KEY);

function ykAuth(env) {
  return "Basic " + btoa(`${env.YOOKASSA_SHOP_ID}:${env.YOOKASSA_SECRET_KEY}`);
}

async function ykFetch(env, path, { method = "GET", body, idempotenceKey } = {}) {
  const headers = { Authorization: ykAuth(env), "Content-Type": "application/json" };
  if (idempotenceKey) headers["Idempotence-Key"] = idempotenceKey;
  const r = await fetch(YK + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error("yookassa", r.status, JSON.stringify(data).slice(0, 500));
    throw Object.assign(new Error("yookassa"), { status: r.status, data });
  }
  return data;
}

/* GET /api/billing/plans — цены и признак, подключён ли эквайринг. */
export function plans(env, origin) {
  return json(env, origin, {
    enabled: configured(env),
    ...publicPlans(),
    points: { maxShare: POINTS.maxShareOfPrice, rules: RULES_TEXT },
  });
}

/* POST /api/billing/create {plan} → {confirmationUrl} */
export async function createPayment(request, env, origin, user) {
  if (!configured(env))
    return fail(env, origin, "Приём оплаты пока не подключён. Обратитесь к администратору за доступом", 503);

  const b = await request.json().catch(() => ({}));
  /* Теперь два измерения: какой тариф и на какой срок. */
  const planId = PLANS[b.plan] && b.plan !== "free" ? b.plan : "basic";
  const period = b.period === "year" ? "year" : "month";
  const plan = `${planId}:${period}`;
  const price = { rub: PLANS[planId].price[period] };
  if (!price.rub) return fail(env, origin, "Этот тариф нельзя оплатить");
  const returnUrl = String(env.SITE_URL || "https://divine-guest.github.io/ecofin/") + "dashboard.html";

  /* Баллы уменьшают сумму к оплате, но не больше половины: подписка
     обязана приносить живые деньги, иначе программа съедает сама себя.
     Сколько списать, решает сервер — клиент это число не диктует. */
  const balance = await balanceOf(env, user.email);
  const { used, toPay } = applyToPrice(balance, price.rub);

  try {
    const payment = await ykFetch(env, "/payments", {
      method: "POST",
      idempotenceKey: crypto.randomUUID(),
      body: {
        amount: { value: toPay.toFixed(2), currency: "RUB" },
        capture: true,
        confirmation: { type: "redirect", return_url: returnUrl },
        description: `ПравоФин — ${PLANS[planId].title}, ${period === "year" ? "12 мес." : "1 мес."} (${user.email})`,
        /* Сумму и план берём ТОЛЬКО отсюда при подтверждении: клиент их не диктует. */
        metadata: { email: user.email, plan: planId, period, pointsUsed: String(used) },
        receipt: {
          customer: { email: user.email },
          items: [{
            description: `Подписка ПравоФин «${PLANS[planId].title}», ${period === "year" ? "12 мес." : "1 мес."}`,
            quantity: "1.00",
            amount: { value: toPay.toFixed(2), currency: "RUB" },
            vat_code: 1,
            payment_mode: "full_payment",
            payment_subject: "service",
          }],
        },
      },
    });

    await env.DB.prepare(
      `INSERT INTO payments (id, email, amount, plan, source, status, created_at)
       VALUES (?, ?, ?, ?, 'yookassa', 'pending', ?)`
    ).bind(payment.id, user.email, toPay, plan, now()).run();

    /* Баллы списываем сразу при создании платежа, чтобы их нельзя было
       потратить дважды в двух вкладках. Если платёж отменится — вернём. */
    if (used > 0) {
      await grant(env, user.email, -used, `Оплата подписки (${plan})`, `pay-${payment.id}`);
    }

    return json(env, origin, {
      paymentId: payment.id,
      confirmationUrl: payment.confirmation?.confirmation_url || null,
      priceRub: price.rub,
      pointsUsed: used,
      toPay,
    });
  } catch (e) {
    return fail(env, origin, "Не удалось создать платёж. Попробуйте позже", 502);
  }
}

/* Единая точка включения Pro. Идемпотентна: повторный вебхук ничего не удвоит. */
async function applySucceeded(env, paymentId) {
  const row = await env.DB.prepare("SELECT * FROM payments WHERE id = ?").bind(paymentId).first();
  if (!row) return { ok: false, reason: "unknown-payment" };
  if (row.status === "succeeded") return { ok: true, already: true };

  const user = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(row.email).first();
  if (!user) return { ok: false, reason: "unknown-user" };

  const [planId, period] = String(row.plan).split(":");
  const days = PERIOD_DAYS[period] || 30;
  const tier = PLANS[planId] ? planId : "basic";
  const until = extendUntil(user.pro_until, days);

  await env.DB.batch([
    env.DB.prepare("UPDATE users SET plan = ?, pro_until = ? WHERE email = ?").bind(tier, until, row.email),
    env.DB.prepare("UPDATE payments SET status = 'succeeded', completed_at = ? WHERE id = ?").bind(now(), paymentId),
  ]);
  await logAction(env, row.email, `Оплачена подписка Pro (${row.plan}), ${row.amount} ₽`);
  /* Основная часть реферальной награды — именно здесь: пригласивший
     получает баллы, когда приглашённый принёс деньги. */
  await rewardOnPayment(env, row.email).catch(() => {});
  return { ok: true, until };
}

/* Отмена платежа: возвращаем списанные баллы, иначе человек теряет их
   ни за что и перестаёт верить программе. */
async function cancelPayment(env, paymentId) {
  const row = await env.DB.prepare("SELECT email, status FROM payments WHERE id = ?").bind(paymentId).first();
  if (!row || row.status !== "pending") return;
  await env.DB.prepare("UPDATE payments SET status = 'canceled' WHERE id = ?").bind(paymentId).run();

  const spent = await env.DB.prepare("SELECT delta FROM point_ops WHERE ref = ?").bind(`pay-${paymentId}`).first();
  if (spent && spent.delta < 0) {
    await grant(env, row.email, -spent.delta, "Возврат баллов за отменённый платёж", `refund-${paymentId}`);
  }
}

/* POST /api/billing/webhook — вызывает ЮKassa. Тело не считаем доверенным:
   берём из него только id и переспрашиваем статус у API. */
export async function webhook(request, env, origin) {
  if (!configured(env)) return json(env, origin, { ok: true });

  const body = await request.json().catch(() => ({}));
  const paymentId = body?.object?.id;
  if (!paymentId) return json(env, origin, { ok: true });

  try {
    const payment = await ykFetch(env, `/payments/${encodeURIComponent(paymentId)}`);
    if (payment.status === "succeeded" && payment.paid) {
      await applySucceeded(env, paymentId);
    } else if (payment.status === "canceled") {
      await cancelPayment(env, paymentId);
    }
  } catch (e) {
    /* Отвечаем 200 всё равно: иначе ЮKassa будет ретраить сутки.
       Незакрытые платежи подберёт /api/billing/check при заходе в кабинет. */
    console.error("webhook", e.message);
  }
  return json(env, origin, { ok: true });
}

/* POST /api/billing/check — страховка на случай потерянного вебхука:
   кабинет дёргает её при загрузке и досчитывает зависшие платежи. */
export async function check(request, env, origin, user) {
  if (!configured(env)) return json(env, origin, { user: publicUser(user), checked: 0 });

  const pending = await env.DB.prepare(
    "SELECT id FROM payments WHERE email = ? AND status = 'pending' AND created_at > ?"
  ).bind(user.email, now() - 3 * 86400000).all();

  let applied = 0;
  for (const p of pending.results || []) {
    try {
      const payment = await ykFetch(env, `/payments/${encodeURIComponent(p.id)}`);
      if (payment.status === "succeeded" && payment.paid) {
        const r = await applySucceeded(env, p.id);
        if (r.ok && !r.already) applied++;
      } else if (payment.status === "canceled") {
        await cancelPayment(env, p.id);
      }
    } catch { /* переспросим в следующий раз */ }
  }

  const row = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(user.email).first();
  return json(env, origin, { user: publicUser(row), checked: applied });
}

/* POST /api/billing/promo {code} — промокоды задаются переменной PROMO_CODES
   в формате «КОД:дней,КОД2:дней». Один код — один раз на аккаунт. */
export async function promo(request, env, origin, user) {
  const b = await request.json().catch(() => ({}));
  const code = String(b.code || "").trim().toUpperCase().slice(0, 40);
  if (!code) return fail(env, origin, "Введите промокод");

  const table = Object.fromEntries(
    (env.PROMO_CODES || "").split(",").map(s => s.trim()).filter(Boolean)
      .map(pair => {
        const [c, d] = pair.split(":");
        return [String(c).toUpperCase(), Math.min(3650, Math.max(1, Number(d) || 0))];
      })
  );
  const days = table[code];
  if (!days) return fail(env, origin, "Промокод не найден или больше не действует", 404);

  const usedId = `promo-${code}-${user.email}`;
  const already = await env.DB.prepare("SELECT id FROM payments WHERE id = ?").bind(usedId).first();
  if (already) return fail(env, origin, "Этот промокод уже активирован на вашем аккаунте", 409);

  const until = extendUntil(user.pro_until, days);
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET plan = 'pro', pro_until = ? WHERE email = ?").bind(until, user.email),
    env.DB.prepare(
      `INSERT INTO payments (id, email, amount, plan, source, status, created_at, completed_at)
       VALUES (?, ?, 0, ?, 'promo', 'succeeded', ?, ?)`
    ).bind(usedId, user.email, `${days}д`, now(), now()),
  ]);
  await logAction(env, user.email, `Активирован промокод ${code} (${days} дн.)`);

  const row = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(user.email).first();
  return json(env, origin, { user: publicUser(row), days });
}
