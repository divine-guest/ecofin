/* Проверка сервера на Node: тот же код, что на Cloudflare, отвечает
   по HTTP так же.

   Что здесь проверяется и чего нет. Это не замена 352 серверным
   проверкам из tests/ — их надо гонять на настоящей машине, где стоит
   native-драйвер и к базе может подключиться второй процесс. Здесь
   ровно то, что можно проверить с одним процессом: доходит ли запрос,
   правильно ли собирается Request, возвращается ли Response, работают
   ли пароли, лимиты, права и разрешённые origin.

   Запуск (сервер должен быть уже поднят):
       API_URL=http://127.0.0.1:8099 node worker/node/test-server.mjs   */

const API = process.env.API_URL || "http://127.0.0.1:8099";
const ORIGIN = "https://divine-guest.github.io";

let pass = 0, fail = 0;
const ok = (cond, label, extra = "") =>
  cond ? (pass++, console.log("  ✓", label))
       : (fail++, console.log("  ✗", label, extra));

async function call(path, { method = "GET", body, token, origin = ORIGIN, headers = {} } = {}) {
  const r = await fetch(API + path, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...(origin ? { Origin: origin } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await r.json(); } catch {}
  return { status: r.status, data, headers: r.headers };
}

console.log(`\nПроверяю ${API}\n`);

console.log("— Сервер отвечает —");
const health = await call("/api/health");
ok(health.status === 200 && health.data.ok === true, "health отвечает 200 и ok:true");
ok(health.data.db === true, "база подключена");
ok(health.data.service === "pravofin-api", `имя сервиса: ${health.data.service}`);

const plans = await call("/api/billing/plans");
ok(plans.status === 200 && Array.isArray(plans.data.plans), `тарифы отдаются: ${(plans.data.plans || []).length}`);
ok(plans.data.plans.some(p => p.id === "basic" && p.price.month === 290), "цена «Базового» 290 ₽ приходит с сервера");

const missing = await call("/api/такого-нет");
ok(missing.status === 404, "неизвестный путь даёт 404");

console.log("\n— CORS и чужие домены —");
const pre = await call("/api/auth/me", { method: "OPTIONS" });
ok(pre.status === 204, "предварительный запрос OPTIONS даёт 204");
ok(pre.headers.get("access-control-allow-origin") === ORIGIN, "разрешённый origin отражается обратно");

/* Origin только латиницей: заголовки HTTP не пропускают кириллицу. */
const alien = await call("/api/auth/me", { origin: "https://evil.example" });
ok(alien.status === 403, "чужому домену отказ 403", `получили ${alien.status}`);

console.log("\n— Регистрация, вход, сессия —");
const email = `srv${Date.now()}@test.ru`;
const password = "parol12345";

const reg = await call("/api/auth/register", { method: "POST", body: { name: "Проверка Сервера", email, password } });
/* Сервер отвечает 201 Created — это правильно, принимаем оба кода. */
ok((reg.status === 200 || reg.status === 201) && reg.data.token, "регистрация выдаёт токен",
   `статус ${reg.status}, ответ ${JSON.stringify(reg.data).slice(0, 120)}`);
ok(reg.data.user && reg.data.user.tier === "free", "новый аккаунт на тарифе «Старт»");
ok(reg.data.user.name === "Проверка Сервера", "кириллица в имени не портится", JSON.stringify(reg.data.user?.name));

const dup = await call("/api/auth/register", { method: "POST", body: { name: "Ещё раз", email, password } });
ok(dup.status !== 200, "повторная регистрация на ту же почту отклоняется", `статус ${dup.status}`);

const bad = await call("/api/auth/login", { method: "POST", body: { email, password: "неверный" } });
ok(bad.status === 401 || bad.status === 400, "неверный пароль не пускает", `статус ${bad.status}`);

const login = await call("/api/auth/login", { method: "POST", body: { email, password } });
ok(login.status === 200 && login.data.token, "вход по правильному паролю выдаёт токен");
ok(login.data.token !== reg.data.token, "у нового входа новый токен, а не тот же самый");

const token = login.data.token;

const me = await call("/api/auth/me", { token });
ok(me.status === 200 && me.data.user.email === email, "сессия узнаёт пользователя");

const noToken = await call("/api/auth/me");
ok(noToken.status === 401, "без токена — 401");

/* Токен только латиницей: заголовки HTTP не пропускают кириллицу. */
const fakeToken = await call("/api/auth/me", { token: "made-up-token" });
ok(fakeToken.status === 401, "с выдуманным токеном — 401");

console.log("\n— Права и лимиты —");
const admin = await call("/api/admin/stats", { token });
ok(admin.status === 403, "обычный пользователь не пускается в админку", `статус ${admin.status}`);

const quota = await call("/api/quota", { token });
ok(quota.status === 200 && quota.data.ai, `лимиты считаются: ${quota.data.ai?.left} вопросов осталось`);
ok(quota.data.ai.limit === 3, "у бесплатного тарифа 3 вопроса в день");

console.log("\n— Данные пользователя —");
const rem = await call("/api/reminders", {
  method: "POST", token,
  body: { title: "Проверить сальдо ЕНС", due: "2026-12-28", repeat: "yearly", channel: "site" },
});
ok(rem.status === 200 || rem.status === 201, "напоминание создаётся", JSON.stringify(rem.data).slice(0, 80));

const list = await call("/api/reminders", { token });
ok(list.status === 200 && (list.data.reminders || []).some(r => r.title.includes("сальдо")),
   "напоминание читается обратно вместе с кириллицей");

const note = await call("/api/notes", { method: "POST", token, body: { text: "Заметка «в кавычках» — с тире" } });
ok(note.status === 200 || note.status === 201, "блокнот сохраняется");
const noteBack = await call("/api/notes", { token });
ok(noteBack.data.text === "Заметка «в кавычках» — с тире", "блокнот читается без потерь", JSON.stringify(noteBack.data.text));

const saved = await call("/api/saved", {
  method: "POST", token,
  body: { kind: "regimes", title: "Мой расчёт", inputs: { txIn: "1200000" }, summary: "УСН 6%" },
});
ok(saved.status === 200 || saved.status === 201, "расчёт сохраняется");

const progress = await call("/api/progress", {
  method: "POST", token, body: { key: "habits", data: { money: ["2026-08-26"] } },
});
ok(progress.status === 200 || progress.status === 201, "прогресс сохраняется");
const progressBack = await call("/api/progress", { token });
ok(progressBack.data.items?.habits?.data?.money?.[0] === "2026-08-26", "прогресс читается обратно");

console.log("\n— Ограничение частоты —");
/* Это самая важная проверка переезда.

   На Cloudflare адрес посетителя приходил в CF-Connecting-IP. На своём
   сервере за nginx такого заголовка нет, и без правки все запросы
   считались бы «с одного адреса»: первый же перебор пароля закрыл бы
   вход всему сайту разом. Теперь адрес берётся из X-Real-IP, который
   ставит nginx.

   У входа два счётчика: 20 попыток с адреса и 8 на один аккаунт за
   15 минут. Второй защищает аккаунт от ботнета с тысячи адресов —
   поэтому для проверки независимости адресов нужен второй аккаунт. */
const second = `srv2${Date.now()}@test.ru`;
const reg2 = await call("/api/auth/register", {
  method: "POST",
  body: { name: "Второй", email: second, password },
  headers: { "X-Real-IP": "198.51.100.200" },
});
ok((reg2.status === 200 || reg2.status === 201), "второй аккаунт заведён", `статус ${reg2.status}`);

let blocked = false, tries = 0;
for (; tries < 30; tries++) {
  const r = await call("/api/auth/login", {
    method: "POST",
    body: { email, password: "снова неверный" },
    headers: { "X-Real-IP": "203.0.113.77" },
  });
  if (r.status === 429) { blocked = true; break; }
}
ok(blocked, `перебор пароля упирается в 429 (после ${tries} попыток)`);

const other = await call("/api/auth/login", {
  method: "POST",
  body: { email: second, password },
  headers: { "X-Real-IP": "203.0.113.99" },
});
ok(other.status === 200, "другой посетитель с другого адреса при этом входит свободно",
   `статус ${other.status} — если 429, значит адрес не различается и лимит общий на всех`);

console.log("\n— Удаление аккаунта (пачка выражений) —");
const del = await call("/api/auth/delete", { method: "POST", token });
ok(del.status === 200, "аккаунт удаляется");
const gone = await call("/api/auth/me", { token });
ok(gone.status === 401, "после удаления токен больше не действует");

console.log(`\nИТОГО: ${pass} пройдено, ${fail} провалено\n`);
process.exit(fail ? 1 : 0);
