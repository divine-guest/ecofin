/* ============ ЭкоФин — «Моё дело» ============

   Почему этот раздел вообще появился.

   Всё остальное на сайте отвечает на разовый вопрос: посчитать налог,
   прочитать статью, разобрать договор. Ответ получен — человек ушёл,
   и вернётся, когда возникнет следующий вопрос. Может через месяц,
   может никогда. На такой связи подписка не держится.

   Ежедневно возвращаются только туда, где лежат собственные данные,
   которые меняются: сколько заработал, сколько отложить на налог,
   сколько осталось до лимита. Здесь это и живёт.

   Разделение труда между сервером и браузером выбрано намеренно:

     сервер   — хранит операции и профиль дела, следит за правами;
     браузер  — считает налог, взносы и лимиты по js/rates.js.

   Ставки и лимиты нарочно НЕ продублированы здесь. Они меняются каждый
   год, и второе место, где их надо не забыть поправить, гарантированно
   рано или поздно разойдётся с первым — а расхождение в налоговом
   расчёте хуже, чем его отсутствие.                                    */

import { json, fail, now, isPaid } from "./lib.js";
import { logAction } from "./auth.js";
import { resolveClient } from "./clients.js";

/* Предел на аккаунт. Не про деньги, а про здравый смысл: живое дело даёт
   несколько сотен операций в год, десять тысяч — это уже не учёт,
   а чей-то скрипт. */
const MAX_OPS = 10000;

/* Что открыто без подписки.

   Текущий месяц целиком и годовой итог — бесплатно, и это не щедрость,
   а расчёт. Привычка заносить выручку складывается за пару недель, и
   складываться она должна без препятствий: человек, которому на третьей
   записи показали замок, не станет платить — он просто уйдёт.

   Платит он позже и за другое: когда в конце квартала нужна история,
   разбивка и книга учёта. Тогда данные уже накоплены, и они его.       */
const FREE_MONTHS = 1;

const KINDS = ["income", "expense"];
const PAYERS = ["person", "company"];
const FORMS = ["", "ip", "ooo", "self"];
const REGIMES = ["", "npd", "usn6", "usn15", "psn", "ausn", "eshn", "osno"];

const isDay = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

/* Первый день месяца, начиная с которого история открыта бесплатно. */
function freeFrom() {
  const d = new Date();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - (FREE_MONTHS - 1));
  return d.toISOString().slice(0, 10);
}

const profileOf = user => ({
  form: user.biz_form || "",
  regime: user.biz_regime || "",
  workers: user.biz_workers || 0,
  psn: user.biz_psn || 0,
});

const opOut = r => ({
  id: r.id, day: r.day, kind: r.kind,
  amount: r.amount / 100,
  category: r.category, party: r.party, note: r.note, payer: r.payer,
});

/* GET /api/book?year=2026

   Отдаём:
     profile — форма, режим, работники;
     ops     — операции, которые человеку видны;
     year    — итоги за год: их видят все, потому что именно они
               показывают, сколько осталось до лимита, а лимит — это то,
               из-за чего сюда возвращаются;
     locked  — сколько записей скрыто и с какой даты. Не «доплатите,
               чтобы увидеть», а «ваши 214 записей на месте» — разница
               в том, что второе правда и не выглядит вымогательством. */
