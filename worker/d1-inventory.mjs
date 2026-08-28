/* Что лежит в старой базе на Cloudflare — числами, без содержимого.

   Зачем. Перед переездом надо понять, есть ли там живые пользователи.
   Если только владелец и пара тестовых — переносить нечего, новая база
   начинается чистой. Если есть настоящие аккаунты или оплаты — нужен
   полноценный перенос.

   Почему только числа. Ответить на вопрос «есть ли данные» можно, не
   заглядывая в сами данные: имена, почты и переписка для этого не нужны.
   Вывод скрипта попадает в журнал сборки GitHub, а он виден всем, у кого
   есть доступ к репозиторию, — класть туда чужие персональные данные
   нельзя ни при каких обстоятельствах.

   Запуск (в GitHub Actions, токен берётся из секретов репозитория):
       D1_API_TOKEN=... node worker/d1-inventory.mjs                     */

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
  if (!j.success) {
    const why = JSON.stringify(j.errors || j).slice(0, 300);
    throw new Error(why);
  }
  return j.result[0].results;
}

const TABLES = ["users", "sessions", "usage", "payments", "actions", "ratelimit", "point_ops"];

console.log("=== Что в базе на Cloudflare ===\n");

let users = 0, paid = 0;

for (const t of TABLES) {
  try {
    const [row] = await sql(`SELECT COUNT(*) AS n FROM ${t}`);
    const n = Number(row.n) || 0;
    console.log(`  ${t.padEnd(12)} ${n}`);
    if (t === "users") users = n;
    if (t === "payments") paid = n;
  } catch (e) {
    console.log(`  ${t.padEnd(12)} — не прочиталась (${e.message.slice(0, 80)})`);
  }
}

/* Разбивка по ролям и тарифам: тоже числа, без единой строки данных. */
console.log("\n=== Кто эти пользователи ===\n");
try {
  const rows = await sql(
    "SELECT role, plan, COUNT(*) AS n FROM users GROUP BY role, plan ORDER BY n DESC");
  for (const r of rows) {
    console.log(`  роль ${String(r.role || "user").padEnd(8)} тариф ${String(r.plan || "free").padEnd(8)} — ${r.n}`);
  }
} catch (e) {
  console.log("  не удалось разобрать по ролям:", e.message.slice(0, 120));
}

/* Отдельно — те, кто заходил хоть раз после регистрации: по ним видно,
   есть ли живые люди, а не брошенные тестовые записи. */
console.log("\n=== Признаки жизни ===\n");
for (const [what, q] of [
  ["с подтверждённой оплатой", "SELECT COUNT(*) AS n FROM users WHERE pro_until IS NOT NULL AND pro_until > 0"],
  ["заходивших за 30 дней",    "SELECT COUNT(*) AS n FROM sessions WHERE created_at > strftime('%s','now') - 2592000"],
  ["с привязанным телеграмом", "SELECT COUNT(*) AS n FROM users WHERE tg_chat_id IS NOT NULL"],
]) {
  try {
    const [row] = await sql(q);
    console.log(`  ${what.padEnd(28)} ${Number(row.n) || 0}`);
  } catch {
    console.log(`  ${what.padEnd(28)} — столбца нет, пропускаю`);
  }
}

console.log("\n=== Вывод ===\n");
if (users <= 1 && paid === 0) {
  console.log("  Живых данных нет: только аккаунт владельца.");
  console.log("  Переносить нечего — новая база начинается чистой.");
} else {
  console.log(`  В базе ${users} аккаунтов и ${paid} записей об оплате.`);
  console.log("  Нужен полноценный перенос, чистой базой не обойтись.");
}
