/* ============ Оплата от кнопки до возврата — на подставной ЮKassa ============

   До октября 2026-го путь денег не проверялся никак: единственная проверка
   убеждалась, что без ключей приходит отказ. Создание платежа, уведомление,
   запасная проверка, автоплатежи и возврат впервые встретились бы с
   настоящими деньгами настоящего человека.

   Здесь поднимаются два сервера: подставная ЮKassa, которая отвечает как
   настоящая, и сам сервис со своей временной базой, направленный на неё
   переменной YOOKASSA_API_URL. Боевой сервер в проверке не участвует, и
   запускать её против него нельзя: API_URL из окружения она не читает.

   Запуск:  node tests/billing-flow.mjs                                   */

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const FAKE_PORT = 8795, SITE_PORT = 8796, API_PORT = 8797;
const SITE = `http://127.0.0.1:${SITE_PORT}`;
const OWNER = "owner-billing@test.ru";
const DAY = 86400000;

let pass = 0, fail = 0;
const ok = (c, label, got = "") => {
  c ? (pass++, console.log("  ✓", label)) : (fail++, console.log("  ✗", label, got === "" ? "" : "→ " + JSON.stringify(got)));
};

/* ---------------- Подставная ЮKassa ---------------- */

const fake = {
  payments: new Map(), refunds: new Map(), byKey: new Map(),
  log: [],                 // все обращения сервиса: метод, путь, заголовки, тело
  forbidRecurring: false,  // магазину не подключены автоплатежи
  refundStatus: "succeeded",
  n: 0,
};
const err = (res, status, code, parameter) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ type: "error", id: "e" + ++fake.n, code, parameter, description: "подставная ошибка" }));
};
const send = (res, obj) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };

const yk = createServer((req, res) => {
  let raw = "";
  req.on("data", d => (raw += d));
  req.on("end", () => {
    const body = raw ? JSON.parse(raw) : null;
    const key = req.headers["idempotence-key"] || "";
    fake.log.push({ method: req.method, path: req.url, auth: req.headers.authorization || "", key, body });

    if (req.method === "POST" && req.url === "/payments") {
      if (key && fake.byKey.has(key)) return send(res, fake.byKey.get(key));
      if (body.save_payment_method && fake.forbidRecurring) return err(res, 403, "forbidden", "save_payment_method");
      if ((body.description || "").length > 128) return err(res, 400, "invalid_request", "description");
      const id = "pay-" + ++fake.n;
      const renewal = Boolean(body.payment_method_id);
      const p = {
        id, status: renewal ? "succeeded" : "pending", paid: renewal,
        amount: body.amount, metadata: body.metadata, description: body.description,
        confirmation: renewal ? undefined : { type: "redirect", confirmation_url: `https://fake.yookassa.test/confirm/${id}` },
        payment_method: { type: "bank_card", id: body.payment_method_id || "pm-" + fake.n, saved: Boolean(body.save_payment_method || renewal) },
      };
      fake.payments.set(id, p);
      if (key) fake.byKey.set(key, p);
      return send(res, p);
    }
    let m = req.url.match(/^\/payments\/([^/]+)$/);
    if (req.method === "GET" && m) {
      const p = fake.payments.get(decodeURIComponent(m[1]));
      return p ? send(res, p) : err(res, 404, "not_found");
    }
    if (req.method === "POST" && req.url === "/refunds") {
      if (key && fake.byKey.has(key)) return send(res, fake.byKey.get(key));
      const p = fake.payments.get(body.payment_id);
      if (!p || p.status !== "succeeded") return err(res, 400, "invalid_request", "payment_id");
      const r = { id: "ref-" + ++fake.n, status: fake.refundStatus, payment_id: p.id, amount: body.amount };
      fake.refunds.set(r.id, r);
      if (key) fake.byKey.set(key, r);
      return send(res, r);
    }
    m = req.url.match(/^\/refunds\/([^/]+)$/);
    if (req.method === "GET" && m) {
      const r = fake.refunds.get(decodeURIComponent(m[1]));
      return r ? send(res, r) : err(res, 404, "not_found");
    }
    err(res, 404, "not_found");
  });
});
await new Promise(r => yk.listen(FAKE_PORT, "127.0.0.1", r));

