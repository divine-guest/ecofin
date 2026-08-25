/* Проверка прослойки к базе.

   Прогоняется без сети и без сервера: поднимает базу в памяти, катит на
   неё настоящую схему со всеми миграциями и повторяет те же обращения,
   что делает боевой код. Это самая рискованная часть переезда — если
   прослойка врёт хоть в одной мелочи, сервер сломается тихо и не сразу.

   Запуск:  node worker/node/test-db.mjs                                */

import { openDatabase, applySchema } from "./db.mjs";

let pass = 0, fail = 0;
const ok = (cond, label, extra = "") =>
  cond ? (pass++, console.log("  ✓", label))
       : (fail++, console.log("  ✗", label, extra));

const eq = (a, b, label) => ok(JSON.stringify(a) === JSON.stringify(b), label, `получили ${JSON.stringify(a)}, ждали ${JSON.stringify(b)}`);

const db = await openDatabase(":memory:");
console.log(`\nДрайвер: ${db.driverName}\n`);

console.log("— Схема —");
const s = await applySchema(db);
ok(s.applied > 40, `выражений применено: ${s.applied}, пропущено как уже существующие: ${s.skipped}`);

const tables = await db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
).all();
const names = tables.results.map(r => r.name);
ok(names.length >= 15, `таблиц создано: ${names.length}`, names.join(", "));
for (const t of ["users", "sessions", "usage", "payments", "reminders", "ai_jobs", "progress"]) {
  ok(names.includes(t), `есть таблица ${t}`);
}

/* Колонки, добавленные миграциями: если бы миграции не применились,
   сервер упал бы только в момент первой оплаты. */
const cols = (await db.prepare("PRAGMA table_info(users)").all()).results.map(c => c.name);
for (const c of ["points", "theme_accent", "auto_renew", "auto_method", "notes", "competencies", "digest_week"]) {
  ok(cols.includes(c), `в users есть колонка ${c}`);
}

console.log("\n— Четыре метода D1 —");

const now = Date.now();
await db.prepare(
  "INSERT INTO users (email, name, pass_hash, created_at) VALUES (?, ?, ?, ?)"
).bind("a@test.ru", "Аня", "hash", now).run();

const row = await db.prepare("SELECT * FROM users WHERE email = ?").bind("a@test.ru").first();
ok(row && row.name === "Аня", "first() возвращает строку и не портит кириллицу", JSON.stringify(row && row.name));
eq(row.plan, "free", "значения по умолчанию из схемы применились");
eq(row.auto_renew, 1, "колонка из миграции имеет значение по умолчанию");

const none = await db.prepare("SELECT * FROM users WHERE email = ?").bind("нет@test.ru").first();
eq(none, null, "first() возвращает null, когда строки нет");

const upd = await db.prepare("UPDATE users SET name = ? WHERE email = ?").bind("Анна", "a@test.ru").run();
eq(upd.meta.changes, 1, "run() сообщает число изменённых строк");

const nothing = await db.prepare("UPDATE users SET name = ? WHERE email = ?").bind("X", "нет@test.ru").run();
eq(nothing.meta.changes, 0, "run() сообщает 0, когда ничего не изменилось");

await db.prepare("INSERT INTO users (email, name, pass_hash, created_at) VALUES (?, ?, ?, ?)")
  .bind("b@test.ru", "Борис", "hash", now).run();
const all = await db.prepare("SELECT email FROM users ORDER BY email").all();
eq(all.results.map(r => r.email), ["a@test.ru", "b@test.ru"], "all() возвращает { results: [...] }");

const empty = await db.prepare("SELECT email FROM users WHERE email = ?").bind("никого").all();
eq(empty.results, [], "all() при пустом ответе даёт пустой массив, а не undefined");

console.log("\n— Особенности, на которых ломаются переезды —");

/* D1 молча превращает undefined в NULL, драйверы SQLite на нём падают. */
await db.prepare("UPDATE users SET avatar = ? WHERE email = ?").bind(undefined, "a@test.ru").run();
const av = await db.prepare("SELECT avatar FROM users WHERE email = ?").bind("a@test.ru").first();
eq(av.avatar, null, "undefined в bind() становится NULL, а не ошибкой");

await db.prepare("UPDATE users SET digest_off = ? WHERE email = ?").bind(true, "a@test.ru").run();
const dg = await db.prepare("SELECT digest_off FROM users WHERE email = ?").bind("a@test.ru").first();
eq(dg.digest_off, 1, "true в bind() становится 1");

/* Автоинкремент: на нём стоит выдача номеров задачам ИИ. */
const ins = await db.prepare("INSERT INTO actions (email, text, at) VALUES (?, ?, ?)")
  .bind("a@test.ru", "первое действие", now).run();
