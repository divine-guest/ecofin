/* ============ ЭкоФин — обращения к государственным реестрам ============

   Что здесь есть и чего здесь нет — это важнее самого кода.

   ЕСТЬ: проверка статуса плательщика НПД по ИНН. Это открытый и
   бесплатный сервис ФНС, официально предназначенный ровно для этого.
   Нужен он не из любопытства: платить самозанятому, который слетел
   с режима, — значит стать его налоговым агентом задним числом.
   Заказчику доначислят НДФЛ и страховые взносы за весь период, плюс
   пени и штраф. Проверять статус положено на дату каждой выплаты,
   и это единственная проверка контрагента, которую закон фактически
   вменяет в обязанность.

   НЕТ: выписки из ЕГРЮЛ и ЕГРИП. Открытого бесплатного интерфейса
   для них у ФНС не существует — есть сайт для людей с защитой от
   роботов. Подбирать к нему ключи означало бы получить работающий
   сегодня и сломанный завтра сервис, который вдобавок молча врёт,
   когда перестаёт работать. Выписка подключается платным ключом,
   см. ниже: одна строка в настройках, и раздел оживает.

   Сеть здесь особая: обращаемся к чужому серверу, который может
   отвечать медленно, не отвечать вовсе или сменить формат ответа.
   Поэтому короткий таймаут, честный текст ошибки и кэш — повторный
   вопрос про тот же ИНН в тот же день не идёт наружу второй раз. */

import { json, fail, now } from "./lib.js";

const NPD_URL = "https://statusnpd.nalog.ru/api/v1/tracker/taxpayer_status";
const TIMEOUT = 8000;
/* Сутки. Статус меняется редко, а проверять его надо на дату выплаты —
   в пределах одного дня ответ один и тот же. */
const CACHE_HOURS = 24;

/* Контрольная сумма ИНН. Считаем на сервере тоже, а не только в браузере:
   опечатка не должна становиться обращением к чужому сервису. */
