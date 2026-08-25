/* ============ Сохранённые расчёты ============

   Человек считает налоговую нагрузку, закрывает вкладку — и всё
   пропадает. Через месяц считает то же самое заново, с теми же
   цифрами. Сохранённый расчёт возвращает его в кабинет и делает
   калькулятор частью сервиса, а не разовым виджетом.

   Храним не результат, а исходные данные: ставки меняются, и старая
   сумма через год будет враньём. При открытии расчёт пересчитывается
   по текущим ставкам — заодно человек видит, что изменилось.        */

import { json, fail, now } from "./lib.js";

const MAX_SAVED = 50;          // больше человек всё равно не разберёт
const KINDS = ["regimes", "salary", "ipfee", "vat", "fee", "penalty",
               "vacation", "sick", "dividends", "deduction"];

const publicRow = r => ({
  id: r.id,
  kind: r.kind,
  title: r.title,
  inputs: JSON.parse(r.inputs || "{}"),
  summary: r.summary,
  createdAt: r.created_at,
});

/* GET /api/saved — что человек сохранял. */
export async function list(request, env, origin, user) {
  const rows = await env.DB.prepare(
    "SELECT * FROM saved_calcs WHERE email = ? ORDER BY created_at DESC LIMIT ?"
  ).bind(user.email, MAX_SAVED).all();
  return json(env, origin, { items: (rows.results || []).map(publicRow) });
}

/* POST /api/saved {kind, title, inputs, summary} */
export async function save(request, env, origin, user) {
  const b = await request.json().catch(() => ({}));
  const kind = KINDS.includes(b.kind) ? b.kind : null;
  if (!kind) return fail(env, origin, "Неизвестный расчёт");

  const title = String(b.title || "").trim().slice(0, 100) || "Расчёт";
  const summary = String(b.summary || "").trim().slice(0, 300);
  let inputs;
  try {
    inputs = JSON.stringify(b.inputs || {});
    if (inputs.length > 2000) return fail(env, origin, "Слишком много данных");
  } catch { return fail(env, origin, "Не разобрал данные расчёта"); }

  /* Держим потолок: старое вытесняется, а не копится бесконечно. */
  const cnt = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM saved_calcs WHERE email = ?"
  ).bind(user.email).first();
  if ((cnt?.n || 0) >= MAX_SAVED) {
    await env.DB.prepare(
      `DELETE FROM saved_calcs WHERE id = (
         SELECT id FROM saved_calcs WHERE email = ? ORDER BY created_at ASC LIMIT 1)`
    ).bind(user.email).run();
  }

  await env.DB.prepare(
    "INSERT INTO saved_calcs (email, kind, title, inputs, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(user.email, kind, title, inputs, summary, now()).run();

  const rows = await env.DB.prepare(
    "SELECT * FROM saved_calcs WHERE email = ? ORDER BY created_at DESC LIMIT 1"
  ).bind(user.email).first();
  return json(env, origin, { item: publicRow(rows) });
}

/* POST /api/saved/delete {id} */
export async function remove(request, env, origin, user) {
  const b = await request.json().catch(() => ({}));
  const id = Number(b.id) || 0;
  const res = await env.DB.prepare(
    "DELETE FROM saved_calcs WHERE id = ? AND email = ?"
  ).bind(id, user.email).run();
  /* Условие по почте — не украшение: без него чужой расчёт удалялся бы
     по одному номеру. */
  if (!res.meta || res.meta.changes === 0) return fail(env, origin, "Расчёт не найден", 404);
  return json(env, origin, { ok: true });
}

/* GET /api/ai/history — вопросы к консультанту с ответами.

   Переписка живёт в браузере, поэтому теряется при смене устройства и
   при чистке кэша. На сервере уже лежат готовые задачи ИИ — отдаём их
   как историю: «я спрашивал про это месяц назад» перестаёт быть
   безнадёжным. */
export async function aiHistory(request, env, origin, user) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 30));

  const where = ["email = ?", "status = 'done'"];
  const bind = [user.email];
  if (q) { where.push("(lower(prompt) LIKE ? OR lower(answer) LIKE ?)"); bind.push(`%${q}%`, `%${q}%`); }

  const rows = await env.DB.prepare(
    `SELECT id, kind, prompt, answer, created_at FROM ai_jobs
      WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT ?`
  ).bind(...bind, limit).all();

  return json(env, origin, {
    items: (rows.results || []).map(r => ({
      id: r.id, kind: r.kind, question: r.prompt,
      answer: r.answer, createdAt: r.created_at,
    })),
  });
}