ok(ins.meta.last_row_id > 0, `run() отдаёт номер вставленной строки: ${ins.meta.last_row_id}`);

/* ON CONFLICT — на нём стоит весь учёт лимитов. */
const bump = async () => db.prepare(
  `INSERT INTO usage (email, day, kind, n) VALUES (?, ?, ?, 1)
   ON CONFLICT(email, day, kind) DO UPDATE SET n = n + 1`
).bind("a@test.ru", "2026-08-26", "ai").run();
await bump(); await bump(); await bump();
const used = await db.prepare("SELECT n FROM usage WHERE email = ? AND day = ? AND kind = ?")
  .bind("a@test.ru", "2026-08-26", "ai").first();
eq(used.n, 3, "ON CONFLICT DO UPDATE считает расход правильно");

/* Атомарный захват задачи: условие в WHERE не должно дать двум
   попыткам заплатить провайдеру дважды. */
await db.prepare("INSERT INTO ai_jobs (id, email, kind, prompt, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)")
  .bind("job1", "a@test.ru", "chat", "вопрос", now).run();
const grab = () => db.prepare("UPDATE ai_jobs SET status = 'running' WHERE id = ? AND status = 'pending'")
  .bind("job1").run();
const first = await grab(), second = await grab();
eq([first.meta.changes, second.meta.changes], [1, 0], "захват задачи атомарен: вторая попытка не проходит");

console.log("\n— Пачка выражений (batch) —");

const before = (await db.prepare("SELECT COUNT(*) AS n FROM users").first()).n;
await db.batch([
  db.prepare("DELETE FROM sessions WHERE email = ?").bind("b@test.ru"),
  db.prepare("DELETE FROM usage    WHERE email = ?").bind("b@test.ru"),
  db.prepare("DELETE FROM users    WHERE email = ?").bind("b@test.ru"),
]);
const after = (await db.prepare("SELECT COUNT(*) AS n FROM users").first()).n;
eq([before, after], [2, 1], "batch выполняет всю пачку");

/* Главное свойство пачки: либо всё, либо ничего. */
let threw = false;
try {
  await db.batch([
    db.prepare("UPDATE users SET name = ? WHERE email = ?").bind("Изменено", "a@test.ru"),
    db.prepare("INSERT INTO нет_такой_таблицы (a) VALUES (?)").bind(1),
  ]);
} catch { threw = true; }
const name = (await db.prepare("SELECT name FROM users WHERE email = ?").bind("a@test.ru").first()).name;
ok(threw, "ошибка в пачке пробрасывается наверх");
eq(name, "Анна", "при ошибке в пачке откатывается и то, что успело выполниться");

console.log("\n— Значения, которые ходят через API —");

const json = JSON.stringify({ tax: 40, contracts: 15 });
await db.prepare("UPDATE users SET competencies = ? WHERE email = ?").bind(json, "a@test.ru").run();
const comp = await db.prepare("SELECT competencies FROM users WHERE email = ?").bind("a@test.ru").first();
eq(JSON.parse(comp.competencies).tax, 40, "JSON в тексте переживает запись и чтение");

const big = Date.now() + 365 * 86400000;
await db.prepare("UPDATE users SET pro_until = ? WHERE email = ?").bind(big, "a@test.ru").run();
const until = await db.prepare("SELECT pro_until FROM users WHERE email = ?").bind("a@test.ru").first();
eq(until.pro_until, big, "миллисекунды эпохи не теряют точность");

const emoji = "Сроки 📅 и «кавычки» — тире";
await db.prepare("INSERT INTO notifications (email, title, body, kind, created_at) VALUES (?, ?, ?, 'info', ?)")
  .bind("a@test.ru", emoji, emoji, now).run();
const note = await db.prepare("SELECT title FROM notifications WHERE email = ?").bind("a@test.ru").first();
eq(note.title, emoji, "кириллица, эмодзи и типографика не портятся");

console.log("\n— Скорость —");
const N = 2000;
const t0 = Date.now();
for (let i = 0; i < N; i++) {
  await db.prepare("SELECT * FROM users WHERE email = ?").bind("a@test.ru").first();
}
const readMs = Date.now() - t0;
ok(readMs < 4000, `${N} чтений за ${readMs} мс (${(readMs / N).toFixed(3)} мс на запрос)`);

const t1 = Date.now();
for (let i = 0; i < 500; i++) {
  await db.prepare("INSERT INTO actions (email, text, at) VALUES (?, ?, ?)")
    .bind("a@test.ru", "действие " + i, now).run();
}
const writeMs = Date.now() - t1;
ok(writeMs < 4000, `500 записей за ${writeMs} мс (${(writeMs / 500).toFixed(3)} мс на запись)`);

db.close();
console.log(`\nИТОГО: ${pass} пройдено, ${fail} провалено\n`);
process.exit(fail ? 1 : 0);
