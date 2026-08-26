/* Проверяем ровно ту проблему, из-за которой раньше приходилось
   заводить новый аккаунт: вход в один аккаунт с нескольких устройств. */
/* Адрес сервера можно подменить: так один и тот же набор проверок
   гоняется и по боевому Cloudflare, и по новому серверу до переезда.
   API_URL=http://127.0.0.1:8080 node tests/run-all.mjs */
const API = process.env.API_URL || "https://pravofin-api.pravofin.workers.dev";
const ORIGIN = "https://divine-guest.github.io";

const rawFetch = globalThis.fetch;
globalThis.fetch = async (u, i) => {
  let last;
  for (let n = 0; n < 4; n++) {
    try { return await rawFetch(u, i); }
    catch (e) { last = e; await new Promise(r => setTimeout(r, 1500 * (n + 1))); }
  }
  throw last;
};

let pass = 0, fail = 0;
const ok = (c, l, extra = "") => { c ? (pass++, console.log("  ✓", l)) : (fail++, console.log("  ✗", l, extra)); };

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

const email = `multi${Date.now()}@test.ru`;
const PW = "parol12345";

console.log("\n— Один аккаунт, три устройства —");
const reg = await call("/api/auth/register", { method: "POST", body: { name: "Егор Многоустройств", email, password: PW } });
ok(reg.status === 201, "аккаунт создан на «телефоне»");
const phone = reg.data.token;

const l1 = await call("/api/auth/login", { method: "POST", body: { email, password: PW } });
ok(l1.status === 200, "вход с «ноутбука» тем же email и паролем");
const laptop = l1.data.token;

const l2 = await call("/api/auth/login", { method: "POST", body: { email, password: PW } });
ok(l2.status === 200, "вход с «планшета»");
const tablet = l2.data.token;

ok(phone !== laptop && laptop !== tablet, "у каждого устройства свой токен сессии");

console.log("\n— Все три сессии живут одновременно —");
for (const [name, t] of [["телефон", phone], ["ноутбук", laptop], ["планшет", tablet]]) {
  const me = await call("/api/auth/me", { token: t });
  ok(me.status === 200 && me.data.user.email === email, `${name}: сессия активна, аккаунт тот же`);
}

console.log("\n— Данные общие, а не по устройству —");
await call("/api/auth/profile", { method: "POST", token: phone, body: { name: "Егор Изменённый" } });
const fromLaptop = await call("/api/auth/me", { token: laptop });
ok(fromLaptop.data.user.name === "Егор Изменённый", "имя, изменённое на телефоне, видно на ноутбуке");

const t1 = await call("/api/ai", { method: "POST", token: phone, body: { kind: "chat", prompt: "Ответь словом ОК", maxTokens: 30 } });
ok(t1.status === 200, "обращение к ИИ с телефона прошло");
const qTablet = await call("/api/quota", { token: tablet });
ok(qTablet.data.ai.left === 2, `лимит общий на аккаунт, а не на устройство: на планшете осталось ${qTablet.data.ai.left} из 3`);

console.log("\n— Выход на одном устройстве не выкидывает остальные —");
await call("/api/auth/logout", { method: "POST", token: tablet });
ok((await call("/api/auth/me", { token: tablet })).status === 401, "планшет вышел");
ok((await call("/api/auth/me", { token: phone })).status === 200, "телефон остался в аккаунте");
ok((await call("/api/auth/me", { token: laptop })).status === 200, "ноутбук остался в аккаунте");

console.log("\n— Смена пароля разлогинивает чужие устройства —");
const cp = await call("/api/auth/password", { method: "POST", token: phone, body: { oldPassword: PW, newPassword: "novyj-parol-12345" } });
ok(cp.status === 200, "пароль изменён с телефона");
ok((await call("/api/auth/me", { token: phone })).status === 200, "телефон, где меняли, остался в аккаунте");
ok((await call("/api/auth/me", { token: laptop })).status === 401, "ноутбук разлогинен (защита от угона)");
ok((await call("/api/auth/login", { method: "POST", body: { email, password: "novyj-parol-12345" } })).status === 200,
   "по новому паролю вход работает");
ok((await call("/api/auth/login", { method: "POST", body: { email, password: PW } })).status === 401,
   "по старому — уже нет");

console.log("\n— Регистр email не мешает войти —");
const upper = email.toUpperCase();
ok((await call("/api/auth/login", { method: "POST", body: { email: upper, password: "novyj-parol-12345" } })).status === 200,
   "вход с email В ВЕРХНЕМ РЕГИСТРЕ работает");
ok((await call("/api/auth/login", { method: "POST", body: { email: "  " + email + "  ", password: "novyj-parol-12345" } })).status === 200,
   "вход с пробелами по краям работает");
ok((await call("/api/auth/register", { method: "POST", body: { name: "Дубль", email: upper, password: "parol12345" } })).status === 409,
   "и зарегистрировать дубль в другом регистре нельзя");

console.log(`\nИТОГО: ${pass} пройдено, ${fail} провалено\n`);
process.exit(fail ? 1 : 0);
