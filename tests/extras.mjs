/* Блокнот, итоги и достижения.

   Блокнот хранит личное — проверяем, что чужой не прочитать и не
   переписать. Итоги считаются по фактическим записям: проверяем, что
   цифры меняются от реальных действий, а не берутся из воздуха. */

const API = "https://pravofin-api.pravofin.workers.dev";
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

async function call(path, { method = "GET", body, token } = {}) {
  const r = await fetch(API + path, {
    method,
    headers: {
      Origin: O,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

const st = Date.now();
const em = `ex${st}@test.ru`;
const em2 = `ex2${st}@test.ru`;

console.log("\n— Подготовка —");
const a = await call("/api/auth/register", {
  method: "POST", body: { name: "Хозяин Блокнота", email: em, password: "parol12345" },
});
const b = await call("/api/auth/register", {
  method: "POST", body: { name: "Посторонний", email: em2, password: "parol12345" },
});
const t = a.data.token, t2 = b.data.token;
ok(Boolean(t && t2), "два аккаунта заведены");

console.log("\n— Блокнот —");
const empty = await call("/api/notes", { token: t });
ok(empty.data.text === "", "у нового аккаунта блокнот пуст");

const secret = "Спросить бухгалтера про патент на 2027. Счёт ООО Ромашка 40702810...";
const saved = await call("/api/notes", { method: "POST", token: t, body: { text: secret } });
ok(saved.status === 200, "заметка сохраняется");
ok(saved.data.updatedAt > 0, "время сохранения записано");

const back = await call("/api/notes", { token: t });
ok(back.data.text === secret, "текст возвращается целиком");

console.log("\n— Чужой блокнот недоступен —");
const other = await call("/api/notes", { token: t2 });
ok(other.data.text === "", "посторонний видит свой пустой блокнот, а не чужой");

await call("/api/notes", { method: "POST", token: t2, body: { text: "моё" } });
const mine = await call("/api/notes", { token: t });
ok(mine.data.text === secret, "запись постороннего не затёрла чужую");

const anon = await call("/api/notes");
ok(anon.status === 401, "без входа блокнот недоступен");

console.log("\n— Слишком длинная заметка обрезается —");
const huge = "я".repeat(6000);
await call("/api/notes", { method: "POST", token: t, body: { text: huge } });
const cut = await call("/api/notes", { token: t });
ok(cut.data.text.length === 4000, `обрезано до 4000 символов: ${cut.data.text.length}`);

console.log("\n— Итоги считаются по фактам —");
const s0 = await call("/api/summary", { token: t });
ok(s0.status === 200, "сводка отдаётся");
ok(s0.data.stats.questions === 0, "вопросов пока ноль");
ok(s0.data.saved === 0, "оценка экономии — ноль, пока ничего не сделано");
ok(s0.data.stats.days >= 1, `дней с нами: ${s0.data.stats.days}`);

/* Задаём вопрос и ждём — счётчик должен вырасти. */
const asked = await call("/api/ai/ask", {
  method: "POST", token: t, body: { kind: "chat", prompt: "Что такое ОКВЭД?", maxTokens: 120 },
});
for (let i = 0; i < 30; i++) {
  await new Promise(r => setTimeout(r, 2000));
  const j = await call("/api/ai/job?id=" + asked.data.id, { token: t });
  if (j.data.job?.status !== "pending") break;
}
const s1 = await call("/api/summary", { token: t });
ok(s1.data.stats.questions === 1, `после вопроса счётчик стал ${s1.data.stats.questions}`);
ok(s1.data.saved === s1.data.prices.question,
   `оценка выросла ровно на цену консультации: ${s1.data.saved}`);

/* Сохраняем расчёт — растёт другой счётчик. */
await call("/api/saved", {
  method: "POST", token: t,
  body: { kind: "vat", title: "НДС по счёту", inputs: { vtSum: "120000" }, summary: "20 000 ₽" },
});
const s2 = await call("/api/summary", { token: t });
ok(s2.data.stats.savedCalcs === 1, "сохранённый расчёт посчитан");

console.log("\n— Достижения —");
ok(Array.isArray(s2.data.badges) && s2.data.badges.length >= 10,
   `достижений всего: ${s2.data.badges.length}`);
const firstQ = s2.data.badges.find(x => x.id === "first_q");
ok(firstQ && firstQ.done === true, "«Первый вопрос» получено после первого вопроса");
const q50 = s2.data.badges.find(x => x.id === "q50");
ok(q50 && q50.done === false && q50.need === 50, "далёкое достижение показывает, сколько осталось");
ok(s2.data.earned >= 2, `получено достижений: ${s2.data.earned} из ${s2.data.total}`);

const anonSum = await call("/api/summary");
ok(anonSum.status === 401, "без входа сводка недоступна");

console.log("\n— Чужие цифры в свою сводку не попадают —");
const s3 = await call("/api/summary", { token: t2 });
ok(s3.data.stats.questions === 0, "у постороннего свои нули, а не чужие цифры");

/* Убираем за собой. */
for (const tb of ["saved_calcs", "ai_jobs", "sessions", "usage", "actions",
                  "reminders", "payments", "notifications"]) {
  try { await sql(`DELETE FROM ${tb} WHERE email LIKE '%${st}@test.ru'`); } catch {}
}
await sql(`DELETE FROM users WHERE email LIKE '%${st}@test.ru'`);

console.log(`\nИТОГО: ${pass} пройдено, ${fail} провалено\n`);
process.exit(fail ? 1 : 0);