/* Что сделал бы человек на странице банка и что — владелец в кабинете ЮKassa. */
const customerPays = id => { const p = fake.payments.get(id); p.status = "succeeded"; p.paid = true; };
const cabinetRefund = (id, value) => {
  const p = fake.payments.get(id);
  const r = { id: "ref-" + ++fake.n, status: "succeeded", payment_id: id, amount: { value: value || p.amount.value, currency: "RUB" } };
  fake.refunds.set(r.id, r);
  return r.id;
};
const sent = (method, path) => fake.log.filter(x => x.method === method && x.path === path);

/* ---------------- Сам сервис ---------------- */

const tmp = mkdtempSync(join(tmpdir(), "ecofin-billing-"));
const app = spawn(process.execPath, [join(ROOT, "worker", "node", "dev-server.mjs")], {
  cwd: ROOT,
  env: {
    ...process.env,
    PORT: String(SITE_PORT), API_PORT: String(API_PORT),
    DB_FILE: join(tmp, "billing.db"),
    YOOKASSA_SHOP_ID: "100500", YOOKASSA_SECRET_KEY: "test_podstavnoy-klyuch",
    YOOKASSA_API_URL: `http://127.0.0.1:${FAKE_PORT}`,
    OWNER_EMAILS: OWNER, ADMIN_EMAILS: "",
    SITE_URL: "https://ecofin26.ru/", ALLOWED_ORIGINS: "https://ecofin26.ru",
    TELEGRAM_OFF: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let appLog = "";
app.stdout.on("data", d => (appLog += d));
app.stderr.on("data", d => (appLog += d));

const finish = code => {
  try { app.kill(); } catch { /* уже завершился */ }
  yk.close();
  setTimeout(() => {
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* файл базы ещё занят — не страшно */ }
    process.exit(code);
  }, 400);
};

async function call(path, { method = "GET", body, token } = {}) {
  const r = await fetch(SITE + path, {
    method,
    headers: {
      Origin: SITE,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}
/* Уведомление приходит от ЮKassa — без Origin и без токена. */
const notify = (event, id) => fetch(SITE + "/api/billing/webhook", {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ type: "notification", event, object: { id } }),
}).then(r => r.status);

let up = false;
for (let i = 0; i < 60 && !up; i++) {
  await new Promise(r => setTimeout(r, 250));
  up = await fetch(SITE + "/api/health").then(r => r.ok).catch(() => false);
}
if (!up) { console.log("сервис не поднялся:\n" + appLog.slice(-1500)); finish(1); }

async function signup(email, name = "Покупатель") {
  const r = await call("/api/auth/register", { method: "POST", body: { name, email, password: "parol-" + email.length + "-Aa1", consent: true } });
  if (r.status !== 201) console.log("    регистрация", email, r.status, r.data.error || "");
  return r.data.token;
}
const me = async token => (await call("/api/auth/me", { token })).data.user || {};
const buy = async (token, plan = "basic", period = "month") =>
  call("/api/billing/create", { method: "POST", token, body: { plan, period } });

try {
  /* ============ 1. Создание платежа ============ */
  console.log("\n— Создание платежа —");
  const health = (await call("/api/health")).data;
  ok(health.billing === true, "сервис видит ключи и считает оплату включённой", health.billing);

  const longMail = "ochen-dlinnyy-adres-pokupatelya-s-familiey-i-nazvaniem-kompanii-ooo-romashka@test.ru";
  const t1 = await signup(longMail);
  const c1 = await buy(t1);
  const p1 = c1.data.paymentId;
  ok(c1.status === 200 && /^https:\/\/fake\.yookassa\.test\/confirm\//.test(c1.data.confirmationUrl || ""),
     "человек получает ссылку на страницу оплаты", c1.data);
  ok(c1.data.toPay === 490, "к оплате 490 ₽ за «Базовый» на месяц", c1.data.toPay);

  const req1 = sent("POST", "/payments")[0];
  ok(req1.auth === "Basic " + Buffer.from("100500:test_podstavnoy-klyuch").toString("base64"),
     "запрос подписан номером магазина и ключом");
  ok(Boolean(req1.key), "у запроса есть ключ идемпотентности");
  ok(req1.body.amount.value === "490.00" && req1.body.amount.currency === "RUB", "сумма — 490.00 RUB", req1.body.amount);
  ok(req1.body.capture === true, "деньги списываются сразу, без отдельного подтверждения");
  ok(req1.body.save_payment_method === true, "просим сохранить способ оплаты — без него нет автопродления");
  ok(req1.body.confirmation.return_url === "https://ecofin26.ru/dashboard.html", "после оплаты человек возвращается в кабинет", req1.body.confirmation);
  ok(req1.body.description.length <= 128, `описание не длиннее 128 знаков (${req1.body.description.length}) — иначе ЮKassa отклонит платёж`);
  const item = req1.body.receipt.items[0];
  ok(req1.body.receipt.customer.email === longMail, "чек уходит на почту покупателя");
  ok(item.amount.value === "490.00" && item.vat_code === 1 && item.payment_subject === "service" && item.payment_mode === "full_payment",
     "позиция чека: услуга, полный расчёт, без НДС", item);
  ok(req1.body.metadata.plan === "basic" && req1.body.metadata.period === "month", "тариф и срок записаны в платёж");
  ok((await me(t1)).plan === "free", "до оплаты тариф не меняется");

  /* ============ 2. Уведомление ============ */
  console.log("\n— Уведомление от ЮKassa —");
  await notify("payment.succeeded", p1);
  ok((await me(t1)).plan === "free", "уведомлению на слово не верим: платёж ещё не оплачен — тариф прежний");
  await notify("payment.succeeded", "pay-vydumannyy");
  ok((await me(t1)).plan === "free", "уведомление о несуществующем платеже ничего не включает");

  customerPays(p1);
  ok(await notify("payment.succeeded", p1) === 200, "на уведомление сервис отвечает 200");
  const u1 = await me(t1);
  ok(u1.plan === "basic", "после оплаты и уведомления тариф «Базовый»", u1.plan);
  ok(Math.abs(u1.proUntil - (Date.now() + 30 * DAY)) < 60000, "доступ на 30 дней");
  ok(u1.canAutoRenew === true, "способ оплаты сохранён — автопродление возможно", u1.canAutoRenew);
  await notify("payment.succeeded", p1);
  ok((await me(t1)).proUntil === u1.proUntil, "повторное уведомление срок не удваивает");

  /* ============ 3. Запасная проверка ============ */
  console.log("\n— Уведомление потерялось —");
  const t2 = await signup("vtoroy@test.ru");
  const p2 = (await buy(t2, "pro", "year")).data.paymentId;
  customerPays(p2);
  ok((await me(t2)).plan === "free", "без уведомления сервис об оплате не знает");
  const chk = await call("/api/billing/check", { method: "POST", token: t2 });
  ok(chk.data.checked === 1 && chk.data.user.plan === "pro", "запасная проверка досчитала оплату: тариф «Про»", chk.data.checked);
  ok(Math.abs(chk.data.user.proUntil - (Date.now() + 365 * DAY)) < 60000, "годовая оплата даёт 365 дней");
  ok((await call("/api/billing/check", { method: "POST", token: t2 })).data.checked === 0, "повторная проверка ничего не добавляет");

  /* ============ 4. Автоплатежи не подключены ============ */
  console.log("\n— Магазину не подключены автоплатежи —");
  fake.forbidRecurring = true;
  const t3 = await signup("tretiy@test.ru");
  const before = sent("POST", "/payments").length;
  const c3 = await buy(t3);
  const p3 = c3.data.paymentId;
  const tries = sent("POST", "/payments").slice(before);
  ok(c3.status === 200 && Boolean(c3.data.confirmationUrl), "платёж всё равно создаётся — человек может заплатить", c3.data);
  ok(tries.length === 2 && tries[0].body.save_payment_method === true && !("save_payment_method" in tries[1].body),
     "после отказа тот же платёж уходит без сохранения способа оплаты", tries.length);
  customerPays(p3);
  await notify("payment.succeeded", p3);
  const u3 = await me(t3);
  ok(u3.plan === "basic" && u3.canAutoRenew === false, "тариф включён, автопродления нет — списывать нечем", [u3.plan, u3.canAutoRenew]);
  fake.forbidRecurring = false;

  /* ============ 5. Возврат из админки ============ */
  console.log("\n— Возврат одной кнопкой —");
  const tOwner = await signup(OWNER, "Владелец");
  ok((await me(tOwner)).role === "owner", "владелец зарегистрирован");
  const r403 = await call("/api/admin/refund", { method: "POST", token: t1, body: { id: p1 } });
  ok(r403.status === 403, "обычный пользователь вернуть деньги не может", r403.status);

  const rf = await call("/api/admin/refund", { method: "POST", token: tOwner, body: { id: p1 } });
  ok(rf.status === 200 && rf.data.ok === true && !rf.data.pending, "владелец оформил возврат", rf.data);
  const rq = sent("POST", "/refunds")[0];
  ok(rq.body.payment_id === p1 && rq.body.amount.value === "490.00", "в ЮKassa ушёл возврат всей суммы по этому платежу", rq.body);
  ok(rq.key === "refund-" + p1, "ключ идемпотентности привязан к платежу: второй клик — не второй возврат", rq.key);
  ok(rq.body.receipt.customer.email === longMail && rq.body.receipt.items[0].amount.value === "490.00", "вместе с возвратом уходит чек возврата");

  const a1 = await me(t1);
  ok(a1.plan === "free" && !a1.proUntil, "тариф снят", [a1.plan, a1.proUntil]);
  ok(a1.autoRenew === false && a1.canAutoRenew === false, "автопродление выключено, способ оплаты забыт", [a1.autoRenew, a1.canAutoRenew]);
  const list = (await call("/api/admin/payments", { token: tOwner })).data.payments;
  ok(list.find(x => x.id === p1)?.status === "refunded", "в списке платежей он помечен возвращённым");
  const stats = (await call("/api/admin/stats", { token: tOwner })).data;
  ok(stats.revenue === 6990 + 490, "возвращённые деньги из выручки вычтены", stats.revenue);
  const notes = (await call("/api/notifications", { token: t1 })).data;
  ok(JSON.stringify(notes).includes("Оплата возвращена"), "человек видит уведомление о возврате");

  const rf2 = await call("/api/admin/refund", { method: "POST", token: tOwner, body: { id: p1 } });
  ok(rf2.status === 200 && rf2.data.already === true && sent("POST", "/refunds").length === 1,
     "повторный возврат того же платежа в ЮKassa не уходит", [rf2.data, sent("POST", "/refunds").length]);

  const cPend = await buy(t1);
  const rfPend = await call("/api/admin/refund", { method: "POST", token: tOwner, body: { id: cPend.data.paymentId } });
  ok(rfPend.status === 400, "неоплаченный платёж вернуть нельзя", rfPend.data);
  const rfNone = await call("/api/admin/refund", { method: "POST", token: tOwner, body: { id: "pay-net-takogo" } });
  ok(rfNone.status === 400, "несуществующий платёж — отказ", rfNone.data);

  /* ============ 6. Возврат, оформленный в кабинете ЮKassa ============ */
  console.log("\n— Возврат в кабинете ЮKassa —");
  await notify("refund.succeeded", "ref-vydumannyy");
  ok((await me(t2)).plan === "pro", "уведомление о несуществующем возврате ничего не снимает");
  const part = cabinetRefund(p2, "1000.00");
  await notify("refund.succeeded", part);
  ok((await me(t2)).plan === "pro", "частичный возврат доступ не снимает — это решает владелец");
  const full = cabinetRefund(p2);
  await notify("refund.succeeded", full);
  const a2 = await me(t2);
  ok(a2.plan === "free" && a2.autoRenew === false, "полный возврат из кабинета ЮKassa снимает тариф и автопродление", [a2.plan, a2.autoRenew]);

  /* ============ 7. Возврат идёт, но ещё не проведён ============ */
  console.log("\n— Возврат в пути —");
  fake.refundStatus = "pending";
  const rf3 = await call("/api/admin/refund", { method: "POST", token: tOwner, body: { id: p3 } });
  ok(rf3.data.ok === true && rf3.data.pending === true, "сервис сообщает, что возврат принят, но деньги ещё не ушли", rf3.data);
  ok((await me(t3)).plan === "basic", "доступ не снят раньше времени");
  const pendingRefund = [...fake.refunds.values()].find(r => r.payment_id === p3);
  pendingRefund.status = "succeeded";
  await notify("refund.succeeded", pendingRefund.id);
  ok((await me(t3)).plan === "free", "деньги ушли — уведомление сняло доступ");
  fake.refundStatus = "succeeded";

  /* ============ 8. Два оплаченных периода и баллы ============ */
  console.log("\n— Два периода подряд и баллы —");
  const t4 = await signup("chetvertyy@test.ru");
  const first = (await buy(t4)).data.paymentId; customerPays(first); await notify("payment.succeeded", first);
  const second = (await buy(t4)).data.paymentId; customerPays(second); await notify("payment.succeeded", second);
  const twoMonths = await me(t4);
  ok(Math.abs(twoMonths.proUntil - (Date.now() + 60 * DAY)) < 120000, "два платежа — шестьдесят дней");
  await call("/api/admin/refund", { method: "POST", token: tOwner, body: { id: second } });
  const oneLeft = await me(t4);
  ok(oneLeft.plan === "basic" && Math.abs(oneLeft.proUntil - (Date.now() + 30 * DAY)) < 120000,
     "возврат одного из двух оставляет второй оплаченный месяц", [oneLeft.plan, Math.round((oneLeft.proUntil - Date.now()) / DAY)]);

  const t5 = await signup("pyatyy@test.ru");
  await call("/api/admin/points", { method: "POST", token: tOwner, body: { email: "pyatyy@test.ru", delta: 150, reason: "для проверки" } });
  const c5 = await buy(t5);
  ok(c5.data.toPay === 340 && c5.data.pointsUsed === 150, "баллы уменьшили сумму: 490 − 150 = 340", [c5.data.toPay, c5.data.pointsUsed]);
  ok((await me(t5)).points === 0, "баллы списаны при создании платежа");
  customerPays(c5.data.paymentId); await notify("payment.succeeded", c5.data.paymentId);
  await call("/api/admin/refund", { method: "POST", token: tOwner, body: { id: c5.data.paymentId } });
  const rq5 = sent("POST", "/refunds").at(-1);
  ok(rq5.body.amount.value === "340.00", "возвращаются те деньги, что были заплачены, — 340, а не 490", rq5.body.amount);
  ok((await me(t5)).points === 150, "потраченные баллы вернулись", (await me(t5)).points);

  console.log(`\nИТОГО: ${pass} пройдено, ${fail} провалено\n`);
  if (fail) console.log("журнал сервиса (хвост):\n" + appLog.slice(-1200));
  finish(fail ? 1 : 0);
} catch (e) {
  console.log("\nСБОЙ ПРОВЕРКИ:", e.stack || e.message);
  console.log("журнал сервиса (хвост):\n" + appLog.slice(-1500));
  finish(1);
}
