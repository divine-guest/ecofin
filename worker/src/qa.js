/* ============ Публичная лента вопросов и ответов ============

   Ответ консультанта сейчас виден одному человеку и исчезает.
   Опубликованный работает дальше: отвечает следующему, кто искал то же
   самое, и приводит людей из поиска. Контент растёт сам.

   Почему это, а не переписка между людьми: на сервисе о праве и деньгах
   личные сообщения — источник неприятностей. Люди раздают друг другу
   неверные советы, приходят те, кто «решает вопросы» за деньги, а
   владельцу достаётся модерация и ответственность. Здесь отвечает
   консультант, а люди читают — вся польза сообщества без его рисков.

   Два правила, без которых это было бы опасно:
   • публикация только по прямому согласию автора — в вопросы вставляют
     суммы, имена и реквизиты;
   • сначала проверка владельцем, потом публикация. Имя автора не
     хранится в ленте и не показывается никогда.                       */

import { json, fail, now } from "./lib.js";

const MAX_Q = 1000;
const MAX_A = 8000;

/* Темы задаются списком: свободный ввод превратил бы ленту в свалку. */
export const QA_TOPICS = [
  "Налоги", "Договоры", "Работники", "ИП и ООО",
  "Самозанятость", "Проверки и штрафы", "Деньги и счета", "Общее",
];

const publicRow = r => ({
  id: r.id,
  question: r.question,
  answer: r.answer,
  topic: r.topic,
  useful: r.useful,
  views: r.views,
  createdAt: r.created_at,
});

/* POST /api/qa/offer {jobId} — предложить свой ответ в ленту.
   Берём вопрос и ответ из задачи ИИ, а не из тела запроса: иначе в
   ленту можно было бы подсунуть любой текст от имени консультанта. */
export async function offer(request, env, origin, user) {
  const b = await request.json().catch(() => ({}));
  const jobId = String(b.jobId || "");
  const topic = QA_TOPICS.includes(b.topic) ? b.topic : "Общее";

  const job = await env.DB.prepare(
    "SELECT * FROM ai_jobs WHERE id = ? AND email = ? AND status = 'done'"
  ).bind(jobId, user.email).first();
  if (!job) return fail(env, origin, "Ответ не найден", 404);

  const dup = await env.DB.prepare(
    "SELECT id FROM public_qa WHERE email = ? AND question = ?"
  ).bind(user.email, job.prompt.slice(0, MAX_Q)).first();
  if (dup) return json(env, origin, { ok: true, already: true });

  await env.DB.prepare(
    `INSERT INTO public_qa (email, question, answer, topic, status, created_at)
     VALUES (?, ?, ?, ?, 'pending', ?)`
  ).bind(user.email, job.prompt.slice(0, MAX_Q), job.answer.slice(0, MAX_A), topic, now()).run();

  return json(env, origin, { ok: true, pending: true });
}

/* GET /api/qa — лента. Открыта всем, в том числе поисковикам:
   в этом весь смысл. */
export async function list(request, env, origin) {
  const url = new URL(request.url);
  const topic = url.searchParams.get("topic") || "";
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit")) || 20));
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);

  const where = ["status = 'published'"];
  const bind = [];
  if (topic && QA_TOPICS.includes(topic)) { where.push("topic = ?"); bind.push(topic); }
  if (q) { where.push("(lower(question) LIKE ? OR lower(answer) LIKE ?)"); bind.push(`%${q}%`, `%${q}%`); }

  const rows = await env.DB.prepare(
    `SELECT * FROM public_qa WHERE ${where.join(" AND ")}
      ORDER BY useful DESC, created_at DESC LIMIT ? OFFSET ?`
  ).bind(...bind, limit, offset).all();

  const total = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM public_qa WHERE ${where.join(" AND ")}`
  ).bind(...bind).first();

  return json(env, origin, {
    items: (rows.results || []).map(publicRow),
    total: total ? total.n : 0,
    topics: QA_TOPICS,
  });
}

/* GET /api/qa/one?id= — один ответ целиком, для отдельной ссылки. */
export async function one(request, env, origin) {
  const id = Number(new URL(request.url).searchParams.get("id")) || 0;
  const row = await env.DB.prepare(
    "SELECT * FROM public_qa WHERE id = ? AND status = 'published'"
  ).bind(id).first();
  if (!row) return fail(env, origin, "Ответ не найден", 404);

  await env.DB.prepare("UPDATE public_qa SET views = views + 1 WHERE id = ?").bind(id).run();
  return json(env, origin, { item: publicRow(row) });
}

/* POST /api/qa/useful {id} — «помогло». Один голос от человека. */
export async function useful(request, env, origin, user) {
  const b = await request.json().catch(() => ({}));
  const id = Number(b.id) || 0;

  const already = await env.DB.prepare(
    "SELECT qa_id FROM qa_useful WHERE qa_id = ? AND email = ?"
  ).bind(id, user.email).first();
  if (already) return json(env, origin, { ok: true, already: true });

  const row = await env.DB.prepare(
    "SELECT id FROM public_qa WHERE id = ? AND status = 'published'"
  ).bind(id).first();
  if (!row) return fail(env, origin, "Ответ не найден", 404);

  await env.DB.prepare("INSERT INTO qa_useful (qa_id, email, at) VALUES (?, ?, ?)")
    .bind(id, user.email, now()).run();
  await env.DB.prepare("UPDATE public_qa SET useful = useful + 1 WHERE id = ?").bind(id).run();
  return json(env, origin, { ok: true });
}

/* ---------- Для владельца ---------- */

/* GET /api/admin/qa — что ждёт проверки. */
export async function pending(request, env, origin) {
  const rows = await env.DB.prepare(
    "SELECT * FROM public_qa WHERE status = 'pending' ORDER BY created_at ASC LIMIT 50"
  ).all();
  const count = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM public_qa WHERE status = 'pending'"
  ).first();
  /* Здесь почта видна: владелец должен понимать, кого спрашивать,
     если в вопросе окажется лишнее. В публичную ленту она не уходит. */
  return json(env, origin, {
    items: (rows.results || []).map(r => ({ ...publicRow(r), email: r.email })),
    total: count ? count.n : 0,
  });
}

/* POST /api/admin/qa {id, action, question, topic} — решение по вопросу.
   Текст можно поправить перед публикацией: убрать лишнее из вопроса
   или переформулировать его под то, как люди ищут. */
export async function decide(request, env, origin, admin) {
  const b = await request.json().catch(() => ({}));
  const id = Number(b.id) || 0;
  const action = b.action === "publish" ? "published" : "rejected";

  const row = await env.DB.prepare("SELECT * FROM public_qa WHERE id = ?").bind(id).first();
  if (!row) return fail(env, origin, "Вопрос не найден", 404);

  const question = b.question ? String(b.question).slice(0, MAX_Q) : row.question;
  const topic = QA_TOPICS.includes(b.topic) ? b.topic : row.topic;

  await env.DB.prepare(
    `UPDATE public_qa SET status = ?, question = ?, topic = ?, decided_at = ?, decided_by = ?
      WHERE id = ?`
  ).bind(action, question, topic, now(), admin.email, id).run();

  return json(env, origin, { ok: true, status: action });
}
