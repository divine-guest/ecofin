/* ============ Фоновые задачи ИИ ============

   Раньше ответ жил только в открытой вкладке: перешёл на другую
   страницу — запрос оборвался, а вопрос пропал, потому что в историю
   он записывался вместе с ответом.

   Теперь вопрос сразу становится задачей на сервере. Браузер получает
   номер задачи и отпускает страницу; работа доделывается через
   ctx.waitUntil() — штатный способ продолжить после того, как ответ
   уже ушёл клиенту.

   Но waitUntil — не гарантия: исполнение может оборваться, и тогда
   задача осталась бы в pending навсегда, без ответа и без ошибки.
   Поэтому у каждой попытки есть аренда: если она молчит дольше
   LEASE_MS, следующий опрос со стороны браузера перезапускает работу.
   После MAX_TRIES попыток задача честно помечается ошибкой — человек
   видит сообщение, а не бесконечное ожидание.                        */

import { json, fail } from "./lib.js";
import { spendAI, spendTool } from "./quota.js";
import { callProvider, DEFAULT_SYSTEM, MODEL_FOR } from "./ai.js";
import { logAction } from "./auth.js";
import { rewardIfEarned } from "./referral.js";

const MAX_PROMPT = 12000;
const MAX_SYSTEM = 4000;

/* Незавершённые и сорвавшиеся задачи старше суток не нужны — они уже
   ничего не ждут. А готовые ответы теперь история вопросов в кабинете:
   держим их три месяца, иначе «я спрашивал про это месяц назад»
   упирается в пустоту. */
const KEEP_MS = 24 * 3600 * 1000;
const KEEP_DONE_MS = 90 * 24 * 3600 * 1000;

/* Сколько ждём молчащую попытку, прежде чем начать заново. Чуть больше
   таймаута обращения к провайдеру (60 с), чтобы не перезапускать то,
   что ещё честно работает. */
const LEASE_MS = 75000;

/* Больше трёх попыток смысла нет: дело не во временном сбое. */
const MAX_TRIES = 3;

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
async function work(env, row) {
  try {
    const text = await callProvider(env, {
      model: MODEL_FOR(env, row.kind),
      messages: [
        { role: "system", content: row.system || DEFAULT_SYSTEM },
        { role: "user", content: row.context || row.prompt },
      ],
      maxTokens: row.max_tokens || 1500,
    });
    await env.DB.prepare(
      "UPDATE ai_jobs SET status = 'done', answer = ?, done_at = ? WHERE id = ?"
    ).bind(text, now(), row.id).run();
    await logAction(env, row.email,
      row.kind === "tool" ? "ИИ-инструмент" : "Вопрос консультанту");
  } catch (e) {
    /* Ошибку сохраняем, только когда попытки исчерпаны: иначе временный
       сбой провайдера закрыл бы задачу навсегда. Пока попытки есть,
       оставляем pending — следующий опрос запустит её заново. */
    if ((row.tries || 0) >= MAX_TRIES) {
      await env.DB.prepare(
        "UPDATE ai_jobs SET status = 'error', error = ?, done_at = ? WHERE id = ?"
      ).bind(humanError(e), now(), row.id).run().catch(() => {});
    } else {
      /* Снимаем аренду, чтобы следующий опрос взялся сразу. */
      await env.DB.prepare("UPDATE ai_jobs SET claimed_at = NULL WHERE id = ?")
        .bind(row.id).run().catch(() => {});
    }
  }
}

function humanError(e) {
  if (e.name === "TimeoutError" || e.name === "AbortError")
    return "ИИ не ответил вовремя. Попробуйте спросить короче.";
  if (e.message === "empty")
    return "ИИ вернул пустой ответ. Попробуйте переформулировать вопрос.";
  if (e.status === 429)
    return "ИИ-провайдер перегружен. Попробуйте через минуту.";
  return "ИИ-провайдер недоступен. Попробуйте позже.";
}

/* Пытается забрать задачу себе. Возвращает свежий ряд, если удалось,
   иначе null — значит, над ней уже работает другая попытка.
   Условие в WHERE делает захват атомарным: две одновременные попытки
   не смогут обе изменить одну строку. */
