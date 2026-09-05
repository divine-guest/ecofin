/* ============ ЭкоФин — свои организации, контрагенты, номера ============

   Зачем это нужно.

   В библиотеке пятьдесят документов, и в каждом человек набирал свои
   реквизиты заново: наименование, ИНН, адрес, банк. Для счёта, который
   выставляют дважды в неделю, проще было держать свой файл в Word — там
   хотя бы ничего не надо вводить.

   Отсюда же ощущение, что «услуг мало». Их не мало — они не связаны.
   Пятьдесят несвязанных шаблонов человек воспринимает как один шаблон,
   который каждый раз заполняется с нуля.

   Почему организаций несколько.

   Сначала реквизиты были одним набором — и это оказалось тупиком.
   У человека бывает ИП и ООО одновременно. Фирму закрывают и открывают
   новую. Реквизиты меняются: переезд, смена банка, смена наименования.
   С одним набором прежние приходилось затирать руками, а документ от
   старой фирмы — восстанавливать по памяти.

   Закрытая фирма не удаляется, а уходит в архив: по ней могут прийти
   требования и через три года, и реквизиты для ответа должны найтись.

   Нумерация ведётся по организации. Иначе счета двух своих фирм
   получают общую сквозную нумерацию — у ИП 1, 3, 7, у ООО 2, 4, 5, —
   и для налоговой это выглядит как пропущенные счета.               */

import { json, fail, now } from "./lib.js";
import { logAction } from "./auth.js";

const MAX_COUNTERPARTIES = 500;
const MAX_ORGS = 20;

/* Длины полей. Ограничение не про безопасность — про то, что реквизиты
   печатаются в документе, и строка на две тысячи знаков ломает вёрстку
   бумаги, которую человек понесёт в банк. */
const LIMITS = {
  label: 60, name: 300, inn: 12, ogrn: 15, kpp: 9, address: 400,
  bank: 300, bik: 9, account: 20, corr: 20,
  phone: 40, signer: 200, post: 150,
};

const FIELDS = Object.keys(LIMITS);
const DIGIT_FIELDS = ["inn", "ogrn", "kpp", "bik", "account", "corr"];

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

/* ОГРН — 13 цифр, ОГРНИП — 15. Остаток от деления на (длина − 2)
   даёт последнюю цифру. */
export function ogrnValid(ogrn) {
  const s = String(ogrn || "");
  if (!s) return true;
  if (!/^\d{13}$|^\d{15}$/.test(s)) return false;
  const mod = s.length === 13 ? 11 : 13;
  return Number(s.slice(0, -1)) % mod % 10 === Number(s.slice(-1));
}

/* ---------- Организации ---------- */

const orgOut = r => {
  const o = { id: r.id, archived: Boolean(r.archived) };
  for (const f of FIELDS) o[f] = r[f] || "";
  return o;
};

/* Заполнена ли организация настолько, чтобы документ выглядел
   документом. Наименования и ИНН достаточно: остальное нужно не всякой
   бумаге. */
export const orgReady = o => Boolean(o && o.name && o.inn);

/* Первая организация заводится из прежних одиночных реквизитов.

   Делается один раз и незаметно: человек, который уже ввёл реквизиты до
   появления организаций, не должен вводить их заново — иначе улучшение
   ощущается как поломка. */
async function seedFromLegacy(env, user) {
  const row = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(user.email).first();
  if (!row || !row.req_name) return null;

  const vals = FIELDS.map(f => (f === "label" ? "Основная" : (row["req_" + f] || "")));
  const res = await env.DB.prepare(
    `INSERT INTO my_orgs (email, label, name, inn, ogrn, kpp, address, bank, bik, account,
                          corr, phone, signer, post, archived, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, 0, ?15)`
  ).bind(user.email, ...vals, now()).run();

  const id = res.meta?.last_row_id || 0;
  if (id) await env.DB.prepare("UPDATE users SET active_org = ? WHERE email = ?")
    .bind(id, user.email).run();
  return id;
}

