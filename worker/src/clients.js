/* ============ ЭкоФин — несколько дел в одном кабинете ============

   Кому это нужно. Бухгалтер ведёт два десятка ИП и покупает у нас
   одного себя. Это самый выгодный клиент сервиса: он приводит все свои
   дела сразу, платит за них одной подпиской и уходит труднее всех —
   переносить учёт двадцати человек не станет никто.

   И второй, более многочисленный случай: у человека ИП и ООО, либо
   ИП и личные доходы. Раньше он вёл их в одном котле, и налог считался
   неправильно у обоих.

   Устройство намеренно простое: у операции появился номер дела, ноль —
   собственное дело владельца кабинета. Все прежние записи остались
   на местах, переносить ничего не нужно, а человек без клиентов вообще
   не замечает, что здесь что-то поменялось.                          */

import { json, fail, now, hasFeature } from "./lib.js";
import { logAction } from "./auth.js";

const MAX_CLIENTS = 200;
const FORMS = ["", "ip", "ooo", "self"];
const REGIMES = ["", "npd", "usn6", "usn15", "psn", "ausn", "eshn", "osno"];

const clientOut = r => ({
  id: r.id, name: r.name, inn: r.inn,
  form: r.form, regime: r.regime,
  workers: r.workers, psn: r.psn, note: r.note,
});

/* Возможность закрыта тарифом. Проверяем в одном месте: пропустить
   проверку в одной из четырёх ручек — обычное дело, и тогда платное
   становится бесплатным через обход. */
function gate(env, origin, user) {
  if (hasFeature(user, "clients")) return null;
  return json(env, origin, {
    error: "Несколько дел в одном кабинете входят в тариф «Про». " +
           "Это для бухгалтеров и для тех, у кого ИП и ООО сразу",
    paywall: true, kind: "clients",
  }, 402);
}

/* GET /api/clients — список дел с итогами за год по каждому.

   Отдаём сразу с цифрами, а не голыми названиями: бухгалтер открывает
   этот список, чтобы увидеть, у кого что горит, а не чтобы полюбоваться
   именами. Налог считает браузер по js/rates.js — здесь только суммы. */
export async function list(request, env, origin, user) {
  const blocked = gate(env, origin, user);
  if (blocked) return blocked;

  const url = new URL(request.url);
  const year = String(Number(url.searchParams.get("year")) || new Date().getFullYear());

  const rows = await env.DB.prepare(
    "SELECT * FROM clients WHERE owner = ? ORDER BY name COLLATE NOCASE"
  ).bind(user.email).all();

  /* Итоги по всем делам разом, одним запросом: двадцать клиентов — это
     двадцать запросов, если считать по одному, и страница открывается
     секунду вместо мгновения. */
  const sums = await env.DB.prepare(
    `SELECT client_id, kind, payer,
            COALESCE(SUM(amount), 0) AS sum, COUNT(*) AS n
       FROM book_ops
      WHERE email = ?1 AND day >= ?2 AND day <= ?3
      GROUP BY client_id, kind, payer`
  ).bind(user.email, `${year}-01-01`, `${year}-12-31`).all();

  const totals = {};
  for (const r of sums.results || []) {
    const t = (totals[r.client_id] ||= { income: 0, expense: 0, incomeFromPersons: 0, count: 0 });
    if (r.kind === "income") {
      t.income += r.sum / 100;
      if (r.payer === "person") t.incomeFromPersons += r.sum / 100;
    } else t.expense += r.sum / 100;
    t.count += r.n;
  }
  const empty = { income: 0, expense: 0, incomeFromPersons: 0, count: 0 };

  return json(env, origin, {
    yearNumber: Number(year),
    /* Своё дело идёт первым и всегда есть, даже если клиентов нет:
       иначе бухгалтер, у которого есть и своё ИП, его потеряет. */
    own: { id: 0, name: "Моё дело", ...profileOfUser(user), year: totals[0] || empty },
    clients: (rows.results || []).map(r => ({
      ...clientOut(r),
      year: totals[r.id] || empty,
    })),
  });
}

