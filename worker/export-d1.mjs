/* Выгрузка базы с Cloudflare в обычный SQL.

   Зачем. На новом сервере база своя и пустая. Аккаунты, подписки, оплаты
   и история живут пока только в D1 — их надо перенести как есть, вместе
   с пометками «выдано вручную» и «кто выдал».

   Что переносим и что нет:
     users, payments, usage, actions, point_ops — переносим, это данные;
     sessions   — нет: это открытые входы с устройств, пусть люди войдут
                  заново, на новом сервере токены всё равно другие;
     ratelimit  — нет: счётчики попыток входа, им место в прошлом.

   Результат печатается в стандартный вывод. Наружу он попадает только
   зашифрованным — в нём почты и хэши паролей.

   Запуск:  D1_API_TOKEN=... node worker/export-d1.mjs > dump.sql          */

const ACCOUNT = "04620413cc9a8d415f85febe903d7e60";
const DATABASE = "00a64f5f-477b-4eb4-98a0-7bd1385556e5";
const URL = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${DATABASE}/query`;

const TOKEN = process.env.D1_API_TOKEN;
if (!TOKEN) {
  console.error("Нужен D1_API_TOKEN — токен Cloudflare с правом читать базу.");
  process.exit(1);
}

async function sql(statement) {
  const r = await fetch(URL, {
    method: "POST",
    headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ sql: statement }),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.success) throw new Error(JSON.stringify(j.errors || j).slice(0, 300));
  return j.result[0].results;
}

/* Значения экранируем сами: библиотеки здесь нет, а ошибка в кавычках
   означала бы либо сломанный перенос, либо дыру. Одинарная кавычка
   удваивается — так предписывает SQL. */
function lit(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "boolean") return v ? "1" : "0";
  return "'" + String(v).replace(/'/g, "''") + "'";
}

const TABLES = ["users", "payments", "usage", "actions", "point_ops"];

const out = [];
out.push("-- Перенос данных с Cloudflare D1. Строки добавляются поверх");
out.push("-- существующих: повторный запуск ничего не испортит.");
out.push("BEGIN;");

let total = 0;
for (const t of TABLES) {
  let rows;
  try {
    rows = await sql(`SELECT * FROM ${t}`);
  } catch (e) {
    console.error(`  таблица ${t} не прочиталась: ${e.message.slice(0, 100)}`);
    continue;
  }
  console.error(`  ${t}: ${rows.length}`);
  if (!rows.length) continue;

  const cols = Object.keys(rows[0]);
  out.push(`\n-- ${t}: ${rows.length}`);
  for (const r of rows) {
    out.push(
      `INSERT OR REPLACE INTO ${t} (${cols.join(", ")}) ` +
      `VALUES (${cols.map(c => lit(r[c])).join(", ")});`
    );
    total++;
  }
}

out.push("COMMIT;");
console.error(`  всего строк: ${total}`);
process.stdout.write(out.join("\n") + "\n");
