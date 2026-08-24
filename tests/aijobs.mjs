/* Фоновые задачи ИИ.

   Проверяем ровно то, на что жаловался владелец: вопрос должен
   пережить уход со страницы. Плюс границы — чужую задачу видеть
   нельзя, лимит должен списываться до постановки в очередь. */

const API = "https://pravofin-api.pravofin.workers.dev";
const O = "https://divine-guest.github.io";
import { makeAdmin, cleanup, sql } from "./_admin.mjs";

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

console.log("\n— Вопрос переживает уход со страницы —");
const em = `bg${st}@test.ru`;
const reg = await call("/api/auth/register", {
  method: "POST", body: { name: "Фоновый Тест", email: em, password: "parol12345" },
});
const t = reg.data.token;

const t0 = Date.now();
const asked = await call("/api/ai/ask", {
  method: "POST", token: t,
  body: { kind: "chat", prompt: "Что такое УСН?", maxTokens: 200 },
});
const held = Date.now() - t0;

ok(asked.status === 202, `задача принята, код ${asked.status}`);
ok(Boolean(asked.data.id), "выдан номер задачи");
ok(asked.data.status === "pending", "статус: в работе");
ok(held < 5000, `браузер отпущен за ${held} мс — не ждёт ответа`);

const id = asked.data.id;

console.log("\n— Вопрос виден с «другой страницы» —");
const list = await call("/api/ai/jobs", { token: t });
const mine = (list.data.jobs || []).find(j => j.id === id);
ok(Boolean(mine), "задача есть в списке незавершённых");
ok(mine?.prompt === "Что такое УСН?", "вопрос сохранён целиком");

console.log("\n— Ответ дожидается —");
let done = null;
for (let i = 0; i < 30; i++) {
  await new Promise(r => setTimeout(r, 2000));
  const s = await call("/api/ai/job?id=" + id, { token: t });
  if (s.data.job && s.data.job.status !== "pending") { done = s.data.job; break; }
}
ok(done !== null, "задача завершилась за отведённое время");
ok(done?.status === "done", `статус: ${done?.status}`, done?.error || "");
ok((done?.answer || "").length > 30, `ответ пришёл, ${(done?.answer || "").length} символов`);

console.log("\n— Чужое не показываем —");
const other = await call("/api/auth/register", {
  method: "POST", body: { name: "Чужой", email: `oth${st}@test.ru`, password: "parol12345" },
});
const peek = await call("/api/ai/job?id=" + id, { token: other.data.token });
ok(peek.status === 404, "чужая задача не отдаётся");
const anon = await call("/api/ai/job?id=" + id);
ok(anon.status === 401, "без входа задачу не посмотреть");

console.log("\n— Лимит списывается до постановки в очередь —");
/* У бесплатного тарифа 3 вопроса в день. Четвёртый не должен создать
   задачу вовсе — иначе лимит обходился бы через очередь. */
const q0 = await call("/api/quota", { token: t });
const left = q0.data.ai.left;
for (let i = 0; i < left; i++) {
  await call("/api/ai/ask", { method: "POST", token: t,
    body: { kind: "chat", prompt: "ещё вопрос " + i, maxTokens: 60 } });
}
const over = await call("/api/ai/ask", {
  method: "POST", token: t, body: { kind: "chat", prompt: "сверх лимита", maxTokens: 60 },
});
ok(over.status === 402, `сверх лимита — отказ, код ${over.status}`);
ok(over.data.paywall === true, "отказ помечен как пейволл");
ok(/Базовый/.test(over.data.error || ""), "в отказе назван «Базовый», а не «Про»",
   over.data.error);

const after = await sql(`SELECT COUNT(*) AS n FROM ai_jobs WHERE email = '${em}'`);
ok(Number(after[0].n) === 1 + left, `задач создано ровно по лимиту: ${after[0].n}`);

console.log("\n— Пустой вопрос —");
const empty = await call("/api/ai/ask", {
  method: "POST", token: t, body: { kind: "chat", prompt: "   " },
});
ok(empty.status === 400, "пустой вопрос отклонён");

/* Убираем за собой. */
await sql(`DELETE FROM ai_jobs WHERE email LIKE '%${st}@test.ru'`);

console.log(`\nИТОГО: ${pass} пройдено, ${fail} провалено\n`);
process.exit(fail ? 1 : 0);
