/* ============ ЭкоФин — мои документы ============

   Что это меняет.

   Созданный счёт или акт раньше жил в localStorage браузера: терялся
   при чистке, не открывался с телефона и ничего не знал об учёте.
   Человек выставлял счёт и через месяц не помнил, оплатили его или
   нет, — а это и есть главный вопрос про счёт.

   Здесь документ становится записью: номер, дата, контрагент, сумма,
   состояние. Отметка «оплачен» сама заносит поступление в «Моё дело»,
   и оттуда сумма попадает в расчёт налога. Библиотека документов
   перестаёт быть генератором текста и становится частью учёта — то
   есть тем, ради чего возвращаются, а не тем, чем пользуются один раз.

   Снятие отметки убирает и запись учёта. Без этого выручка удвоилась
   бы при первой же исправленной ошибке, а узнал бы об этом человек
   уже из налога.                                                    */

import { json, fail, now, isPro } from "./lib.js";
import { logAction } from "./auth.js";
import { resolveClient } from "./clients.js";

/* Предел на аккаунт: живое дело даёт несколько сотен бумаг в год. */
const MAX_DOCS = 5000;

/* Сколько документов хранит бесплатный тариф.

   Двадцать, а не три: история имеет смысл, только когда в ней можно
   что-то найти. Три документа — это не история, и платить за её
   продолжение никто не станет. Платят, когда за полгода накопилось
   семьдесят бумаг и они уже свои.                                   */
const FREE_DOCS = 20;

const STATUSES = ["draft", "issued", "paid", "cancelled"];
const MAX_CONTENT = 60000;

const out = r => ({
  id: r.id,
  kind: r.kind,
  title: r.title,
  number: r.number,
  date: r.doc_date,
  party: r.party,
  amount: r.amount / 100,
  status: r.status,
  orgId: r.org_id,
  clientId: r.client_id,
  createdAt: r.created_at,
  paidAt: r.paid_at || null,
  bookOpId: r.book_op_id || null,
});

const day = s => /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";

/* Сумма приходит в рублях, храним в копейках целым числом — как и в
   учёте. Дробные рубли копят ошибку округления, и годовой итог
   начинает расходиться с ручным подсчётом. */
function kopecks(v) {
  const rub = Number(v);
  if (!Number.isFinite(rub) || rub < 0 || rub > 1e11) return 0;
  return Math.round(rub * 100);
}

/* Дата в часовом поясе человека: «сегодня» в Калининграде и во
   Владивостоке — разные сутки, и поступление не должно попасть
   в чужой день, а с ним и в чужой квартал. */
function todayFor(user) {
  const tz = user.tz_offset ?? 3;
  return new Date(Date.now() + tz * 3600000).toISOString().slice(0, 10);
}

/* Организация или человек. Точно мы не знаем — знаем только строку
   контрагента. По ней и судим: ИНН или «ООО», «ИП» в названии
   означают компанию. Ошибка здесь стоит денег только самозанятому
   (4% против 6%), и плательщика можно поправить руками в учёте. */
export function guessPayer(party) {
  const s = String(party || "");
  if (/\d{10,12}/.test(s)) return "company";
  if (/(^|\W)(ООО|ЗАО|ОАО|ПАО|АО|ИП|НКО|ГБУ|МБУ|ФГУП)(\W|$)/i.test(s)) return "company";
  return s.trim() ? "person" : "company";
}

/* ---------- Список ---------- */

