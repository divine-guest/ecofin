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
               "vacation", "sick", "dividends", "deduction",
               /* Расчёты, добавленные в калькулятор позже: пени по налогам
                  (ст. 75 НК), проценты за пользование чужими деньгами
                  (ст. 395 ГК), компенсация за задержку зарплаты (ст. 236 ТК),
                  расчёт при увольнении и НДС на упрощёнке. */
               "taxpen", "gk395", "wagedelay", "dismissal", "usnvat"];

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

/* ---------- Заметки ----------
   Место, чтобы записать «спросить бухгалтера про патент» или реквизиты
   контрагента. Сейчас люди пишут это себе в мессенджер и теряют. */

const MAX_NOTE = 4000;

/* GET /api/notes */
export async function notes(request, env, origin, user) {
  return json(env, origin, { text: user.notes || "", updatedAt: user.notes_at || 0 });
}

/* POST /api/notes {text} */
export async function saveNotes(request, env, origin, user) {
  const b = await request.json().catch(() => ({}));
  const text = String(b.text || "").slice(0, MAX_NOTE);
  await env.DB.prepare("UPDATE users SET notes = ?, notes_at = ? WHERE email = ?")
    .bind(text, now(), user.email).run();
  return json(env, origin, { ok: true, updatedAt: now() });
}

/* ---------- Профиль компетенций ---------- */

const COMP_AREAS = ["tax", "contracts", "finance", "accounting", "labor"];

/* GET /api/competencies */
export async function comp(request, env, origin, user) {
  let data = {};
  try { data = JSON.parse(user.competencies || "{}"); } catch {}
  const out = {};
  for (const a of COMP_AREAS) out[a] = Math.min(100, Math.max(0, Number(data[a]) || 0));
  return json(env, origin, { areas: out });
}

/* POST /api/competencies {areas} — синхронизация.

   Берём максимум из присланного и сохранённого: значения только
   растут. Это решает две задачи сразу — работа с двух устройств
   ничего не теряет, и обнулить чужой прогресс подделкой запроса
   нельзя. */
export async function saveComp(request, env, origin, user) {
  const b = await request.json().catch(() => ({}));
  const incoming = b.areas && typeof b.areas === "object" ? b.areas : {};

  let current = {};
  try { current = JSON.parse(user.competencies || "{}"); } catch {}

  const merged = {};
  for (const a of COMP_AREAS) {
    const was = Math.min(100, Math.max(0, Number(current[a]) || 0));
    const now = Math.min(100, Math.max(0, Number(incoming[a]) || 0));
    merged[a] = Math.max(was, now);
  }

  await env.DB.prepare("UPDATE users SET competencies = ? WHERE email = ?")
    .bind(JSON.stringify(merged), user.email).run();
  return json(env, origin, { areas: merged });
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
