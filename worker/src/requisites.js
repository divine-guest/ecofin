/* ============ ЭкоФин — реквизиты и контрагенты ============

   Зачем это нужно.

   В библиотеке пятьдесят документов, и в каждом человек набирал свои
   реквизиты заново: наименование, ИНН, адрес, банк. Для счёта, который
   выставляют дважды в неделю, проще держать свой файл в Word — там хотя
   бы не надо ничего вводить. То есть чем больше мы добавляли шаблонов,
   тем очевиднее было, что пользоваться ими неудобно.

   Отсюда же берётся ощущение, что «услуг мало». Их не мало — они не
   связаны. Пятьдесят несвязанных шаблонов человек воспринимает как один
   шаблон, который каждый раз приходится заполнять с нуля. Связанные
   данные превращают набор бумаг в сервис.

   Три вещи, и все три — про то, чтобы не вводить дважды:
     1. свои реквизиты — вводятся один раз и подставляются везде;
     2. контрагенты — те, с кем работают не в первый раз;
     3. номера документов — растут сами и не повторяются.

   Проверка контрольных сумм ИНН и ОГРН стоит здесь, а не только в
   браузере: опечатка в реквизитах уезжает в подписанный документ, и
   находят её через месяцы — при сверке или на проверке.             */

import { json, fail, now } from "./lib.js";
import { logAction } from "./auth.js";

const MAX_COUNTERPARTIES = 500;

/* Длины полей. Ограничение не про безопасность — про то, что реквизиты
   печатаются в документе, и строка на две тысячи знаков ломает вёрстку
   бумаги, которую человек понесёт в банк. */
const LIMITS = {
  name: 300, inn: 12, ogrn: 15, kpp: 9, address: 400,
  bank: 300, bik: 9, account: 20, corr: 20,
  phone: 40, signer: 200, post: 150,
};

const cut = (v, max) => String(v ?? "").trim().slice(0, max);
const digits = (v, max) => String(v ?? "").replace(/\D/g, "").slice(0, max);

/* ---------- Контрольные суммы ---------- */

/* ИНН: 10 цифр у организаций, 12 у людей и предпринимателей.
   Пустое значение допустимо — человек может не знать его в момент
   заполнения, и запрещать сохранение из-за этого нельзя. */
