/* Сквозной тест живого API: проверяем, что запреты нельзя обойти. */
/* У Node 18 короткий таймаут соединения, на Cloudflare это даёт ложные обрывы.
   Ретраим — к самому API отношения не имеет. */
const rawFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  let last;
  for (let i = 0; i < 4; i++) {
    try { return await rawFetch(url, init); }
    catch (e) { last = e; await new Promise(r => setTimeout(r, 1500 * (i + 1))); }
  }
  throw last;
};
const API = "https://pravofin-api.pravofin.workers.dev";
import { makeAdmin, cleanup, sql } from "./_admin.mjs";
const ORIGIN = "https://divine-guest.github.io";

let pass = 0, fail = 0;
const ok = (cond, label, extra = "") => {
  if (cond) { pass++; console.log("  ✓", label); }
  else { fail++; console.log("  ✗", label, extra); }
};

async function call(path, { method = "GET", body, token } = {}) {
  const r = await fetch(API + path, {
    method,
    headers: {
      Origin: ORIGIN,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

const stamp = Date.now();
const alice = `alice${stamp}@test.ru`;
const bob = `bob${stamp}@test.ru`;

console.log("\n— Регистрация и роли —");
const a = await call("/api/auth/register", { method: "POST", body: { name: "Алиса Тест", email: alice, password: "parol12345" } });
ok(a.status === 201 && a.data.user.role === "user", "обычный пользователь получает роль user");
ok(a.data.user.plan === "free", "и тариф free");
const aliceT = a.data.token;

const b = await call("/api/auth/register", { method: "POST", body: { name: "Боб Тест", email: bob, password: "parol12345" } });
const bobT = b.data.token;

/* Работаем под одноразовым админом: настоящий аккаунт владельца
   тесты не трогают — ни паролем, ни регистрацией. */
const admin = await makeAdmin(call);
const ownerT = admin.token;

/* Свойство «почта из OWNER_EMAILS = владелец» проверяем чтением,
   а не регистрацией: аккаунт уже существует, и он должен быть owner. */
const OWNER = "9034092309egor@gmail.com";
const all = await call("/api/admin/users", { token: ownerT });
const ownerRow = (all.data.users || []).find(u => u.email === OWNER);
ok(ownerRow?.role === "owner", `почта из OWNER_EMAILS имеет роль владельца (${ownerRow?.role})`);
ok(admin.token && (await call("/api/auth/me", { token: ownerT })).data.user.isAdmin === true,
   "у админа открыта админка");

console.log("\n— Запреты —");
ok((await call("/api/admin/users", { token: aliceT })).status === 403, "обычный пользователь не видит список пользователей");
ok((await call("/api/admin/stats", { token: aliceT })).status === 403, "и не видит выручку");
ok((await call("/api/admin/grant", { method: "POST", token: aliceT, body: { email: alice, plan: "year" } })).status === 403,
   "и не может выдать Pro сам себе");
ok((await call("/api/admin/set-role", { method: "POST", token: aliceT, body: { email: alice, role: "admin" } })).status === 403,
   "и не может сделать себя админом");
ok((await call("/api/admin/users")).status === 401, "без токена — 401");
ok((await call("/api/admin/users", { token: "poddelka" })).status === 401, "с выдуманным токеном — 401");

console.log("\n— Лимиты бесплатного тарифа —");
let q = (await call("/api/quota", { token: aliceT })).data;
ok(q.tool.left === 1 && q.tool.limit === 1, `пробный запуск инструмента: ${q.tool.left} из ${q.tool.limit}`);
ok(q.ai.limit === 3, `лимит ИИ в сутки: ${q.ai.limit}`);

const t1 = await call("/api/ai", { method: "POST", token: aliceT, body: { kind: "tool", prompt: "Составь чек-лист регистрации ИП. Кратко.", maxTokens: 200 } });
ok(t1.status === 200 && t1.data.text, "первый запуск инструмента проходит");

const t2 = await call("/api/ai", { method: "POST", token: aliceT, body: { kind: "tool", prompt: "Ещё один чек-лист", maxTokens: 200 } });
ok(t2.status === 402 && t2.data.paywall, "второй запуск упирается в пейволл (402)");

const t3 = await call("/api/analyze", { method: "POST", token: aliceT, body: { text: "ДОГОВОР ОКАЗАНИЯ УСЛУГ. Пункт 1. Предмет.", fileName: "d.txt" } });
ok(t3.status === 402, "анализ документа тоже закрыт после исчерпания пробного");

console.log("\n— Владелец выдаёт Pro —");
const g = await call("/api/admin/grant", { method: "POST", token: ownerT, body: { email: alice, plan: "month" } });
ok(g.status === 200 && g.data.user.plan === "pro", "Pro выдан на месяц");
const days = Math.round((g.data.user.proUntil - Date.now()) / 86400000);
ok(days === 30, `срок подписки: ${days} дн.`);

const g2 = await call("/api/admin/grant", { method: "POST", token: ownerT, body: { email: alice, plan: "year" } });
const days2 = Math.round((g2.data.user.proUntil - Date.now()) / 86400000);
ok(days2 === 395, `повторная выдача продлевает, а не перезаписывает: ${days2} дн.`);

q = (await call("/api/quota", { token: aliceT })).data;
ok(q.pro === true && q.tool.left === null, "у Pro лимит инструментов снят");
const t4 = await call("/api/ai", { method: "POST", token: aliceT, body: { kind: "tool", prompt: "Проверка доступа Pro. Ответь словом ОК.", maxTokens: 50 } });
ok(t4.status === 200, "инструменты снова работают");

console.log("\n— Роли: границу держит окружение, а не база —");
/* Ключевое свойство: роль владельца выдаётся только переменной
   OWNER_EMAILS. Запись 'owner' прямо в базу понижается до admin,
   поэтому доступ к базе не даёт прав владельца. */
await sql(`UPDATE users SET role='owner' WHERE email='${admin.email}'`);
const climb = await call("/api/auth/me", { token: ownerT });
ok(climb.data.user.role === "admin",
   `запись 'owner' в базу НЕ делает владельцем (роль осталась ${climb.data.user.role})`);

ok((await call("/api/admin/set-role", { method: "POST", token: ownerT, body: { email: bob, role: "admin" } })).status === 403,
   "админ не может назначить другого админа — только владелец");
ok((await call("/api/admin/set-role", { method: "POST", token: ownerT, body: { email: OWNER, role: "user" } })).status === 403,
   "админ не может понизить владельца");
ok((await call("/api/admin/stats", { token: ownerT })).status === 200,
   "статистика админу доступна — это его работа");


console.log("\n— Промокод —");
/* Свежая сессия Боба: блок, где она заводилась, переписан. */
const bobT2 = (await call("/api/auth/login", { method: "POST",
  body: { email: bob, password: "parol12345" } })).data.token;

const p1 = await call("/api/billing/promo", { method: "POST", token: bobT2, body: { code: "PRO2026" } });
ok(p1.status === 200 && p1.data.days === 30, "промокод PRO2026 даёт 30 дней");
ok((await call("/api/billing/promo", { method: "POST", token: bobT2, body: { code: "PRO2026" } })).status === 409,
   "повторно тот же код не активируется");
ok((await call("/api/billing/promo", { method: "POST", token: bobT2, body: { code: "VYDUMANNYJ" } })).status === 404,
   "выдуманный код отклоняется");

console.log("\n— Оплата —");
const bp = await call("/api/billing/plans");
ok(bp.data.enabled === false, "эквайринг пока не подключён — так и сообщается");
ok((await call("/api/billing/create", { method: "POST", token: aliceT, body: { plan: "year" } })).status === 503,
   "создать платёж нельзя, пока нет ключей ЮKassa");

console.log("\n— Гигиена —");
ok((await call("/api/auth/register", { method: "POST", body: { name: "Дубль", email: alice, password: "parol12345" } })).status === 409,
   "повторная регистрация того же email отклоняется");
const wrongOrigin = await fetch(API + "/api/quota", { headers: { Origin: "https://zloj-sajt.example", Authorization: "Bearer " + aliceT } });
ok(wrongOrigin.status === 403, "запрос с чужого домена отклоняется");
ok((await call("/api/auth/logout", { method: "POST", token: aliceT })).status === 200, "выход выполняется");
ok((await call("/api/quota", { token: aliceT })).status === 401, "после выхода токен недействителен");

console.log(`\nИТОГО: ${pass} пройдено, ${fail} провалено\n`);
process.exit(fail ? 1 : 0);

await cleanup(admin.email);