export async function list(request, env, origin, user) {
  const u = new URL(request.url);
  const status = STATUSES.includes(u.searchParams.get("status")) ? u.searchParams.get("status") : "";
  const client = await resolveClient(env, user, u.searchParams.get("client"));
  if (client === null) return fail(env, origin, "Такого дела нет", 404);

  /* Содержимое в списке не отдаём: пятьдесят документов по паре
     десятков килобайт — это мегабайт на каждое открытие кабинета. */
  const sql =
    "SELECT id, kind, title, number, doc_date, party, amount, status," +
    "       org_id, client_id, created_at, paid_at, book_op_id" +
    "  FROM documents" +
    " WHERE email = ?1 AND client_id = ?2" +
    (status ? " AND status = ?3" : "") +
    " ORDER BY created_at DESC LIMIT 300";

  const args = status ? [user.email, client, status] : [user.email, client];
  const rows = await env.DB.prepare(sql).bind(...args).all();
  const all = (rows.results || []).map(out);

  /* Сколько денег ждёт оплаты — то, ради чего сюда и заходят. */
  const owed = all.filter(d => d.status === "issued").reduce((s, d) => s + d.amount, 0);

  return json(env, origin, {
    documents: all,
    owed,
    limit: isPro(user) ? null : FREE_DOCS,
    used: all.length,
  });
}

export async function one(request, env, origin, user) {
  const id = Number(new URL(request.url).searchParams.get("id"));
  const row = await env.DB.prepare("SELECT * FROM documents WHERE id = ? AND email = ?")
    .bind(id, user.email).first();
  if (!row) return fail(env, origin, "Документ не найден", 404);
  return json(env, origin, { document: { ...out(row), content: row.content } });
}

/* ---------- Сохранение ---------- */

export async function save(request, env, origin, user) {
  const b = await request.json().catch(() => ({}));
  const title = String(b.title || "").trim().slice(0, 200);
  const content = String(b.content || "").slice(0, MAX_CONTENT);
  if (title.length < 2) return fail(env, origin, "У документа должно быть название");

  const client = await resolveClient(env, user, b.client);
  if (client === null) return fail(env, origin, "Такого дела нет", 404);

  /* Правка уже сохранённого — по id. Отдельной ручки не заводим:
     «сохранить» с номером и без него отличается только этим. */
  if (b.id) {
    const row = await env.DB.prepare("SELECT * FROM documents WHERE id = ? AND email = ?")
      .bind(Number(b.id), user.email).first();
    if (!row) return fail(env, origin, "Документ не найден", 404);
    await env.DB.prepare(
      "UPDATE documents SET title = ?, number = ?, doc_date = ?, party = ?," +
      "       amount = ?, content = ? WHERE id = ? AND email = ?"
    ).bind(
      title,
      String(b.number ?? row.number).trim().slice(0, 40),
      day(String(b.date ?? row.doc_date)),
      String(b.party ?? row.party).trim().slice(0, 200),
      b.amount === undefined ? row.amount : kopecks(b.amount),
      content || row.content,
      row.id, user.email
    ).run();
    return json(env, origin, { id: row.id, updated: true });
  }

  const cnt = await env.DB.prepare("SELECT COUNT(*) AS n FROM documents WHERE email = ?")
    .bind(user.email).first();
  const count = cnt?.n || 0;
  if (count >= MAX_DOCS)
    return fail(env, origin, `Больше ${MAX_DOCS} документов не поддерживается`);

  /* Место кончилось — не отказываем, а вытесняем самый старый черновик.

     Отказ «у вас лимит» ровно в тот момент, когда человек нажал
     «сохранить», означает потерю только что сделанной работы. Это
     худшее, что можно сделать с бесплатным тарифом: обида остаётся,
     а желания платить не появляется. Выставленные и оплаченные не
     трогаем — они и есть та история, которая чего-то стоит. */
  let evicted = false;
  if (!isPro(user) && count >= FREE_DOCS) {
    const old = await env.DB.prepare(
      "SELECT id FROM documents WHERE email = ? AND status IN ('draft', 'cancelled')" +
      " ORDER BY created_at ASC LIMIT 1"
    ).bind(user.email).first();
    if (!old) {
      return json(env, origin, {
        error: `На бесплатном тарифе хранится ${FREE_DOCS} документов, и все они выставлены или оплачены. ` +
               "С подпиской Про история хранится целиком",
        paywall: true, kind: "documents",
      }, 402);
    }
    await env.DB.prepare("DELETE FROM documents WHERE id = ?").bind(old.id).run();
    evicted = true;
  }

  const status = STATUSES.includes(b.status) ? b.status : "draft";
  const res = await env.DB.prepare(
    "INSERT INTO documents (email, org_id, client_id, kind, title, number, doc_date," +
    "                       party, amount, status, content, created_at)" +
    " VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)"
  ).bind(
    user.email,
    Number(b.orgId) || 0,
    client,
    String(b.kind || "").trim().slice(0, 40),
    title,
    String(b.number || "").trim().slice(0, 40),
    day(String(b.date || "")),
    String(b.party || "").trim().slice(0, 200),
    kopecks(b.amount),
    status,
    content,
    now()
  ).run();

  await logAction(env, user.email, `Сохранён документ: ${title}`);
  return json(env, origin, { id: res.meta?.last_row_id, evicted }, 201);
}