export async function list(request, env, origin, user) {
  const url = new URL(request.url);
  const year = String(Number(url.searchParams.get("year")) || new Date().getFullYear());
  const paid = isPaid(user);
  const from = paid ? `${year}-01-01` : freeFrom();

  /* Какое дело смотрим. Ноль — своё; чужой номер даёт null, и тогда
     показываем своё, а не чужие деньги. */
  const client = await resolveClient(env, user, url.searchParams.get("client"));
  if (client === null) return fail(env, origin, "Такого дела нет", 404);

  const rows = await env.DB.prepare(
    `SELECT * FROM book_ops
      WHERE email = ?1 AND client_id = ?4 AND day >= ?2 AND day <= ?3
      ORDER BY day DESC, id DESC`
  ).bind(user.email, from, `${year}-12-31`, client).all();

  /* Итоги за год считаем в базе, а не по выданным строкам: у бесплатного
     тарифа строк на руках меньше, чем операций, и сумма по ним была бы
     занижена — то есть лимит показывался бы неправильно. */
  const totals = await env.DB.prepare(
    `SELECT kind,
            COALESCE(SUM(amount), 0) AS sum,
            COUNT(*) AS n
       FROM book_ops
      WHERE email = ?1 AND client_id = ?4 AND day >= ?2 AND day <= ?3
      GROUP BY kind`
  ).bind(user.email, `${year}-01-01`, `${year}-12-31`, client).all();

  const year_ = { income: 0, expense: 0, count: 0 };
  for (const t of totals.results || []) {
    if (t.kind === "income") year_.income = t.sum / 100;
    if (t.kind === "expense") year_.expense = t.sum / 100;
    year_.count += t.n;
  }

  /* Поступления от физлиц отдельно: на НПД они облагаются по 4%,
     а не по 6%, и без этого числа налог самозанятому не сходится. */
  const fromPersons = await env.DB.prepare(
    `SELECT COALESCE(SUM(amount), 0) AS sum FROM book_ops
      WHERE email = ?1 AND kind = 'income' AND payer = 'person'
        AND client_id = ?4 AND day >= ?2 AND day <= ?3`
  ).bind(user.email, `${year}-01-01`, `${year}-12-31`, client).first();
  year_.incomeFromPersons = (fromPersons?.sum || 0) / 100;

  const visible = (rows.results || []).length;
  const locked = paid ? null : {
    count: Math.max(0, year_.count - visible),
    before: from,
  };

  /* Режим берём у того дела, которое открыто: у клиента он свой,
     и считать его налог по режиму бухгалтера — прямая ошибка. */
  let profile = profileOf(user);
  if (client) {
    const c = await env.DB.prepare("SELECT * FROM clients WHERE id = ? AND owner = ?")
      .bind(client, user.email).first();
    if (c) profile = { form: c.form, regime: c.regime, workers: c.workers, psn: c.psn, name: c.name };
  }

  return json(env, origin, {
    profile,
    client,
    ops: (rows.results || []).map(opOut),
    year: year_,
    yearNumber: Number(year),
    paid,
    locked,
  });
}

/* POST /api/book/op — новая запись. */
export async function addOp(request, env, origin, user) {
  const b = await request.json().catch(() => ({}));

  const day = String(b.day || "").trim();
  const kind = KINDS.includes(b.kind) ? b.kind : "income";
  const payer = PAYERS.includes(b.payer) ? b.payer : "company";
  const category = String(b.category || "").trim().slice(0, 60);
  const party = String(b.party || "").trim().slice(0, 120);
  const note = String(b.note || "").trim().slice(0, 300);

  if (!isDay(day)) return fail(env, origin, "Укажите дату в формате ГГГГ-ММ-ДД");

  /* Сумму принимаем в рублях и тут же переводим в копейки. Округляем
     здесь, а не доверяем клиенту: иначе в базу приедет 1234.5600000001
     и годовой итог разойдётся с ручным подсчётом. */
  const rub = Number(b.amount);
  if (!Number.isFinite(rub) || rub <= 0) return fail(env, origin, "Сумма должна быть больше нуля");
  if (rub > 1e11) return fail(env, origin, "Слишком большая сумма");
  const amount = Math.round(rub * 100);

  const cnt = await env.DB.prepare("SELECT COUNT(*) AS n FROM book_ops WHERE email = ?").bind(user.email).first();
  if ((cnt?.n || 0) >= MAX_OPS)
    return fail(env, origin, `Больше ${MAX_OPS} записей не поддерживается — выгрузите и заведите новый год`);

  const client = await resolveClient(env, user, b.client);
  if (client === null) return fail(env, origin, "Такого дела нет", 404);

  const r = await env.DB.prepare(
    `INSERT INTO book_ops (email, day, kind, amount, category, party, note, payer, created_at, client_id)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`
  ).bind(user.email, day, kind, amount, category, party, note, payer, now(), client).run();

  return json(env, origin, { id: r.meta?.last_row_id ?? null, ok: true }, 201);
}

/* POST /api/book/op/delete {id} */
export async function removeOp(request, env, origin, user) {
  const b = await request.json().catch(() => ({}));
  const id = Number(b.id);
  if (!Number.isInteger(id)) return fail(env, origin, "Не указана запись");

  /* Условие по почте обязательно: без него чужую запись удалит любой,
     кто подставит её номер. */
  const r = await env.DB.prepare("DELETE FROM book_ops WHERE id = ? AND email = ?")
    .bind(id, user.email).run();
  if (!(r.meta?.changes)) return fail(env, origin, "Запись не найдена", 404);
  return json(env, origin, { ok: true });
}

