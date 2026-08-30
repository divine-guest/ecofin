/* Что именно отвечает админка.

   Появился после того, как владелец увидел «Не удалось загрузить данные»
   и никакой подсказки, а спросить сервер напрямую было нельзя: зайти на
   машину не получается, а снаружи нужен токен админа.

   Скрипт заводит одноразового админа и по очереди дёргает то, что грузит
   страница админки. Печатает код ответа и, если что-то не так, — текст
   ошибки целиком. Это не проверка «сходится или нет», а именно рассказ,
   поэтому он не считает пройденное и не валит прогон.

   Запуск:  API_URL=http://127.0.0.1:8080 DB_FILE=... node tests/admin-smoke.mjs */

const API = process.env.API_URL || "https://pravofin-api.pravofin.workers.dev";
const ORIGIN = process.env.TEST_ORIGIN || "https://divine-guest.github.io";

import { makeAdmin, cleanup } from "./_admin.mjs";

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
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 300) }; }
  return { status: r.status, data };
}

console.log("\n— Что отвечает админка —");

let admin;
try {
  admin = await makeAdmin(call);
} catch (e) {
  console.log("  не удалось завести временного админа:", e.message);
  process.exit(0);
}

/* Ровно те обращения, которые делает страница при открытии. */
const checks = [
  ["/api/admin/stats", "сводка (числа вверху страницы)"],
  ["/api/admin/users?limit=100&offset=0", "список людей"],
  ["/api/admin/qa?status=pending", "лента вопросов на проверку"],
];

for (const [path, what] of checks) {
  try {
    const r = await call(path, { token: admin.token });
    if (r.status === 200) {
      const keys = Object.keys(r.data || {}).slice(0, 6).join(", ");
      console.log(`  ✓ ${what} — 200 (${keys})`);
    } else {
      console.log(`  ✗ ${what} — код ${r.status}`);
      console.log(`      ${JSON.stringify(r.data).slice(0, 300)}`);
    }
  } catch (e) {
    console.log(`  ✗ ${what} — запрос не дошёл: ${e.message}`);
  }
}

await cleanup(admin.email).catch(() => {});
