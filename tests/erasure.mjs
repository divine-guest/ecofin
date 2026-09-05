/* Удаление аккаунта стирает всё, а выгрузка отдаёт всё.

   Это не благоустройство, а требование закона. Статья 21 152-ФЗ:
   при отзыве согласия оператор обязан уничтожить персональные данные.
   Статья 14: субъект вправе получить сведения об обработке своих
   данных. Политика сервиса обещает и то, и другое прямым текстом.

   Ошибка тут тихая и опасная: новая таблица появляется, в список
   удаления её вписать забывают, и данные удалённого человека остаются
   в базе навсегда. Ровно так и случилось с таблицей документов —
   в ней лежат тексты договоров и счетов с данными контрагентов.

   Проверка идёт против ЛОКАЛЬНОГО стенда: она заводит аккаунт,
   наполняет его данными и удаляет.

   Запуск:
     DB_FILE=<временный файл> node worker/node/dev-server.mjs
     DB_FILE=<он же> API_URL=http://127.0.0.1:8770 node tests/erasure.mjs  */

import { cleanup, sql } from "./_admin.mjs";
import fs from "node:fs";

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

console.log("\n— Список удаления не отстал от схемы —");
{
  /* Сверяем таблицы, где есть почта владельца данных, со списком в
     deleteAccount. Забытая таблица означает, что данные удалённого
     человека остаются в базе навсегда. */
  const auth = fs.readFileSync(new URL("../worker/src/auth.js", import.meta.url), "utf8");
  const from = auth.indexOf("export async function deleteAccount");
  const to = auth.indexOf("GET /api/auth/sessions");
  const block = auth.slice(from, to);

  const tabs = await sql("SELECT name FROM sqlite_master WHERE type='table'");
  const forgotten = [];
  for (const t of tabs) {
    if (t.name.startsWith("sqlite_") || t.name === "ratelimit" || t.name === "partner_offers") continue;
    const cols = await sql(`PRAGMA table_info(${t.name})`);
    const names = cols.map(c => c.name);
    if (!names.includes("email") && !names.includes("owner")) continue;
    if (!block.includes(t.name)) forgotten.push(t.name);
  }
  ok(forgotten.length === 0, "каждая таблица с данными человека попала в удаление", forgotten);
}

const email = `era${Date.now()}@test.ru`;
const reg = await call("/api/auth/register", {
  method: "POST", body: { name: "Проверка", email, password: "parol12345" },
});
const token = reg.data.token;
if (!token) throw new Error("не завести аккаунт: " + JSON.stringify(reg.data));

console.log("\n— Наполняем аккаунт данными —");
{
  await call("/api/documents", {
    method: "POST", token,
    body: { kind: "invoice", title: "Счёт", number: "1", party: "ООО «Тайна»",
            amount: 1000, content: "СЧЁТ с персональными данными" },
  });
  await call("/api/reminders", {
    method: "POST", token, body: { title: "Свой срок", due: "2026-12-01", repeat: "once" },
  });
  await call("/api/book/op", {
    method: "POST", token, body: { day: "2026-09-01", kind: "income", amount: 5000, party: "Иванов И. И." },
  });
  await call("/api/counterparties", {
    method: "POST", token, body: { name: "ООО «Контрагент»", inn: "7707083893" },
  });
  await call("/api/notes", { method: "POST", token, body: { text: "личная заметка" } });

  const docs = await call("/api/documents", { token });
  ok(docs.data.documents.length === 1, "документ на месте", docs.data.documents.length);
  const book = await call("/api/book", { token });
  ok((book.data.ops || []).length === 1, "запись учёта на месте", (book.data.ops || []).length);
}

console.log("\n— Выгрузка отдаёт то, что обещано —");
{
  /* Политика обещает «экспорт всех ваших данных одним файлом».
     Проверяем не текст кнопки, а состав: раздел, обещанный политикой
     и отсутствующий в выгрузке, — это несоответствие ст. 14 152-ФЗ. */
  const r = await call("/api/auth/export", { token });
  ok(r.status === 200, "выгрузка отвечает", r.status);
  const d = r.data || {};
  for (const key of ["profile", "documents", "book", "reminders", "counterparties", "notes"]) {
    ok(key in d, `в выгрузке есть раздел «${key}»`, Object.keys(d));
  }
  ok(JSON.stringify(d).includes("ООО «Тайна»"), "документ попал в выгрузку целиком");
  ok(JSON.stringify(d).includes("Иванов И. И."), "запись учёта попала в выгрузку");
  ok(!JSON.stringify(d).includes("pass_hash"), "хэш пароля в выгрузку не попадает");
}

console.log("\n— Удаление стирает всё —");
{
  const del = await call("/api/auth/delete", { method: "POST", token });
  ok(del.status === 200, "аккаунт удалён", del.status);

  const left = [];
  for (const t of ["users", "documents", "book_ops", "reminders", "counterparties",
                   "notes", "sessions", "saved_calcs", "progress", "actions"]) {
    const rows = await sql(`SELECT COUNT(*) AS n FROM ${t} WHERE email = '${email}'`).catch(() => [{ n: 0 }]);
    if ((rows[0]?.n || 0) > 0) left.push(`${t}: ${rows[0].n}`);
  }
  ok(left.length === 0, "ни одной строки с этой почтой не осталось", left);

  /* Платежи обезличиваются, а не удаляются: их обязаны хранить для
     бухгалтерского учёта (ФЗ-402 ст. 29 — пять лет). */
  const pay = await sql(`SELECT COUNT(*) AS n FROM payments WHERE email = '${email}'`).catch(() => [{ n: 0 }]);
  ok((pay[0]?.n || 0) === 0, "в платежах почта заменена на «удалён»", pay[0]?.n);

  const login = await call("/api/auth/login", {
    method: "POST", body: { email, password: "parol12345" },
  });
  ok(login.status >= 400, "войти под удалённым аккаунтом нельзя", login.status);
}

await cleanup(email);

console.log(`\nИТОГО: ${pass} пройдено, ${fail} провалено\n`);
process.exit(fail ? 1 : 0);
