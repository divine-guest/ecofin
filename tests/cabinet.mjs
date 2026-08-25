/* Кабинет: сохранённые расчёты и история вопросов.

   Обе вещи хранят личное, поэтому границы важнее функций: чужой расчёт
   не открыть и не удалить, чужие вопросы не прочитать. */

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
const em = `cb${st}@test.ru`;
const em2 = `cb2${st}@test.ru`;

console.log("\n— Подготовка —");
const a = await call("/api/auth/register", {
  method: "POST", body: { name: "Хозяин Расчётов", email: em, password: "parol12345" },
});
const b = await call("/api/auth/register", {
  method: "POST", body: { name: "Посторонний", email: em2, password: "parol12345" },
});
const t = a.data.token, t2 = b.data.token;
ok(Boolean(t && t2), "два аккаунта заведены");

console.log("\n— Пустой кабинет —");
const empty = await call("/api/saved", { token: t });
ok((empty.data.items || []).length === 0, "расчётов пока нет");

console.log("\n— Сохранение расчёта —");
const saved = await call("/api/saved", {
  method: "POST", token: t,
  body: { kind: "salary", title: "Зарплата Иванова",
          inputs: { slGross: "80000", slKids: "1", slSmall: "1" },
          summary: "На руки 69 600 ₽" },
});
ok(saved.status === 200, `сохранён, код ${saved.status}`);
ok(saved.data.item.title === "Зарплата Иванова", "название сохранилось");
ok(saved.data.item.inputs.slGross === "80000", "исходные данные сохранились");

const list = await call("/api/saved", { token: t });
ok(list.data.items.length === 1, "виден в списке");

console.log("\n— Выдуманный вид расчёта не принимается —");
const bad = await call("/api/saved", {
  method: "POST", token: t, body: { kind: "vydumannyj", title: "х", inputs: {}, summary: "" },
});
ok(bad.status === 400, `отклонён, код ${bad.status}`);

console.log("\n— Чужие расчёты недоступны —");
const other = await call("/api/saved", { token: t2 });
ok((other.data.items || []).length === 0, "посторонний не видит чужих расчётов");

const id = saved.data.item.id;
const steal = await call("/api/saved/delete", { method: "POST", token: t2, body: { id } });
ok(steal.status === 404, `чужой расчёт не удалить, код ${steal.status}`);
const stillThere = await call("/api/saved", { token: t });
ok(stillThere.data.items.length === 1, "расчёт на месте");

const anon = await call("/api/saved");
ok(anon.status === 401, "без входа список не отдаётся");

console.log("\n— История вопросов —");
const asked = await call("/api/ai/ask", {
  method: "POST", token: t,
  body: { kind: "chat", prompt: "Какой срок исковой давности по договору?", maxTokens: 150 },
});
for (let i = 0; i < 30; i++) {
  await new Promise(r => setTimeout(r, 2000));
  const s = await call("/api/ai/job?id=" + asked.data.id, { token: t });
  if (s.data.job?.status !== "pending") break;
}

const hist = await call("/api/ai/history", { token: t });
const found = (hist.data.items || []).find(x => x.question.includes("исковой давности"));
ok(Boolean(found), "вопрос попал в историю");
ok((found?.answer || "").length > 30, "ответ сохранён целиком");

const search = await call("/api/ai/history?q=давности", { token: t });
ok((search.data.items || []).some(x => x.id === found.id), "поиск по слову находит");

const noMatch = await call("/api/ai/history?q=zzznetakogo", { token: t });
ok((noMatch.data.items || []).length === 0, "поиск без совпадений пуст");

console.log("\n— Чужую историю не прочитать —");
const hist2 = await call("/api/ai/history", { token: t2 });
ok(!(hist2.data.items || []).some(x => x.question.includes("исковой давности")),
   "посторонний не видит чужих вопросов");
const histAnon = await call("/api/ai/history");
ok(histAnon.status === 401, "без входа история недоступна");

console.log("\n— Удаление своего расчёта —");
const del = await call("/api/saved/delete", { method: "POST", token: t, body: { id } });
ok(del.status === 200, "свой расчёт удаляется");
const after = await call("/api/saved", { token: t });
ok(after.data.items.length === 0, "список опустел");

/* Убираем за собой. */
for (const tb of ["saved_calcs", "ai_jobs", "sessions", "usage", "actions"]) {
  try { await sql(`DELETE FROM ${tb} WHERE email LIKE '%${st}@test.ru'`); } catch {}
}
await sql(`DELETE FROM users WHERE email LIKE '%${st}@test.ru'`);

console.log(`\nИТОГО: ${pass} пройдено, ${fail} провалено\n`);
process.exit(fail ? 1 : 0);