async function loadOrgs(env, user) {
  let rows = await env.DB.prepare(
    "SELECT * FROM my_orgs WHERE email = ? ORDER BY archived, id"
  ).bind(user.email).all();

  if (!(rows.results || []).length) {
    const seeded = await seedFromLegacy(env, user);
    if (seeded) {
      rows = await env.DB.prepare(
        "SELECT * FROM my_orgs WHERE email = ? ORDER BY archived, id"
      ).bind(user.email).all();
    }
  }

  const list = (rows.results || []).map(orgOut);
  const u = await env.DB.prepare("SELECT active_org FROM users WHERE email = ?")
    .bind(user.email).first();

  /* Если выбранной организации больше нет (удалили или убрали в архив),
     переключаемся на первую живую сами: иначе подстановка молча
     перестаёт работать, и причину человек не найдёт. */
  let active = u?.active_org || 0;
  const alive = list.filter(o => !o.archived);
  if (!alive.some(o => o.id === active)) {
    active = alive[0]?.id || 0;
    await env.DB.prepare("UPDATE users SET active_org = ? WHERE email = ?")
      .bind(active, user.email).run();
  }
  return { list, active };
}

export async function listOrgs(request, env, origin, user) {
  const { list, active } = await loadOrgs(env, user);
  return json(env, origin, { orgs: list, active, ready: orgReady(list.find(o => o.id === active)) });
}

export async function saveOrg(request, env, origin, user) {
  const b = await request.json().catch(() => ({}));

  const o = {};
  for (const f of FIELDS) {
    o[f] = DIGIT_FIELDS.includes(f) ? digits(b[f], LIMITS[f]) : cut(b[f], LIMITS[f]);
  }
  if (!o.name) return fail(env, origin, "Без наименования организацию не сохранить");

  /* Отказываем, а не молча правим: реквизиты уедут в бумагу, которую
     подпишут, и ошибка всплывёт через месяцы. */
  if (!innValid(o.inn)) return fail(env, origin, "ИНН не проходит проверку — сверьте цифры");
  if (!ogrnValid(o.ogrn)) return fail(env, origin, "ОГРН не проходит проверку — сверьте цифры");

  /* Ярлык нужен, чтобы отличать свои организации в списке. Если не
     задан — берём наименование: «ООО «Ромашка»» само по себе понятно. */
  if (!o.label) o.label = o.name.slice(0, LIMITS.label);

  const vals = FIELDS.map(f => o[f]);
  const id = Number(b.id) || 0;

  if (id) {
    const own = await env.DB.prepare("SELECT id FROM my_orgs WHERE id = ? AND email = ?")
      .bind(id, user.email).first();
    if (!own) return fail(env, origin, "Организация не найдена", 404);
    await env.DB.prepare(
      `UPDATE my_orgs SET label = ?1, name = ?2, inn = ?3, ogrn = ?4, kpp = ?5, address = ?6,
                          bank = ?7, bik = ?8, account = ?9, corr = ?10, phone = ?11,
                          signer = ?12, post = ?13
        WHERE id = ?14 AND email = ?15`
    ).bind(...vals, id, user.email).run();
    return json(env, origin, { id });
  }

  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM my_orgs WHERE email = ?")
    .bind(user.email).first();
  if ((count?.n || 0) >= MAX_ORGS)
    return fail(env, origin, `Больше ${MAX_ORGS} организаций не храним`);

  const res = await env.DB.prepare(
    `INSERT INTO my_orgs (email, label, name, inn, ogrn, kpp, address, bank, bik, account,
                          corr, phone, signer, post, archived, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, 0, ?15)`
  ).bind(user.email, ...vals, now()).run();

  const newId = res.meta?.last_row_id || 0;

  /* Первая заведённая сразу становится выбранной: иначе человек
     заполнит реквизиты и обнаружит, что подстановка всё ещё не работает. */
  const u = await env.DB.prepare("SELECT active_org FROM users WHERE email = ?")
    .bind(user.email).first();
  if (!u?.active_org && newId) {
    await env.DB.prepare("UPDATE users SET active_org = ? WHERE email = ?")
      .bind(newId, user.email).run();
  }

  await logAction(env, user.email, "Добавлена своя организация");
  return json(env, origin, { id: newId });
}

/* Переключение между своими организациями. */
export async function setActiveOrg(request, env, origin, user) {
  const b = await request.json().catch(() => ({}));
  const id = Number(b.id) || 0;

  const own = await env.DB.prepare("SELECT id, archived FROM my_orgs WHERE id = ? AND email = ?")
    .bind(id, user.email).first();
  if (!own) return fail(env, origin, "Организация не найдена", 404);
  if (own.archived) return fail(env, origin, "Эта организация в архиве — сначала верните её из архива");

  await env.DB.prepare("UPDATE users SET active_org = ? WHERE email = ?")
    .bind(id, user.email).run();
  return json(env, origin, { active: id });
}

