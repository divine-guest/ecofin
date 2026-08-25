/* Пробный период «Про».

   Три дня без карты — сильнейший довод в продаже, поэтому его границы
   важнее обычного: один раз на аккаунт, не поверх действующей подписки,
   и на время действия открывает ровно то же, что платный тариф. */

const API = "https://pravofin-api.pravofin.workers.dev";
const O = "https://divine-guest.github.io";
import { makeAdmin, cleanup, sql } from "./_admin.mjs";

const rf = globalThis.fetch;
globalThis.fetch = async (u, i) => {
  let last;
  for (let n = 0; n < 4; n++) {
    try { return await rf(u, i); }
    catch (e) { last = e; await new Promise(r => setTimeout(r, 1500 * (n + 1))); }
  }
  throw last;
};

let pass = 0, fail = 0;
const ok = (c, label, extra = "") => {
  c ? (pass++, console.log("  ✓", label)) : (fail++, console.log("  ✗", label, extra));
};

async function call(path, { method = "GET", body, token } = {}) {
  const r = await fetch(API + path, {
    method,
    headers: {
      Origin: O,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

const st = Date.now();
const em = `tr${st}@test.ru`;

console.log("\n— Новому человеку пробный доступен —");
const reg = await call("/api/auth/register", {
  method: "POST", body: { name: "Пробный Тест", email: em, password: "parol12345" },
});
const t = reg.data.token;
ok(reg.data.user.tier === "free", "начинает со «Старта»");

const before = await call("/api/billing/trial", { token: t });
ok(before.data.available === true, "пробный предлагается");
ok(before.data.used === false, "отмечен как неиспользованный");
ok(before.data.days === 3, `дней: ${before.data.days}`);

console.log("\n— До пробного платное закрыто —");
const q0 = await call("/api/quota", { token: t });
ok(q0.data.analyze.limit === 0, "разборы документов недоступны");
const th0 = await call("/api/themes", { method: "POST", token: t, body: { id: "indigo" } });
ok(th0.status === 402, "оформление под себя закрыто");

console.log("\n— Включаем пробный —");
const on = await call("/api/billing/trial", { method: "POST", token: t });
ok(on.status === 200, `включён, код ${on.status}`);
ok(on.data.user.tier === "pro", `тариф стал: ${on.data.user.tier}`);
const days = Math.round((on.data.until - Date.now()) / 86400000);
ok(days === 3, `срок три дня: ${days}`);

console.log("\n— На пробном работает всё, что в «Про» —");
const q1 = await call("/api/quota", { token: t });
ok(q1.data.analyze.limit === null, "разборы документов без ограничений");
ok(q1.data.tool.limit === null, "инструменты без ограничений");
const th1 = await call("/api/themes", { method: "POST", token: t, body: { id: "indigo" } });
ok(th1.status === 200, "оформление под себя открылось");
const lesson = await call("/api/courses/lesson?course=acc&index=1", { token: t });
ok(lesson.status === 200, "платные уроки открылись");

console.log("\n— Второй раз не выдаётся —");
const again = await call("/api/billing/trial", { method: "POST", token: t });
ok(again.status === 409, `повторно отказ, код ${again.status}`);
const after = await call("/api/billing/trial", { token: t });
ok(after.data.available === false, "кнопка больше не предлагается");
ok(after.data.used === true, "отмечен как использованный");

console.log("\n— Поверх действующей подписки не выдаётся —");
const em2 = `tr2${st}@test.ru`;
const reg2 = await call("/api/auth/register", {
  method: "POST", body: { name: "С подпиской", email: em2, password: "parol12345" },
});
const admin = await makeAdmin(call);
await call("/api/admin/grant", {
  method: "POST", token: admin.token, body: { email: em2, plan: "month", tier: "basic" },
});
const over = await call("/api/billing/trial", { method: "POST", token: reg2.data.token });
ok(over.status === 409, `подписчику пробный не нужен, код ${over.status}`);
const st2 = await call("/api/billing/trial", { token: reg2.data.token });
ok(st2.data.available === false, "и не предлагается");

console.log("\n— В выручку пробный не попадает —");
const stats = await call("/api/admin/stats", { token: admin.token });
const rows = await sql(`SELECT amount, source FROM payments WHERE email = '${em}'`);
ok(rows.every(r => Number(r.amount) === 0), "запись с нулевой суммой");
ok(rows.some(r => r.source === "trial"), "помечена как пробный период");

console.log("\n— Без входа не выдаётся —");
const anon = await call("/api/billing/trial", { method: "POST" });
ok(anon.status === 401, "нужен вход");

console.log("\n— Человек предупреждён о конце —");
const notif = await call("/api/notifications", { token: t });
ok((notif.data.notifications || []).some(n => /Пробный/i.test(n.title)),
   "в уведомлениях есть сообщение о пробном периоде");

/* Убираем за собой. */
for (const t2 of ["reminders", "point_ops", "payments", "notifications",
                  "sessions", "usage", "actions", "ai_jobs"]) {
  try { await sql(`DELETE FROM ${t2} WHERE email LIKE '%${st}@test.ru'`); } catch {}
}
await sql(`DELETE FROM users WHERE email LIKE '%${st}@test.ru'`);
await cleanup(admin.email);

console.log(`\nИТОГО: ${pass} пройдено, ${fail} провалено\n`);
process.exit(fail ? 1 : 0);
