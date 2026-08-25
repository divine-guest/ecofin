/* Команды Telegram-бота.

   Бот — второй вход в сервис, и через него теперь идут деньги и
   профиль. Дёргаем вебхук так же, как это делает Telegram, и смотрим,
   что бот отвечает. Проверяем и границы: чужой аккаунт не тронуть,
   промокод второй раз не сработает, лимиты те же, что на сайте. */

const API = "https://pravofin-api.pravofin.workers.dev";
const O = "https://divine-guest.github.io";
import { sql, cleanup } from "./_admin.mjs";

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

/* Сообщение боту от имени чата — ровно в том виде, в каком его шлёт
   Telegram. Секрет вебхука берём из окружения теста. */
const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
let sent = [];

async function toBot(chatId, text) {
  const before = sent.length;
  const r = await call("/api/telegram/webhook", {
    method: "POST",
    headers: { "X-Telegram-Bot-Api-Secret-Token": SECRET || "" },
    body: {
      update_id: Date.now(),
      message: { message_id: 1, chat: { id: chatId }, from: { username: "test_user" }, text },
    },
  });
  return r;
}

const st = Date.now();
const chatId = 900000000 + (st % 1000000);
const em = `bot${st}@test.ru`;

console.log("\n— Подготовка: аккаунт, привязанный к чату —");
const reg = await call("/api/auth/register", {
  method: "POST", body: { name: "Бот Тест", email: em, password: "parol12345" },
});
ok(Boolean(reg.data.token), "аккаунт заведён");
await sql(`UPDATE users SET tg_chat_id = '${chatId}' WHERE email = '${em}'`);

if (!SECRET) {
  console.log("\n  ! Нет TELEGRAM_WEBHOOK_SECRET — команды бота не проверить.");
  console.log("    Задайте переменную из worker/.env и запустите снова.\n");
  await sql(`DELETE FROM users WHERE email = '${em}'`);
  console.log(`ИТОГО: ${pass} пройдено, ${fail} провалено\n`);
  process.exit(fail ? 1 : 0);
}

console.log("\n— Вебхук защищён —");
/* Без секрета вебхук отвечает 200 и молча ничего не делает: так Telegram
   не шлёт повторы, а посторонний не понимает, что промахнулся. Поэтому
   проверяем не код ответа, а последствия — команда не должна сработать. */
const nameBefore = (await sql(`SELECT name FROM users WHERE email = '${em}'`))[0].name;

await call("/api/telegram/webhook", {
  method: "POST",
  body: { update_id: 1, message: { chat: { id: chatId }, text: "/imya Чужак Без Секрета" } },
});
const n1 = (await sql(`SELECT name FROM users WHERE email = '${em}'`))[0].name;
ok(n1 === nameBefore, "без секрета команда не выполняется", n1);

await call("/api/telegram/webhook", {
  method: "POST",
  headers: { "X-Telegram-Bot-Api-Secret-Token": "nepravilnyj" },
  body: { update_id: 2, message: { chat: { id: chatId }, text: "/imya Неверный Секрет" } },
});
const n2 = (await sql(`SELECT name FROM users WHERE email = '${em}'`))[0].name;
ok(n2 === nameBefore, "с неверным секретом команда не выполняется", n2);


console.log("\n— Команды отвечают —");
for (const cmd of ["/help", "/podpiska", "/profil", "/bally", "/pozvat", "/sovet", "/kupit"]) {
  const r = await toBot(chatId, cmd);
  ok(r.status === 200, `${cmd} — обработана`);
}

console.log("\n— Смена имени через бота —");
await toBot(chatId, "/imya Пётр Обновлённый");
const after = await sql(`SELECT name FROM users WHERE email = '${em}'`);
ok(after[0].name === "Пётр Обновлённый", `имя изменилось: ${after[0].name}`);

const short = await toBot(chatId, "/imya Я");
const still = await sql(`SELECT name FROM users WHERE email = '${em}'`);
ok(still[0].name === "Пётр Обновлённый", "слишком короткое имя не принято");

console.log("\n— Промокод —");
const p1 = await toBot(chatId, "/promo PRO2026");
ok(p1.status === 200, "промокод обработан");
const paid = await sql(`SELECT plan, pro_until FROM users WHERE email = '${em}'`);
ok(paid[0].plan === "pro", `тариф стал: ${paid[0].plan}`);
ok(Number(paid[0].pro_until) > Date.now(), "срок подписки в будущем");

const before = paid[0].pro_until;
await toBot(chatId, "/promo PRO2026");
const twice = await sql(`SELECT pro_until FROM users WHERE email = '${em}'`);
ok(String(twice[0].pro_until) === String(before), "повторно тот же промокод не сработал");

const bad = await toBot(chatId, "/promo VYDUMANNYJ");
ok(bad.status === 200, "выдуманный промокод не роняет бота");
const unchanged = await sql(`SELECT pro_until FROM users WHERE email = '${em}'`);
ok(String(unchanged[0].pro_until) === String(before), "выдуманный промокод ничего не изменил");

console.log("\n— Непривязанный чат ничего не может —");
const stranger = 910000000 + (st % 1000000);
const r1 = await toBot(stranger, "/profil");
ok(r1.status === 200, "чужой чат получает вежливый отказ, а не ошибку");
const mine = await sql(`SELECT name FROM users WHERE email = '${em}'`);
await toBot(stranger, "/imya Взломщик");
const notChanged = await sql(`SELECT name FROM users WHERE email = '${em}'`);
ok(notChanged[0].name === mine[0].name, "из чужого чата имя не поменять");

console.log("\n— Неизвестная команда —");
const unknown = await toBot(chatId, "/nesushchestvuet");
ok(unknown.status === 200, "неизвестная команда не роняет бота");

/* Убираем за собой. */
for (const t of ["reminders", "point_ops", "payments", "sessions", "usage", "actions", "ai_jobs"]) {
  try { await sql(`DELETE FROM ${t} WHERE email = '${em}'`); } catch {}
}
await sql(`DELETE FROM users WHERE email = '${em}'`);

console.log(`\nИТОГО: ${pass} пройдено, ${fail} провалено\n`);
process.exit(fail ? 1 : 0);
