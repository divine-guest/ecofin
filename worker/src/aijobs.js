/* ============ Фоновые задачи ИИ ============

   Раньше ответ жил только в открытой вкладке: перешёл на другую
   страницу — запрос оборвался, а вопрос пропал, потому что в историю
   он записывался вместе с ответом.

   Теперь вопрос сразу становится задачей на сервере. Браузер получает
   номер задачи и отпускает страницу; воркер дописывает ответ через
   ctx.waitUntil() — это штатный способ доделать работу после того, как
   ответ уже ушёл клиенту. Любая страница может спросить «что там с
   задачей N» и получить готовый ответ, даже если вкладку закрывали.   */

import { json, fail } from "./lib.js";
import { spendAI, spendTool } from "./quota.js";
import { callProvider, DEFAULT_SYSTEM, MODEL_FOR } from "./ai.js";
import { logAction } from "./auth.js";
import { rewardIfEarned } from "./referral.js";

const MAX_PROMPT = 12000;
const MAX_SYSTEM = 4000;

/* Задачи старше суток не нужны: ответ давно прочитан или уже неактуален. */
const KEEP_MS = 24 * 3600 * 1000;

const newId = () => {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return [...a].map(b => b.toString(16).padStart(2, "0")).join("");
};

const now = () => Date.now();

/* Ряд задачи в том виде, в каком его ждёт браузер. */
const publicJob = row => ({
  id: row.id,
  kind: row.kind,
  prompt: row.prompt,
  status: row.status,
  answer: row.answer || "",
  error: row.error || "",
  createdAt: row.created_at,
});

/* Сама работа. Выполняется уже после того, как браузер получил номер. */
async function work(env, id, email, kind, fullPrompt, system, maxTokens) {
  try {
    const text = await callProvider(env, {
      model: MODEL_FOR(env, kind),
      messages: [
        { role: "system", content: system },
        { role: "user", content: fullPrompt },
      ],
      maxTokens,
    });
    await env.DB.prepare(
      "UPDATE ai_jobs SET status = 'done', answer = ?, done_at = ? WHERE id = ?"
    ).bind(text, now(), id).run();
    await logAction(env, email, kind === "tool" ? "ИИ-инструмент" : "Вопрос консультанту");
  } catch (e) {
    /* Ошибку тоже сохраняем: иначе браузер будет опрашивать вечно. */
    await env.DB.prepare(
      "UPDATE ai_jobs SET status = 'error', error = ?, done_at = ? WHERE id = ?"
    ).bind(String(e.message || e).slice(0, 500), now(), id).run().catch(() => {});
  }
}

/* POST /api/ai/ask — поставить вопрос в очередь.
   Лимит списывается здесь же: если человек не может спросить, задача
   не создаётся вовсе. */
export async function ask(request, env, origin, user, ctx) {
  const b = await request.json().catch(() => ({}));
  const kind = b.kind === "tool" ? "tool" : "chat";

  /* prompt — то, что человек увидит в истории; context — то, что уходит
     модели (с предыдущими репликами). Разделяем, чтобы в переписке не
     показывать служебную обвязку. */
  const prompt = String(b.prompt || "").slice(0, MAX_PROMPT).trim();
  const context = String(b.context || prompt).slice(0, MAX_PROMPT);
  const system = String(b.system || DEFAULT_SYSTEM).slice(0, MAX_SYSTEM);
  const maxTokens = Math.min(3000, Math.max(200, Number(b.maxTokens) || 1500));

  if (!prompt) return fail(env, origin, "Пустой запрос");

  const spent = kind === "tool" ? await spendTool(env, user) : await spendAI(env, user);
  if (!spent) {
    return json(env, origin, {
      error: kind === "tool"
        ? "Пробный запуск израсходован. Инструменты без ограничений — в тарифе «Базовый» за 290 ₽ в месяц"
        : "На сегодня вопросы закончились. В тарифе «Базовый» их 300 в день — это 290 ₽ в месяц",
      paywall: true, kind,
    }, 402);
  }

  const id = newId();
  await env.DB.prepare(
    "INSERT INTO ai_jobs (id, email, kind, prompt, status, created_at) VALUES (?, ?, ?, ?, 'pending', ?)"
  ).bind(id, user.email, kind, prompt, now()).run();

  /* Работа продолжается после ответа браузеру — в этом весь смысл. */
  ctx.waitUntil(work(env, id, user.email, kind, context, system, maxTokens));
  ctx.waitUntil(rewardIfEarned(env, user.email).catch(() => {}));
  ctx.waitUntil(
    env.DB.prepare("DELETE FROM ai_jobs WHERE created_at < ?")
      .bind(now() - KEEP_MS).run().catch(() => {})
  );

  return json(env, origin, { id, status: "pending" }, 202);
}

/* GET /api/ai/job?id=... — что с конкретной задачей. */
export async function status(request, env, origin, user) {
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!id) return fail(env, origin, "Не указана задача");

  const row = await env.DB.prepare(
    "SELECT * FROM ai_jobs WHERE id = ? AND email = ?"
  ).bind(id, user.email).first();

  /* Чужую задачу не покажем даже случайно: выборка ограничена почтой. */
  if (!row) return fail(env, origin, "Задача не найдена", 404);
  return json(env, origin, { job: publicJob(row) });
}

/* GET /api/ai/jobs — незавершённые и недавно завершённые задачи.
   Нужно, чтобы любая страница при открытии подхватила ответ на вопрос,
   заданный на другой странице. */
export async function list(request, env, origin, user) {
  const rows = await env.DB.prepare(
    `SELECT * FROM ai_jobs WHERE email = ? AND created_at > ?
     ORDER BY created_at ASC LIMIT 20`
  ).bind(user.email, now() - KEEP_MS).all();
  return json(env, origin, { jobs: (rows.results || []).map(publicJob) });
}
