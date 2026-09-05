/* Бесплатные места под напоминания: кто кого вытесняет.

   Задача тонкая и легко ломается. Мастер налогового календаря
   заполняет все три бесплатных места сразу — и после него человек
   не может поставить ни одного своего срока. А свой важнее: он про
   конкретную бумагу с конкретной датой, вроде требования ФНС, где
   на ответ пять дней. Молча не поставить такой срок — это ровно тот
   вред, ради предотвращения которого сервис и существует.

   Проверяем офлайн-логику против ЛОКАЛЬНОГО стенда: тест удаляет
   напоминания, и делать это в живой базе нельзя.

   Запуск:
     DB_FILE=<временный файл> node worker/node/dev-server.mjs
     API_URL=http://127.0.0.1:8770 node tests/reminders-limit.mjs     */

import { cleanup, sql } from "./_admin.mjs";

const API = process.env.API_URL || "http://127.0.0.1:8770";

let pass = 0, fail = 0;
const ok = (c, label, got = "") => {
  c ? (pass++, console.log("  ✓", label)) : (fail++, console.log("  ✗", label, "→", JSON.stringify(got)));
};

async function call(path, { method = "GET", token, body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

try { await sql("DELETE FROM ratelimit"); } catch {}

const accounts = [];
async function register(tag) {
  const email = `rem${tag}${Date.now()}@test.ru`;
  accounts.push(email);
  const r = await call("/api/auth/register", {
    method: "POST", body: { name: "Проверка", email, password: "parol12345" },
  });
  if (!r.data.token) throw new Error("не завести аккаунт: " + JSON.stringify(r.data));
  return { email, token: r.data.token };
}

const A = await register("a");

console.log("\n— Мастер заполняет календарь в пределах бесплатного —");
{
  const prev = await call("/api/reminders/plan?who=ip&mode=usn&staff=0&sphere=services", { token: A.token });
  ok(prev.data.items.length > 3, `подобрано сроков: ${prev.data.items.length}`, prev.data.items.length);
  ok(prev.data.free === 3, "предел бесплатного тарифа показан заранее", prev.data.free);

  /* Порядок важен: ставим ближайшие, а не первые попавшиеся. */
  const dates = prev.data.items.map(i => i.due);
  ok(dates.every((d, i) => i === 0 || d >= dates[i - 1]), "список отсортирован по дате", dates.slice(0, 4));

  const r = await call("/api/reminders/plan", {
    method: "POST", token: A.token, body: { who: "ip", mode: "usn", staff: false, sphere: "services" },
  });
  ok(r.data.added === 3, `поставлено ровно три: ${r.data.added}`, r.data);
  ok(r.data.limited === true, "честно сказано, что остальные не влезли", r.data);

  const list = await call("/api/reminders", { token: A.token });
  ok(list.data.reminders.length === 3, "в календаре три срока", list.data.reminders.length);
  ok(list.data.reminders.map(x => x.due).join() === prev.data.items.slice(0, 3).map(x => x.due).join(),
     "поставлены именно ближайшие", list.data.reminders.map(x => x.due));
}

console.log("\n— Повторный вызов не плодит дубликаты —");
{
  const again = await call("/api/reminders/plan", {
    method: "POST", token: A.token, body: { who: "ip", mode: "usn", staff: false, sphere: "services" },
  });
  ok(again.data.added === 0, "второй раз ничего не добавилось", again.data);
  ok(again.data.already >= 3, "уже стоящие посчитаны как стоящие", again.data.already);

  const list = await call("/api/reminders", { token: A.token });
  ok(list.data.reminders.length === 3, "сроков по-прежнему три", list.data.reminders.length);
}

console.log("\n— Свой срок вытесняет самый дальний плановый —");
{
  const before = await call("/api/reminders", { token: A.token });
  const far = [...before.data.reminders].sort((a, b) => b.due.localeCompare(a.due))[0];

  const r = await call("/api/reminders", {
    method: "POST", token: A.token,
    body: { title: "Ответить на требование ФНС", due: "2026-09-12", repeat: "once" },
  });
  ok(r.status === 201, "свой срок поставлен, несмотря на занятые места", r.data);
  ok(r.data.displaced === far.title, `место уступил самый дальний: ${r.data.displaced}`,
     [r.data.displaced, far.title]);

  const list = await call("/api/reminders", { token: A.token });
  ok(list.data.reminders.length === 3, "мест по-прежнему три, не больше", list.data.reminders.length);
  ok(list.data.reminders.some(x => x.title === "Ответить на требование ФНС"), "свой срок на месте");
  ok(!list.data.reminders.some(x => x.title === far.title), "дальний плановый ушёл");

  /* Ближайшие плановые не трогаем: они могут наступить на этой неделе. */
  const near = before.data.reminders.filter(x => x.id !== far.id);
  ok(near.every(n => list.data.reminders.some(x => x.title === n.title)),
     "ближайшие плановые остались", near.map(n => n.title));
}

console.log("\n— Когда уступать нечему, отказ честный —");
{
  const B = await register("b");
  for (let i = 0; i < 3; i++) {
    await call("/api/reminders", {
      method: "POST", token: B.token,
      body: { title: "Свой срок " + i, due: "2026-10-0" + (i + 1), repeat: "once" },
    });
  }
  const r = await call("/api/reminders", {
    method: "POST", token: B.token, body: { title: "Четвёртый", due: "2026-11-01", repeat: "once" },
  });
  ok(r.status === 402 && r.data.paywall, "личные сроки друг друга не вытесняют", r.data);
  ok(/Удалите ненужное/.test(r.data.error || ""), "сказано, что делать", r.data.error);

  const list = await call("/api/reminders", { token: B.token });
  ok(list.data.reminders.length === 3, "ни один срок не пропал", list.data.reminders.length);
}

for (const acc of accounts) await cleanup(acc);

console.log(`\nИТОГО: ${pass} пройдено, ${fail} провалено\n`);
process.exit(fail ? 1 : 0);