/* Закрыли фирму — организация уходит в архив, а не удаляется.

   По закрытой фирме требования приходят и через три года, и реквизиты
   для ответа должны найтись. Плюс за ней тянутся выданные номера
   документов: удалить её — значит начать нумерацию заново и выставить
   счёт с номером, который уже был.

   Настоящее удаление оставлено на явный запрос: тогда уходит и
   нумерация, потому что документов больше нет. */
export async function archiveOrg(request, env, origin, user) {
  const b = await request.json().catch(() => ({}));
  const id = Number(b.id) || 0;
  const hard = b.hard === true;

  const own = await env.DB.prepare("SELECT id FROM my_orgs WHERE id = ? AND email = ?")
    .bind(id, user.email).first();
  if (!own) return fail(env, origin, "Организация не найдена", 404);

  if (hard) {
    await env.DB.prepare("DELETE FROM my_orgs WHERE id = ? AND email = ?")
      .bind(id, user.email).run();
    await env.DB.prepare("DELETE FROM doc_numbers2 WHERE email = ? AND org_id = ?")
      .bind(user.email, id).run();
  } else {
    const to = b.restore === true ? 0 : 1;
    await env.DB.prepare("UPDATE my_orgs SET archived = ? WHERE id = ? AND email = ?")
      .bind(to, id, user.email).run();
  }

  const { active } = await loadOrgs(env, user);
  return json(env, origin, { ok: true, active });
}

/* ---------- Совместимость: реквизиты «текущей» организации ----------

   Страница документов спрашивает реквизиты, не зная про организации.
   Отдаём выбранную — так подстановка работает и там, где о переключении
   ничего не знают. */
export async function getRequisites(request, env, origin, user) {
  const { list, active } = await loadOrgs(env, user);
  const cur = list.find(o => o.id === active) || null;
  const req = {};
  for (const f of FIELDS) req[f] = cur ? cur[f] : "";
  return json(env, origin, {
    requisites: req, ready: orgReady(cur),
    orgs: list.filter(o => !o.archived).map(o => ({ id: o.id, label: o.label, name: o.name })),
    active,
  });
}

/* Сохранение через старый адрес правит выбранную организацию, а нет её
   — заводит первую.

   Ответ отдаём в прежнем виде: {requisites, ready}. Страница документов
   на него опирается, и молча сменить форму ответа — значит сломать её
   так, что виновата будет выглядеть она. */
export async function saveRequisites(request, env, origin, user) {
  const { active } = await loadOrgs(env, user);
  const b = await request.json().catch(() => ({}));
  const merged = new Request(request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify({ ...b, id: b.id || active || 0 }),
  });

  const res = await saveOrg(merged, env, origin, user);
  if (res.status >= 400) return res;

  const after = await loadOrgs(env, user);
  const cur = after.list.find(o => o.id === after.active) || null;
  const req = {};
  for (const f of FIELDS) req[f] = cur ? cur[f] : "";
  return json(env, origin, { requisites: req, ready: orgReady(cur), active: after.active });
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
   Пропущенный номер не нарушает ничего, повторившийся — нарушает.

   Считаем по организации: у ИП и у ООО нумерация своя. */
export async function nextNumber(request, env, origin, user) {
  const b = await request.json().catch(() => ({}));
  const kind = KINDS.includes(b.kind) ? b.kind : "";
  if (!kind) return fail(env, origin, "Неизвестный вид документа");

  const { active } = await loadOrgs(env, user);
  const org = active || 0;
  const year = new Date().getFullYear();

  const row = await env.DB.prepare(
    "SELECT * FROM doc_numbers2 WHERE email = ? AND org_id = ? AND kind = ?"
  ).bind(user.email, org, kind).first();

  /* Нумерация начинается заново каждый год — так принято, и так номер
     не разрастается до четырёх знаков за пару лет. */
  const next = (row && row.year === year) ? row.last_no + 1 : 1;

  await env.DB.prepare(
    `INSERT INTO doc_numbers2 (email, org_id, kind, last_no, year) VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(email, org_id, kind) DO UPDATE SET last_no = ?4, year = ?5`
  ).bind(user.email, org, kind, next, year).run();

  return json(env, origin, { number: next, year, org });
}