async function claim(env, id) {
  const res = await env.DB.prepare(
    `UPDATE ai_jobs SET claimed_at = ?, tries = tries + 1
     WHERE id = ? AND status = 'pending'
       AND (claimed_at IS NULL OR claimed_at < ?)`
  ).bind(now(), id, now() - LEASE_MS).run();

  if (!res.meta || res.meta.changes !== 1) return null;
  return env.DB.prepare("SELECT * FROM ai_jobs WHERE id = ?").bind(id).first();
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
    `INSERT INTO ai_jobs (id, email, kind, prompt, context, system, max_tokens,
                          status, created_at, claimed_at, tries)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, 1)`
  ).bind(id, user.email, kind, prompt, context, system, maxTokens, now(), now()).run();

  /* Работа продолжается после ответа браузеру — в этом весь смысл.
     Если эта попытка не доживёт, её подхватит опрос. */
  const row = { id, email: user.email, kind, prompt, context, system,
                max_tokens: maxTokens, tries: 1 };
  ctx.waitUntil(work(env, row));
  ctx.waitUntil(rewardIfEarned(env, user.email).catch(() => {}));
  ctx.waitUntil(
    env.DB.prepare("DELETE FROM ai_jobs WHERE created_at < ? AND status != 'done'")
      .bind(now() - KEEP_MS).run().catch(() => {})
  );
  ctx.waitUntil(
    env.DB.prepare("DELETE FROM ai_jobs WHERE created_at < ? AND status = 'done'")
      .bind(now() - KEEP_DONE_MS).run().catch(() => {})
  );

  return json(env, origin, { id, status: "pending" }, 202);
}

/* GET /api/ai/job?id=... — что с конкретной задачей.
   Заодно чинит зависшие: если прошлая попытка молчит дольше аренды,
   запускаем работу заново прямо отсюда. */
export async function status(request, env, origin, user, ctx) {
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!id) return fail(env, origin, "Не указана задача");

  const row = await env.DB.prepare(
    "SELECT * FROM ai_jobs WHERE id = ? AND email = ?"
  ).bind(id, user.email).first();

  /* Чужую задачу не покажем даже случайно: выборка ограничена почтой. */
  if (!row) return fail(env, origin, "Задача не найдена", 404);

  if (row.status === "pending") await revive(env, ctx, row);
  return json(env, origin, { job: publicJob(row) });
}

/* Перезапуск подвисшей задачи. Вынесен отдельно, потому что нужен и при
   опросе одной задачи, и при получении списка. */
async function revive(env, ctx, row) {
  const stale = !row.claimed_at || row.claimed_at < now() - LEASE_MS;
  if (!stale) return;

  if ((row.tries || 0) >= MAX_TRIES) {
    await env.DB.prepare(
      "UPDATE ai_jobs SET status = 'error', error = ?, done_at = ? WHERE id = ?"
    ).bind("Не удалось получить ответ. Попробуйте спросить ещё раз.", now(), row.id)
      .run().catch(() => {});
    row.status = "error";
    row.error = "Не удалось получить ответ. Попробуйте спросить ещё раз.";
    return;
  }

  const fresh = await claim(env, row.id);
  if (fresh && ctx) ctx.waitUntil(work(env, fresh));
}

/* GET /api/ai/jobs — незавершённые и недавно завершённые задачи.
   Нужно, чтобы любая страница при открытии подхватила ответ на вопрос,
   заданный на другой странице. */
export async function list(request, env, origin, user, ctx) {
  const rows = await env.DB.prepare(
    `SELECT * FROM ai_jobs WHERE email = ? AND created_at > ?
     ORDER BY created_at ASC LIMIT 20`
  ).bind(user.email, now() - KEEP_MS).all();

  const jobs = rows.results || [];
  /* Открытие любой страницы — повод оживить всё, что подвисло. */
  for (const r of jobs) {
    if (r.status === "pending") await revive(env, ctx, r);
  }
  return json(env, origin, { jobs: jobs.map(publicJob) });
}
