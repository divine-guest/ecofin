/* Пробуем сломать собственный API: то, что попробует злоумышленник. */
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

let safe = 0, risk = 0;
const OK = (c, l, x = "") => { c ? (safe++, console.log("  ✓", l)) : (risk++, console.log("  ⚠ РИСК:", l, x)); };

async function call(path, { method = "GET", body, token, origin = ORIGIN, raw } = {}) {
  const r = await fetch(API + path, {
    method,
    headers: {
      ...(origin ? { Origin: origin } : {}),
      ...(body || raw ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: raw !== undefined ? raw : (body ? JSON.stringify(body) : undefined),
  });
  let data = {};
  try { data = await r.json(); } catch {}
  return { status: r.status, data, headers: r.headers };
}

const stamp = Date.now();
const victim = `victim${stamp}@test.ru`;
const attacker = `attacker${stamp}@test.ru`;

const v = await call("/api/auth/register", { method: "POST", body: { name: "Жертва Тест", email: victim, password: "parol12345" } });
const a = await call("/api/auth/register", { method: "POST", body: { name: "Злодей Тест", email: attacker, password: "parol12345" } });
const vt = v.data.token, at = a.data.token;

console.log("\n— Повышение привилегий —");
OK((await call("/api/auth/profile", { method: "POST", token: at, body: { role: "owner", plan: "pro", isAdmin: true } })).data.user?.role === "user",
   "нельзя выдать себе роль через обновление профиля");
OK(!(await call("/api/auth/profile", { method: "POST", token: at, body: { plan: "pro" } })).data.user?.plan?.includes("pro"),
   "нельзя выдать себе Pro через обновление профиля");
OK((await call("/api/admin/grant", { method: "POST", token: at, body: { email: attacker, plan: "year" } })).status === 403,
   "нельзя выдать себе подписку");
OK((await call("/api/admin/set-role", { method: "POST", token: at, body: { email: attacker, role: "admin" } })).status === 403,
   "нельзя назначить себя админом");
OK((await call("/api/admin/reset-password", { method: "POST", token: at, body: { email: victim } })).status === 403,
   "нельзя сбросить пароль чужого аккаунта");

console.log("\n— Доступ к чужим данным —");
OK((await call("/api/admin/user?email=" + encodeURIComponent(victim), { token: at })).status === 403,
   "нельзя прочитать карточку другого пользователя");
OK((await call("/api/admin/users", { token: at })).status === 403, "нельзя выгрузить базу пользователей");
OK((await call("/api/admin/payments", { token: at })).status === 403, "нельзя посмотреть чужие платежи");
OK((await call("/api/auth/me", { token: vt })).data.user?.email === victim &&
   (await call("/api/auth/me", { token: at })).data.user?.email === attacker,
   "каждый токен видит только свой аккаунт");

console.log("\n— Подделка токенов —");
for (const [label, tok] of [
  ["пустой", ""], ["мусор", "aaaaaaaaaaaaaaaa"],
  ["чужой + символ", at + "x"], ["урезанный", at.slice(0, -4)],
  ["SQL-инъекция", "' OR '1'='1"], ["null-байт", at + "%00"],
]) {
  const r = await call("/api/auth/me", { token: tok });
  OK(r.status === 401, `токен «${label}» отклонён`);
}

console.log("\n— SQL-инъекции —");
for (const [label, payload] of [
  ["в email при входе", "' OR 1=1 --"],
  ["в email при регистрации", "x'); DROP TABLE users; --@test.ru"],
  ["в поиске админки", "%' UNION SELECT * FROM users --"],
]) {
  const r = label.includes("вход")
    ? await call("/api/auth/login", { method: "POST", body: { email: payload, password: "x" } })
    : label.includes("регистрац")
      ? await call("/api/auth/register", { method: "POST", body: { name: "Тест Тест", email: payload, password: "parol12345" } })
      : await call("/api/admin/users?q=" + encodeURIComponent(payload), { token: at });
  OK(r.status >= 400, `${label}: отклонено (${r.status})`);
}
const alive = await call("/api/auth/login", { method: "POST", body: { email: victim, password: "parol12345" } });
OK(alive.status === 200, "база цела после попыток инъекции");

console.log("\n— CORS и происхождение запроса —");
for (const bad of ["https://zloj.example", "http://divine-guest.github.io.evil.com", "null"]) {
  OK((await call("/api/auth/me", { token: vt, origin: bad })).status === 403, `чужой Origin «${bad}» отклонён`);
}
const h = (await call("/api/health", { origin: "https://zloj.example" })).headers;
OK(h.get("access-control-allow-origin") === ORIGIN,
   "заголовок CORS не отражает чужой домен", h.get("access-control-allow-origin"));

console.log("\n— Мусор во входных данных —");
OK((await call("/api/ai", { method: "POST", token: vt, raw: "не json вовсе" })).status >= 400, "битый JSON не роняет сервер");
OK((await call("/api/ai", { method: "POST", token: vt, body: { prompt: "" } })).status === 400, "пустой запрос отклонён");
OK((await call("/api/ai", { method: "POST", token: vt, body: { prompt: "x", maxTokens: 999999 } })).status !== 500,
   "завышенный maxTokens не ломает сервер");
OK((await call("/api/analyze", { method: "POST", token: vt, body: { images: ["javascript:alert(1)"] } })).status === 400,
   "не-картинка в анализе отклонена");
OK((await call("/api/auth/register", { method: "POST", body: { name: "A".repeat(5000), email: `long${stamp}@t.ru`, password: "parol12345" } })).status <= 201,
   "сверхдлинное имя обрезается, а не падает");

console.log("\n— Промокоды и оплата —");
OK((await call("/api/billing/promo", { method: "POST", token: at, body: { code: "' OR 1=1" } })).status >= 400, "инъекция в промокод отклонена");
OK((await call("/api/billing/webhook", { method: "POST", body: { object: { id: "fake", status: "succeeded", paid: true } } })).status === 200 &&
   !(await call("/api/auth/me", { token: at })).data.user?.plan?.includes("pro"),
   "поддельный вебхук оплаты НЕ включает Pro");

console.log("\n— Аварийный ключ владельца не перебирается —");
/* Этот единственный запрос отдаёт полный контроль над сервисом: меняет
   пароль владельца и ставит роль owner. Пока ограничения не было, ключ
   подбирался со скоростью в сотни попыток в секунду, и стойкость всего
   сервиса упиралась в длину одной строки в настройках.

   Бьём по выдуманному адресу, а не по настоящему владельцу: счётчик
   срабатывает раньше проверки, чей это адрес, и трогать живой аккаунт
   незачем. */
let recTries = 0, recBlocked = false;
for (let i = 0; i < 25; i++) {
  const rr = await call("/api/auth/owner-recover", { method: "POST",
    body: { email: `nobody${stamp}@t.ru`, secret: "podbor" + i, newPassword: "parol12345" } });
  recTries++;
  if (rr.status === 429) { recBlocked = true; break; }
}
OK(recBlocked, `перебор ключа восстановления останавливается (попыток до отказа: ${recTries})`);
OK(recTries <= 10, `и останавливается быстро, а не через сотни попыток: ${recTries}`);

console.log("\n— Заголовки ответа —");
const hh = (await call("/api/health")).headers;
OK(hh.get("cache-control")?.includes("no-store"), "ответы API не кэшируются");
OK(!hh.get("server")?.toLowerCase().includes("express"), "сервер не раскрывает лишнего");

console.log(`\nИТОГО: ${safe} проверок пройдено, ${risk} рисков найдено\n`);