export function innValid(inn) {
  const s = String(inn || "");
  if (!s) return true;
  if (!/^\d+$/.test(s)) return false;
  const d = [...s].map(Number);
  const dot = (k) => k.reduce((a, x, i) => a + x * d[i], 0);
  if (s.length === 10) return dot([2, 4, 10, 3, 5, 9, 4, 6, 8]) % 11 % 10 === d[9];
  if (s.length === 12) {
    const n11 = dot([7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) % 11 % 10;
    const n12 = dot([3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) % 11 % 10;
    return n11 === d[10] && n12 === d[11];
  }
  return false;
}

/* ОГРН — 13 цифр, ОГРНИП — 15. Проверка одна: остаток от деления на
   (длина − 2) даёт последнюю цифру. */
export function ogrnValid(ogrn) {
  const s = String(ogrn || "");
  if (!s) return true;
  if (!/^\d{13}$|^\d{15}$/.test(s)) return false;
  const mod = s.length === 13 ? 11 : 13;
  return Number(s.slice(0, -1)) % mod % 10 === Number(s.slice(-1));
}

/* ---------- Свои реквизиты ---------- */

const FIELDS = Object.keys(LIMITS);

export const requisitesOf = row => {
  const out = {};
  for (const f of FIELDS) out[f] = row?.["req_" + f] || "";
  return out;
};

/* Заполнены ли реквизиты настолько, чтобы документ выглядел документом.
   Наименования и ИНН достаточно: остальное нужно не всякой бумаге. */
export const requisitesReady = r => Boolean(r.name && r.inn);

export async function getRequisites(request, env, origin, user) {
  const row = await env.DB.prepare("SELECT * FROM users WHERE email = ?")
    .bind(user.email).first();
  const req = requisitesOf(row);
  return json(env, origin, { requisites: req, ready: requisitesReady(req) });
}

export async function saveRequisites(request, env, origin, user) {
  const b = await request.json().catch(() => ({}));

  const req = {
    name: cut(b.name, LIMITS.name),
    inn: digits(b.inn, LIMITS.inn),
    ogrn: digits(b.ogrn, LIMITS.ogrn),
    kpp: digits(b.kpp, LIMITS.kpp),
    address: cut(b.address, LIMITS.address),
    bank: cut(b.bank, LIMITS.bank),
    bik: digits(b.bik, LIMITS.bik),
    account: digits(b.account, LIMITS.account),
    corr: digits(b.corr, LIMITS.corr),
    phone: cut(b.phone, LIMITS.phone),
    signer: cut(b.signer, LIMITS.signer),
    post: cut(b.post, LIMITS.post),
  };

  /* Отказываем, а не молча сохраняем кривое: реквизиты уедут в бумагу,
     которую подпишут, и ошибка всплывёт через месяцы. */
  if (!innValid(req.inn)) return fail(env, origin, "ИНН не проходит проверку — сверьте цифры");
  if (!ogrnValid(req.ogrn)) return fail(env, origin, "ОГРН не проходит проверку — сверьте цифры");

  await env.DB.prepare(
    `UPDATE users SET req_name = ?1, req_inn = ?2, req_ogrn = ?3, req_kpp = ?4,
                      req_address = ?5, req_bank = ?6, req_bik = ?7, req_account = ?8,
                      req_corr = ?9, req_phone = ?10, req_signer = ?11, req_post = ?12
      WHERE email = ?13`
  ).bind(req.name, req.inn, req.ogrn, req.kpp, req.address, req.bank, req.bik,
         req.account, req.corr, req.phone, req.signer, req.post, user.email).run();

  await logAction(env, user.email, "Сохранены реквизиты");
  return json(env, origin, { requisites: req, ready: requisitesReady(req) });
}

/* ---------- Контрагенты ---------- */

const cpOut = r => ({
  id: r.id, name: r.name, inn: r.inn, kpp: r.kpp,
  address: r.address, bank: r.bank, phone: r.phone, note: r.note,
});

export async function listCounterparties(request, env, origin, user) {
  /* По последнему использованию, а не по алфавиту: тот, с кем работали
     вчера, нужен чаще того, кого завели полгода назад. */
  const rows = await env.DB.prepare(
    "SELECT * FROM counterparties WHERE email = ? ORDER BY used_at DESC, name COLLATE NOCASE"
  ).bind(user.email).all();
  return json(env, origin, { counterparties: (rows.results || []).map(cpOut) });
}

export async function saveCounterparty(request, env, origin, user) {
  const b = await request.json().catch(() => ({}));
  const name = cut(b.name, LIMITS.name);
  if (!name) return fail(env, origin, "Без наименования контрагента не сохранить");

  const inn = digits(b.inn, LIMITS.inn);
  if (!innValid(inn)) return fail(env, origin, "ИНН не проходит проверку — сверьте цифры");

  const data = [
    name, inn, digits(b.kpp, LIMITS.kpp), cut(b.address, LIMITS.address),
    cut(b.bank, LIMITS.bank), cut(b.phone, LIMITS.phone), cut(b.note, 300),
  ];

  const id = Number(b.id) || 0;
  if (id) {
    const own = await env.DB.prepare("SELECT id FROM counterparties WHERE id = ? AND email = ?")
      .bind(id, user.email).first();
    if (!own) return fail(env, origin, "Контрагент не найден", 404);
    await env.DB.prepare(
      `UPDATE counterparties SET name = ?1, inn = ?2, kpp = ?3, address = ?4,
                                 bank = ?5, phone = ?6, note = ?7
        WHERE id = ?8 AND email = ?9`
    ).bind(...data, id, user.email).run();
    return json(env, origin, { id });
  }

  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM counterparties WHERE email = ?")
    .bind(user.email).first();
  if ((count?.n || 0) >= MAX_COUNTERPARTIES)
    return fail(env, origin, `Больше ${MAX_COUNTERPARTIES} контрагентов не храним — удалите ненужных`);

  const res = await env.DB.prepare(
    `INSERT INTO counterparties (email, name, inn, kpp, address, bank, phone, note, used_at, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0, ?9)`
  ).bind(user.email, ...data, now()).run();

  await logAction(env, user.email, "Добавлен контрагент");
  return json(env, origin, { id: res.meta?.last_row_id || 0 });
}

export async function removeCounterparty(request, env, origin, user) {
  const b = await request.json().catch(() => ({}));
  const id = Number(b.id) || 0;
  if (!id) return fail(env, origin, "Не указан контрагент");
  await env.DB.prepare("DELETE FROM counterparties WHERE id = ? AND email = ?")
    .bind(id, user.email).run();
  return json(env, origin, { ok: true });
}

/* Отметка «подставляли только что» — она и задаёт порядок в списке. */
export async function touchCounterparty(request, env, origin, user) {
  const b = await request.json().catch(() => ({}));
  const id = Number(b.id) || 0;
  if (!id) return fail(env, origin, "Не указан контрагент");
  await env.DB.prepare("UPDATE counterparties SET used_at = ? WHERE id = ? AND email = ?")
    .bind(now(), id, user.email).run();
  return json(env, origin, { ok: true });
}

/* ---------- Номера документов ---------- */

const KINDS = ["schet", "nakladnaya", "akt", "dogovor", "prikaz", "pretenziya"];

/* Следующий номер — и сразу занимаем его.

   Именно занимаем, а не подсказываем: если только показать, человек
   выставит два счёта с одним номером, открыв форму дважды. Два счёта с
   одним номером — это спор с контрагентом и вопрос на проверке.
   Пропущенный номер не нарушает ничего, повторившийся — нарушает. */
export async function nextNumber(request, env, origin, user) {
  const b = await request.json().catch(() => ({}));
  const kind = KINDS.includes(b.kind) ? b.kind : "";
  if (!kind) return fail(env, origin, "Неизвестный вид документа");

  const year = new Date().getFullYear();
  const row = await env.DB.prepare("SELECT * FROM doc_numbers WHERE email = ? AND kind = ?")
    .bind(user.email, kind).first();

  /* Нумерация начинается заново каждый год — так принято, и так номер
     не разрастается до четырёх знаков за пару лет. */
  const next = (row && row.year === year) ? row.last_no + 1 : 1;

  await env.DB.prepare(
    `INSERT INTO doc_numbers (email, kind, last_no, year) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(email, kind) DO UPDATE SET last_no = ?3, year = ?4`
  ).bind(user.email, kind, next, year).run();

  return json(env, origin, { number: next, year });
}
