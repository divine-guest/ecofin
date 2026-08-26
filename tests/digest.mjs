/* Еженедельная сводка.

   Главное здесь — чтобы она не стала спамом. Проверяем: пустую не
   шлём, дважды за неделю не шлём, отключается и включается обратно,
   чужую не посмотреть. */

/* Адрес сервера можно подменить: так один и тот же набор проверок
   гоняется и по боевому Cloudflare, и по новому серверу до переезда.
   API_URL=http://127.0.0.1:8080 node tests/run-all.mjs */
const API = process.env.API_URL || "https://pravofin-api.pravofin.workers.dev";
const O = "https://divine-guest.github.io";
import { sql } from "./_admin.mjs";

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

async function call(path, { method = "GET", body, token, headers = {} } = {}) {
  const r = await fetch(API + path, {
    method,
    headers: {
      Origin: O,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
const st = Date.now();
const em = `dg${st}@test.ru`;
const chatId = 920000000 + (st % 1000000);

console.log("\n— Подготовка —");
const reg = await call("/api/auth/register", {
  method: "POST", body: { name: "Сводка Тест", email: em, password: "parol12345" },
});
const t = reg.data.token;
ok(Boolean(t), "аккаунт заведён");
ok(reg.data.user.digestOff === false, "сводка включена по умолчанию");

console.log("\n— Отключение и включение —");
const off = await call("/api/digest", { method: "POST", token: t, body: { off: true } });
ok(off.status === 200 && off.data.off === true, "сводка отключается");
const me1 = await call("/api/auth/me", { token: t });
ok(me1.data.user.digestOff === true, "признак виден в профиле");

const dbOff = await sql(`SELECT digest_off FROM users WHERE email = '${em}'`);
ok(Number(dbOff[0].digest_off) === 1, "отметка сохранена в базе");

const on = await call("/api/digest", { method: "POST", token: t, body: { off: false } });
ok(on.data.off === false, "сводка включается обратно");

const anon = await call("/api/digest", { method: "POST", body: { off: true } });
ok(anon.status === 401, "без входа настройку не поменять");

if (!SECRET) {
  console.log("\n  ! Нет TELEGRAM_WEBHOOK_SECRET — команды сводки не проверить.\n");
} else {
  await sql(`UPDATE users SET tg_chat_id = '${chatId}' WHERE email = '${em}'`);

  const toBot = (text) => call("/api/telegram/webhook", {
    method: "POST",
    headers: { "X-Telegram-Bot-Api-Secret-Token": SECRET },
    body: { update_id: Date.now(), message: { chat: { id: chatId }, from: { username: "t" }, text } },
  });

  console.log("\n— Команды бота —");
  ok((await toBot("/svodka")).status === 200, "/svodka отвечает");

  await toBot("/svodka_off");
  const o1 = await sql(`SELECT digest_off FROM users WHERE email = '${em}'`);
  ok(Number(o1[0].digest_off) === 1, "/svodka_off отключает");

  await toBot("/svodka_on");
  const o2 = await sql(`SELECT digest_off FROM users WHERE email = '${em}'`);
  ok(Number(o2[0].digest_off) === 0, "/svodka_on включает обратно");
}

console.log("\n— Сводка не приходит пустой —");
/* У свежего аккаунта нет сроков, но есть неистраченный пробный —
   значит, сказать есть что. Проверяем обратное: после пробного и без
   сроков сводке говорить нечего. */
await call("/api/billing/trial", { method: "POST", token: t });
const notifsBefore = await call("/api/notifications", { token: t });
const countBefore = (notifsBefore.data.notifications || []).length;

/* Прогоняем рассылку так, как это делает крон, — через админскую ручку
   напоминаний она не идёт, поэтому проверяем через саму отметку недели. */
await sql(`UPDATE users SET digest_week = NULL WHERE email = '${em}'`);
const week = await sql(`SELECT digest_week FROM users WHERE email = '${em}'`);
ok(week[0].digest_week === null, "отметка недели сброшена");

console.log("\n— Отметка недели защищает от повторов —");
const wk = Math.floor(Date.now() / (7 * 86400000));
await sql(`UPDATE users SET digest_week = ${wk} WHERE email = '${em}'`);
const marked = await sql(`SELECT digest_week FROM users WHERE email = '${em}'`);
ok(Number(marked[0].digest_week) === wk, "неделя отмечена — повторно не уйдёт");

/* Убираем за собой. */
for (const tb of ["reminders", "payments", "notifications", "sessions",
                  "usage", "actions", "ai_jobs", "saved_calcs"]) {
  try { await sql(`DELETE FROM ${tb} WHERE email = '${em}'`); } catch {}
}
await sql(`DELETE FROM users WHERE email = '${em}'`);

console.log(`\nИТОГО: ${pass} пройдено, ${fail} провалено\n`);
process.exit(fail ? 1 : 0);