const profileOfUser = u => ({
  form: u.biz_form || "", regime: u.biz_regime || "",
  workers: u.biz_workers || 0, psn: u.biz_psn || 0,
});

/* POST /api/clients — завести или изменить дело. */
export async function save(request, env, origin, user) {
  const blocked = gate(env, origin, user);
  if (blocked) return blocked;

  const b = await request.json().catch(() => ({}));
  const id = Number(b.id) || 0;
  const name = String(b.name || "").trim().slice(0, 120);
  const inn = String(b.inn || "").replace(/\D/g, "").slice(0, 12);
  const form = FORMS.includes(b.form) ? b.form : "";
  const regime = REGIMES.includes(b.regime) ? b.regime : "";
  const workers = Math.max(0, Math.min(500, Number(b.workers) || 0));
  const psn = Math.max(0, Math.min(1e9, Math.round(Number(b.psn) || 0)));
  const note = String(b.note || "").trim().slice(0, 300);

  if (name.length < 2) return fail(env, origin, "Напишите, как называть это дело");

  if (id) {
    /* Условие по владельцу обязательно: без него чужое дело правит
       любой, кто подставит номер. */
    const r = await env.DB.prepare(
      `UPDATE clients SET name = ?1, inn = ?2, form = ?3, regime = ?4,
              workers = ?5, psn = ?6, note = ?7
         WHERE id = ?8 AND owner = ?9`
    ).bind(name, inn, form, regime, workers, psn, note, id, user.email).run();
    if (!(r.meta?.changes)) return fail(env, origin, "Дело не найдено", 404);
    return json(env, origin, { id, ok: true });
  }

  const cnt = await env.DB.prepare("SELECT COUNT(*) AS n FROM clients WHERE owner = ?")
    .bind(user.email).first();
  if ((cnt?.n || 0) >= MAX_CLIENTS)
    return fail(env, origin, `Больше ${MAX_CLIENTS} дел в одном кабинете не поддерживается`);

  const r = await env.DB.prepare(
    `INSERT INTO clients (owner, name, inn, form, regime, workers, psn, note, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
  ).bind(user.email, name, inn, form, regime, workers, psn, note, now()).run();

  await logAction(env, user.email, "Добавлено дело: " + name);
  return json(env, origin, { id: r.meta?.last_row_id ?? null, ok: true }, 201);
}

/* POST /api/clients/delete {id}

   Удаляем вместе с операциями. Осиротевшие записи — это чужие деньги
   в чужом учёте: они не видны ни в одном списке, но продолжают попадать
   в итоги, и расхождение потом ищут неделю. */
export async function remove(request, env, origin, user) {
  const blocked = gate(env, origin, user);
  if (blocked) return blocked;

  const b = await request.json().catch(() => ({}));
  const id = Number(b.id);
  if (!Number.isInteger(id) || id <= 0) return fail(env, origin, "Не указано дело");

  const row = await env.DB.prepare("SELECT name FROM clients WHERE id = ? AND owner = ?")
    .bind(id, user.email).first();
  if (!row) return fail(env, origin, "Дело не найдено", 404);

  await env.DB.batch([
    env.DB.prepare("DELETE FROM book_ops WHERE email = ? AND client_id = ?").bind(user.email, id),
    env.DB.prepare("DELETE FROM clients WHERE id = ? AND owner = ?").bind(id, user.email),
  ]);
  await logAction(env, user.email, "Удалено дело: " + row.name);
  return json(env, origin, { ok: true });
}

/* Номер дела из запроса, с проверкой, что оно наше. Возвращает 0
   (собственное дело) или номер, либо null, если дело чужое. */
export async function resolveClient(env, user, raw) {
  const id = Number(raw) || 0;
  if (!id) return 0;
  if (!hasFeature(user, "clients")) return null;
  const row = await env.DB.prepare("SELECT id FROM clients WHERE id = ? AND owner = ?")
    .bind(id, user.email).first();
  return row ? id : null;
}