/* POST /api/book/profile — форма дела и режим налогообложения. */
export async function saveProfile(request, env, origin, user) {
  const b = await request.json().catch(() => ({}));
  const form = FORMS.includes(b.form) ? b.form : "";
  const regime = REGIMES.includes(b.regime) ? b.regime : "";
  const workers = Math.max(0, Math.min(500, Number(b.workers) || 0));
  const psn = Math.max(0, Math.min(1e9, Math.round(Number(b.psn) || 0)));

  await env.DB.prepare(
    "UPDATE users SET biz_form = ?1, biz_regime = ?2, biz_workers = ?3, biz_psn = ?4 WHERE email = ?5"
  ).bind(form, regime, workers, psn, user.email).run();

  await logAction(env, user.email, "Настроен профиль дела");
  return json(env, origin, { profile: { form, regime, workers, psn } });
}

/* GET /api/book/export?year= — книга учёта для выгрузки.

   Платная: это ровно то, ради чего в конце квартала открывают учёт,
   и ровно то, что нельзя собрать за вечер вручную, если данных нет.
   Данные при этом есть у всех — просто выгружает их подписка.        */
export async function exportBook(request, env, origin, user) {
  if (!isPaid(user))
    return json(env, origin, {
      error: "Книга учёта доходов и расходов входит в платные тарифы. Ваши записи никуда не делись — они на месте",
      paywall: true, kind: "book",
    }, 402);

  const url = new URL(request.url);
  const year = String(Number(url.searchParams.get("year")) || new Date().getFullYear());

  const client = await resolveClient(env, user, url.searchParams.get("client"));
  if (client === null) return fail(env, origin, "Такого дела нет", 404);

  const rows = await env.DB.prepare(
    `SELECT day, kind, amount, category, party, note FROM book_ops
      WHERE email = ?1 AND client_id = ?4 AND day >= ?2 AND day <= ?3
      ORDER BY day ASC, id ASC`
  ).bind(user.email, `${year}-01-01`, `${year}-12-31`, client).all();

  return json(env, origin, {
    year: Number(year),
    rows: (rows.results || []).map((r, i) => ({
      n: i + 1,
      day: r.day,
      kind: r.kind,
      amount: r.amount / 100,
      category: r.category,
      party: r.party,
      note: r.note,
    })),
  });
}

/* POST /api/book/scan — чек или счёт с фотографии превращается в запись.

   Зачем отдельно от /api/ocr. Тот возвращает текст, и человеку остаётся
   выписать из него сумму, дату и контрагента руками — то есть почти всю
   работу. Здесь модель сразу отдаёт разобранные поля, и запись остаётся
   только подтвердить.

   Ради этого и затевался учёт: занести поступление должно быть дешевле,
   чем не занести. Пока это «открыть, вспомнить сумму, напечатать» —
   заносить не будут, и раздел умрёт.

   Ничего не создаём молча: возвращаем разобранное, а записывает человек,
   посмотрев на цифры. Ошибка распознавания в учёте — это неверный налог,
   и исправлять её потом дороже, чем проверить сейчас. */