export function innValid(inn) {
  const d = String(inn).split("").map(Number);
  if (d.some(Number.isNaN)) return false;
  const s = w => w.reduce((a, x, i) => a + x * d[i], 0) % 11 % 10;
  if (d.length === 10) return s([2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[9];
  if (d.length === 12) {
    return s([7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[10]
        && s([3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === d[11];
  }
  return false;
}

async function cached(env, key) {
  const row = await env.DB.prepare(
    "SELECT payload, at FROM registry_cache WHERE k = ?"
  ).bind(key).first().catch(() => null);
  if (!row) return null;
  if (now() - row.at > CACHE_HOURS * 3600000) return null;
  try { return JSON.parse(row.payload); } catch { return null; }
}

async function remember(env, key, data) {
  await env.DB.prepare(
    `INSERT INTO registry_cache (k, payload, at) VALUES (?1, ?2, ?3)
     ON CONFLICT(k) DO UPDATE SET payload = ?2, at = ?3`
  ).bind(key, JSON.stringify(data), now()).run().catch(() => {});
}

/* POST /api/registry/npd {inn, date}

   Ответ ФНС: { status: "...", message: "..." } — где status равен
   "NOT_FOUND", если на эту дату человек плательщиком НПД не был.
   Формат недокументирован официально, поэтому разбираем защитно:
   любое непонятное поле трактуем как «проверить не удалось», а не
   как «не самозанятый». Ошибиться в эту сторону безопаснее. */
export async function npdStatus(request, env, origin, user) {
  const b = await request.json().catch(() => ({}));
  const inn = String(b.inn || "").replace(/\D/g, "");
  /* Проверяют на дату выплаты, поэтому дату спрашиваем, а не берём
     сегодняшнюю: платёж мог быть на прошлой неделе. */
  const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : new Date().toISOString().slice(0, 10);

  if (inn.length !== 12) return fail(env, origin, "У самозанятого ИНН из 12 цифр — это ИНН физлица");
  if (!innValid(inn)) return fail(env, origin, "ИНН не проходит проверку по контрольной сумме — проверьте цифры");

  const key = `npd:${inn}:${date}`;
  const hit = await cached(env, key);
  if (hit) return json(env, origin, { ...hit, cached: true });

  let res;
  try {
    res = await fetch(NPD_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ inn, requestDate: date }),
      signal: AbortSignal.timeout(TIMEOUT),
    });
  } catch (e) {
    /* Сеть или таймаут. Именно здесь нельзя соврать «не самозанятый»:
       человек на основании такого ответа откажется платить. */
    console.error("npd", e && e.message);
    return fail(env, origin,
      "Сервис ФНС сейчас не отвечает. Это не значит, что статуса нет — попробуйте через несколько минут " +
      "или проверьте вручную на npd.nalog.ru/check-status/", 503);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error("npd", res.status, text.slice(0, 200));
    return fail(env, origin, `Сервис ФНС ответил ошибкой (${res.status}). Проверьте позже`, 502);
  }

  const d = await res.json().catch(() => null);
  if (!d || typeof d.status !== "string") {
    console.error("npd: непонятный ответ", JSON.stringify(d).slice(0, 200));
    return fail(env, origin, "Ответ ФНС не удалось разобрать. Проверьте вручную на npd.nalog.ru/check-status/", 502);
  }

  const active = d.status !== "NOT_FOUND";
  const out = {
    inn, date, active,
    /* Пояснение пишем сами: сообщение ФНС бывает пустым, а человеку
       нужно понимать не «NOT_FOUND», а что ему с этим делать. */
    what: active
      ? "На указанную дату человек был плательщиком налога на профессиональный доход. " +
        "Платить можно: НДФЛ и взносы за него платить не нужно. Обязательно возьмите чек из «Мой налог» — без чека расход не примут."
      : "На указанную дату плательщиком НПД человек НЕ был. Если заплатить как самозанятому, " +
        "вы становитесь налоговым агентом: придётся удержать НДФЛ и заплатить страховые взносы, а при проверке — ещё пени и штраф.",
    source: "ФНС России, сервис проверки статуса налогоплательщика НПД",
  };
  await remember(env, key, out);
  return json(env, origin, out);
}

/* POST /api/registry/company {inn} — выписка из ЕГРЮЛ или ЕГРИП.

   Работает, только если владелец сервиса подключил платный ключ:
   FNS_API_KEY в настройках. Бесплатного официального интерфейса
   для выписок не существует, а выдавать выдуманные сведения о живой
   компании — прямой способ подвести человека под сделку с кем угодно.

   Поэтому без ключа честно отвечаем «не подключено» и отправляем
   в бесплатные реестры, ссылки на которые уже есть на странице. */
export async function companyInfo(request, env, origin, user) {
  const b = await request.json().catch(() => ({}));
  const inn = String(b.inn || "").replace(/\D/g, "");

  if (inn.length !== 10 && inn.length !== 12)
    return fail(env, origin, "ИНН — это 10 цифр у организации или 12 у ИП");
  if (!innValid(inn))
    return fail(env, origin, "ИНН не проходит проверку по контрольной сумме — проверьте цифры");

  if (!env.FNS_API_KEY) {
    return json(env, origin, {
      inn, enabled: false,
      what: "Автоматическая выписка не подключена. Бесплатного официального интерфейса " +
            "к ЕГРЮЛ нет — сведения смотрите по ссылкам ниже, они бесплатны и достоверны.",
    });
  }

  const key = `egr:${inn}`;
  const hit = await cached(env, key);
  if (hit) return json(env, origin, { ...hit, cached: true });

  let res;
  try {
    res = await fetch(`https://api-fns.ru/api/egr?req=${inn}&key=${encodeURIComponent(env.FNS_API_KEY)}`,
      { signal: AbortSignal.timeout(TIMEOUT) });
  } catch (e) {
    console.error("egr", e && e.message);
    return fail(env, origin, "Реестр сейчас не отвечает, попробуйте позже", 503);
  }
  if (!res.ok) {
    console.error("egr", res.status);
    return fail(env, origin, `Реестр ответил ошибкой (${res.status})`, 502);
  }

  const d = await res.json().catch(() => null);
  const item = d?.items?.[0];
  const src = item?.ЮЛ || item?.ИП;
  if (!src) {
    return json(env, origin, { inn, enabled: true, found: false,
      what: "В реестре по этому ИНН ничего не нашлось. Проверьте цифры — возможно, опечатка." });
  }

  /* Отдаём наружу только то, что нужно для решения о сделке. Лишние
     поля — это лишние персональные данные, которые мы теперь храним. */
  const out = {
    inn, enabled: true, found: true,
    name: src.НаимСокрЮЛ || src.НаимПолнЮЛ || [src.ФИОПолн, src.ФИО].find(Boolean) || "",
    kind: item.ЮЛ ? "Организация" : "Индивидуальный предприниматель",
    ogrn: src.ОГРН || "",
    registered: src.ДатаОГРН || "",
    address: src.АдресПолн || src.Адрес?.АдресПолн || "",
    status: src.Статус || "",
    liquidated: Boolean(src.ДатаПрекр),
    liquidatedAt: src.ДатаПрекр || "",
    head: src.Руководитель?.ФИОПолн || "",
    activity: src.ОснВидДеят?.Наим || "",
    capital: src.УстКапитал?.СумКап || null,
    source: "ЕГРЮЛ/ЕГРИП через api-fns.ru",
  };
  await remember(env, key, out);
  return json(env, origin, out);
}