/* ---------- Состояние ----------

   Здесь и происходит связь с учётом. Отметили «оплачен» — поступление
   попало в «Моё дело» и в расчёт налога. Сняли отметку — запись
   убралась. Иначе первая же исправленная ошибка удвоила бы выручку. */

export async function setStatus(request, env, origin, user) {
  const b = await request.json().catch(() => ({}));
  const id = Number(b.id);
  const status = STATUSES.includes(b.status) ? b.status : null;
  if (!status) return fail(env, origin, "Неизвестное состояние документа");

  const row = await env.DB.prepare("SELECT * FROM documents WHERE id = ? AND email = ?")
    .bind(id, user.email).first();
  if (!row) return fail(env, origin, "Документ не найден", 404);
  if (row.status === status) return json(env, origin, { ok: true, unchanged: true });

  let bookOp = row.book_op_id || 0;
  let added = false, removed = false;

  if (status === "paid" && !bookOp && row.amount > 0) {
    /* Нулевая сумма записи не даёт: ноль в книге доходов ничего не
       значит, а объяснять потом, откуда он взялся, придётся.
       Документ всё равно станет оплаченным. */
    const payDay = day(String(b.day || "")) || todayFor(user);
    const r = await env.DB.prepare(
      "INSERT INTO book_ops (email, day, kind, amount, category, party, note, payer, created_at, client_id)" +
      " VALUES (?1, ?2, 'income', ?3, ?4, ?5, ?6, ?7, ?8, ?9)"
    ).bind(
      user.email, payDay, row.amount,
      "Оплата по документу",
      row.party,
      row.number ? `${row.title} № ${row.number}` : row.title,
      guessPayer(row.party),
      now(), row.client_id
    ).run();
    bookOp = r.meta?.last_row_id || 0;
    added = true;
  }

  if (row.status === "paid" && status !== "paid" && bookOp) {
    await env.DB.prepare("DELETE FROM book_ops WHERE id = ? AND email = ?")
      .bind(bookOp, user.email).run();
    bookOp = 0;
    removed = true;
  }

  await env.DB.prepare(
    "UPDATE documents SET status = ?, book_op_id = ?, paid_at = ? WHERE id = ? AND email = ?"
  ).bind(status, bookOp, status === "paid" ? now() : 0, id, user.email).run();

  return json(env, origin, { ok: true, bookOpAdded: added, bookOpRemoved: removed });
}

export async function remove(request, env, origin, user) {
  const b = await request.json().catch(() => ({}));
  const id = Number(b.id);
  const row = await env.DB.prepare("SELECT book_op_id FROM documents WHERE id = ? AND email = ?")
    .bind(id, user.email).first();
  if (!row) return fail(env, origin, "Документ не найден", 404);

  /* Удаление документа не забирает с собой поступление: деньги пришли
     на самом деле, и в книге учёта им место. Запись остаётся, просто
     теряет связь с удалённым документом. */
  await env.DB.prepare("DELETE FROM documents WHERE id = ? AND email = ?").bind(id, user.email).run();
  return json(env, origin, { ok: true, bookOpKept: Boolean(row.book_op_id) });
}