export async function scanReceipt(request, env, origin, user) {
  const { isPro } = await import("./lib.js");
  const { spendAnalyze, spendTool, analyzeQuota, refundAnalyze, refundTool } = await import("./quota.js");
  const { callProvider, quotaSnapshot } = await import("./ai.js");

  if (!env.AI_API_KEY) return fail(env, origin, "AI_API_KEY не задан в секретах воркера", 500);

  const b = await request.json().catch(() => ({}));
  const images = Array.isArray(b.images) ? b.images.slice(0, 2) : [];
  if (!images.length) return fail(env, origin, "Нет изображения");
  for (const img of images) {
    if (typeof img !== "string" || !img.startsWith("data:image/"))
      return fail(env, origin, "Некорректный формат изображения");
    if (img.length > 6 * 1024 * 1024)
      return fail(env, origin, "Изображение слишком большое — сожмите до 4 МБ");
  }

  const paid = isPro(user);
  if (paid) {
    if (!(await spendAnalyze(env, user))) {
      const q = await analyzeQuota(env, user);
      return json(env, origin, {
        error: `Распознано документов в этом месяце ${q.spent} из ${q.limit}. На тарифе «Про» их без ограничений`,
        paywall: true, kind: "analyze",
      }, 402);
    }
  } else if (!(await spendTool(env, user))) {
    return json(env, origin, {
      error: "Пробный запуск израсходован. Внесение по фото входит в платные тарифы",
      paywall: true, kind: "tool",
    }, 402);
  }

  try {
    const raw = await callProvider(env, {
      model: env.AI_VISION_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: SCAN_SYSTEM },
        { role: "user", content: [
          { type: "text", text: `Сегодня ${new Date().toISOString().slice(0, 10)}. Разбери документ.` },
          ...images.map(url => ({ type: "image_url", image_url: { url } })),
        ] },
      ],
      maxTokens: 700,
    });

    const parsed = parseScan(raw);
    if (!parsed) {
      /* Модель ответила не тем — списывать за это нельзя. */
      await (paid ? refundAnalyze(env, user) : refundTool(env, user));
      return fail(env, origin, "Не удалось разобрать документ. Попробуйте снимок покрупнее и без бликов", 422);
    }

    return json(env, origin, { ...parsed, quota: await quotaSnapshot(env, user) });
  } catch (e) {
    await (paid ? refundAnalyze(env, user) : refundTool(env, user));
    /* В журнал — обязательно и подробно. upstreamError на незнакомую
       ошибку отвечает «провайдер недоступен», и любая опечатка в этом
       коде выглядела бы снаружи как чужой сбой. Один раз уже искали
       вслепую именно из-за этого. */
    console.error("book/scan:", e && (e.stack || e.message));
    const { upstreamError } = await import("./ai.js");
    return upstreamError(env, origin, e);
  }
}

const SCAN_SYSTEM = `Ты разбираешь фотографии чеков, счетов, актов и платёжных документов для бухгалтерского учёта.

Верни ТОЛЬКО JSON, без пояснений и без разметки кода:
{"amount": число, "day": "ГГГГ-ММ-ДД", "party": "контрагент", "kind": "income" | "expense", "payer": "person" | "company", "category": "", "note": ""}

ПРАВИЛА:
1. amount — итоговая сумма к оплате числом, без пробелов и знака рубля. Копейки через точку. Если в документе есть «ИТОГО» и «в том числе НДС» — бери ИТОГО.
2. day — дата документа. Если её не видно, поставь сегодняшнюю.
3. party — кто вторая сторона: продавец в чеке, плательщик в поступлении. Без организационно-правовой формы можно, но название сохрани как в документе.
4. kind — "expense", если это чек о покупке, счёт к оплате, квитанция. "income", если это документ о поступлении вам денег: акт выполненных вами работ, счёт, который выставили вы.
5. payer — "person", если вторая сторона физлицо; "company", если организация или ИП. Сомневаешься — "company".
6. category — одно-два слова: «Реклама», «Материалы», «Аренда», «Услуги». Пусто, если непонятно.
7. note — номер документа, если он виден. Иначе пусто.
8. Если это НЕ финансовый документ, верни {"error": "не документ"}.
9. Ничего не додумывай. Не видно суммы — верни {"error": "не видно суммы"}.`;

/* Модель почти всегда возвращает чистый JSON, но иногда оборачивает его
   в ```json — это её привычка, а не ошибка, и ломаться из-за неё глупо. */
function parseScan(raw) {
  const text = String(raw || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  let d;
  try { d = JSON.parse(text); } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try { d = JSON.parse(m[0]); } catch { return null; }
  }
  if (!d || d.error) return null;

  const amount = Number(String(d.amount ?? "").toString().replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const day = /^\d{4}-\d{2}-\d{2}$/.test(d.day) ? d.day : new Date().toISOString().slice(0, 10);
  return {
    amount: Math.round(amount * 100) / 100,
    day,
    kind: d.kind === "income" ? "income" : "expense",
    payer: d.payer === "person" ? "person" : "company",
    party: String(d.party || "").trim().slice(0, 120),
    category: String(d.category || "").trim().slice(0, 60),
    note: String(d.note || "").trim().slice(0, 300),
  };
}
