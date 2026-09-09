/* ЭкоФин — прокси к ИИ. Ключ живёт только в секретах воркера,
   лимиты проверяются здесь, до обращения к провайдеру. */
import { json, fail, isPro, abroadPaused, PAUSED_AI,
         TEXT_ALLOWED, modelAllowed } from "./lib.js";
/* Выверенные ставки едут вместе с вопросом. Собирается из js/rates.js
   скриптом scripts/make-rates-digest.mjs — руками не править. */
import { RATES_DIGEST } from "./rates-digest.js";
import { aiQuota, toolQuota, spendAI, spendTool, analyzeQuota, spendAnalyze,
         refundAI, refundTool, refundAnalyze } from "./quota.js";
import { logAction } from "./auth.js";
import { recognize, ocrReady, localOcrReady } from "./vision.js";
import { redact, restore, redactOn } from "./redact.js";
import { rewardIfEarned } from "./referral.js";

const MAX_PROMPT = 12000;
const MAX_SYSTEM = 4000;
const UPSTREAM_TIMEOUT = 60000;
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024; // ~4,5 МБ исходника после base64

/* Ответ модели попадает на страницу как обычный текст, без разбора
   разметки: его копируют, печатают и вставляют в документы. Поэтому
   «**жирный**» из markdown приезжает к человеку буквально — звёздочками
   посреди предложения. Выглядит как сбой, а в готовом документе —
   как брак.

   Правило добавляется ко ВСЕМ подсказкам, включая те, что инструменты
   присылают свои: иначе каждый новый инструмент пришлось бы чинить
   отдельно, и рано или поздно кто-нибудь забыл бы. */
export const PLAIN_TEXT_RULE = `

ОФОРМЛЕНИЕ ОТВЕТА — ОБЯЗАТЕЛЬНО:
Пиши простым текстом. НЕ используй markdown: никаких звёздочек для выделения (* ** ***), никаких решёток для заголовков (#), никаких обратных кавычек, никаких подчёркиваний для курсива, никаких горизонтальных линий из дефисов или звёздочек.
Заголовки пиши ЗАГЛАВНЫМИ БУКВАМИ с новой строки. Списки — цифрами «1.» или тире «—». Выделять важное можно только словами и порядком изложения.
Текст пойдёт прямо в документ, который человек распечатает: любой символ разметки в нём будет выглядеть браком.`;

export const DEFAULT_SYSTEM = `Ты — старший ИИ-консультант сервиса «ЭкоФин» (право, налоги, финансы, бухучёт России).

ПРАВИЛА:
1. Отвечай ПОДРОБНО и структурно: короткий вывод → разбор по пунктам → рекомендуемые действия. Сложные темы раскрывай полностью: этапы, сроки, суммы, номера статей (ГК РФ, НК РФ, ТК РФ, ФЗ-127 и др.).
2. ЧИСЛА БЕРИ ИЗ СПРАВКИ НИЖЕ, а не из памяти. Ставки, лимиты и базы приведены в конце этой подсказки — они выверены и совпадают с калькуляторами сайта. Если твои знания расходятся со справкой, верна справка. Значение, которого в справке нет, по памяти не называй: скажи, где свериться, или предложи калькулятор.
3. Это информационная справка, не юридическая консультация — упоминай один раз кратко в конце.
4. НЕ ПО ТЕМЕ: на вопросы не о праве/налогах/финансах/бизнесе отвечай ровно: «Я консультант ЭкоФин и отвечаю только на рабочие вопросы: право, налоги, финансы, бухучёт. Чем могу помочь по делу?»
5. Если для точного ответа нужен статус (ИП/ООО/самозанятый), суммы или регион — дай разбор по вариантам и задай 1–2 уточняющих вопроса в конце.
6. Русский язык, деловой и живой, без воды.
7. НАЛОГОВЫЕ РЕЖИМЫ: в России их семь — НПД, УСН «Доходы» 6%, УСН «Доходы минус расходы» 15%, патент (ПСН), АУСН, ЕСХН и ОСНО. Когда речь о выборе или сравнении режимов, рассматривай все подходящие, а не только УСН, и объясняй, почему остальные не подходят. Патент и АУСН зависят от региона — говори, где проверить.

${RATES_DIGEST}`;

/* Распознавание — не пересказ. Модель охотно «улучшает» текст: правит
   опечатки, дописывает недостающее, переставляет пункты. Для документа
   это яд: человек потом сошлётся на пункт, которого в бумаге нет.
   Поэтому запрет на додумывание стоит первым и повторён дважды. */
export const OCR_SYSTEM = `Ты распознаёшь текст с фотографий и сканов документов.

ПРАВИЛА:
1. Перепечатай текст ДОСЛОВНО. Ничего не пересказывай, не сокращай, не исправляй и не дополняй.
2. Сохрани структуру: заголовки, нумерацию пунктов, таблицы (таблицы — простым текстом со столбцами через пробелы), подписи и реквизиты.
3. Если фрагмент не читается — поставь на его месте [неразборчиво] и продолжай. НЕ придумывай, что там могло быть написано.
4. Не добавляй от себя ни заголовков, ни комментариев, ни выводов. Только то, что есть на изображении.
5. Если страниц несколько — раздели их строкой «--- страница N ---».
6. Числа, даты, номера и суммы переписывай особенно внимательно: именно из-за них документ и распознают.
7. Не добавляй разметку от себя: никаких звёздочек, решёток и обратных кавычек. Если их нет в бумаге — не должно быть и в расшифровке. Если они в бумаге есть — переписывай как есть.`;

const ANALYZE_SYSTEM = `Ты — юрист-аналитик сервиса «ЭкоФин». Тебе передают текст или скан документа (договор, претензия, уведомление, акт, решение).

Разбери его строго по структуре:
1. ЧТО ЭТО ЗА ДОКУМЕНТ — вид, стороны, предмет, дата, срок действия.
2. КЛЮЧЕВЫЕ УСЛОВИЯ — цена, порядок расчётов, сроки, ответственность, порядок расторжения.
3. РИСКИ — по пунктам, каждый со ссылкой на норму (ГК РФ, ТК РФ, НК РФ, 152-ФЗ и др.) и пометкой критичности: высокая / средняя / низкая.
4. ЧЕГО НЕ ХВАТАЕТ — обязательные условия, отсутствующие в тексте.
5. ЧТО СДЕЛАТЬ — конкретные формулировки правок, пронумерованно.

Если текст обрывочный или скан читается плохо — прямо скажи, какие места не разобрал, и не выдумывай их содержание.
В конце одной строкой: разбор информационный, не заменяет юридическую консультацию.`;

/* Какая модель отвечает.

   Ветка со зрячей моделью убрана намеренно. Изображения теперь
   распознаются в России (vision.js), и к модели уходит уже текст.
   Оставленный «на всякий случай» путь для картинок был бы дырой в
   том самом месте, которое мы закрывали: политика обещает, что
   распознавание идёт внутри страны, и в коде не должно быть тихого
   обхода этого обещания. */
/* Единственное место, где выбирается текстовая модель. Раньше
   выражение env.AI_MODEL || "deepseek-chat" было переписано в пяти
   местах — ровно та копипаста, из-за которой бот отправлял вопросы
   мимо обезличивания.

   Модель вне списка не подставляется молча: возвращаем null, и
   обращение не состоится. Лучше временно неработающий консультант,
   который об этом сообщает, чем работающий и уводящий данные не туда. */
const FALLBACK_MODEL = "deepseek-v4-flash";

export function MODEL_FOR(env) {
  const want = String(env.AI_MODEL || "").trim() || FALLBACK_MODEL;
  if (!TEXT_ALLOWED[want]) {
    console.error(
      `ai: модель «${want}» не в списке разрешённых. ` +
      `Разрешены: ${Object.keys(TEXT_ALLOWED).join(", ")}`);
    return null;
  }
  return want;
}

export async function callProvider(env, { model, messages, maxTokens }) {
  /* Единственная дверь наружу к модели: и чат, и разбор документа, и
     запасное распознавание картинки идут через неё. Поэтому и запрет
     стоит здесь — не в каждом обработчике, где его однажды забудут
     поставить, а в том месте, мимо которого пройти нельзя. */
  if (abroadPaused(env)) throw Object.assign(new Error("paused"), { status: 503 });

  /* Модель вне списков — наружу не идём. Проверка стоит здесь, а не
     только там, где модель выбирается: сюда сходятся все обращения,
     включая бот, фоновые задачи и распознавание. */
  if (!modelAllowed(model)) {
    console.error("ai: обращение с моделью вне списка отклонено:", model);
    throw Object.assign(new Error("unlisted"), { status: 503 });
  }

  const base = env.AI_BASE_URL || "https://api.aitunnel.ru/v1";
  const r = await fetch(base + "/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + env.AI_API_KEY },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens }),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    /* Ответ поставщика при ошибке нередко повторяет кусок
       запроса, а в запросе бывает текст договора. Пишем код
       состояния и первые символы — их хватает, чтобы отличить
       нехватку денег на счёте от неверной модели. */
    console.error("upstream", r.status, t.slice(0, 80));
    throw Object.assign(new Error("provider"), { status: r.status });
  }
  const data = await r.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw Object.assign(new Error("empty"), { status: 502 });
  return text;
}

export function upstreamError(env, origin, e) {
  /* Выключено намеренно — это не сбой, и говорить о сбое нечестно. */
  if (e.message === "paused") return fail(env, origin, PAUSED_AI, 503);
  /* Модель вне списка — это не сбой поставщика, а наша ошибка
     в настройках. Врать про поставщика незачем. */
  if (e.message === "unlisted")
    return fail(env, origin, "ИИ-консультант временно недоступен из-за настроек сервиса. Мы уже знаем и разбираемся.", 503);
  if (e.name === "TimeoutError" || e.name === "AbortError")
    return fail(env, origin, "ИИ не ответил вовремя. Попробуйте ещё раз или сократите текст", 504);
  if (e.message === "empty")
    return fail(env, origin, "ИИ вернул пустой ответ, попробуйте переформулировать", 502);
  if (e.status === 401 || e.status === 403)
    return fail(env, origin, "Ключ ИИ-провайдера отклонён — сообщите администратору", 502);
  if (e.status === 429)
    return fail(env, origin, "ИИ-провайдер перегружен, попробуйте через минуту", 503);
  return fail(env, origin, "ИИ-провайдер недоступен, попробуйте позже", 502);
}

const paywall = (env, origin, message, kind) =>
  json(env, origin, { error: message, paywall: true, kind }, 402);

/* POST /api/ai — чат-консультант и текстовые инструменты.
   kind:'chat' расходует дневной лимит ИИ, kind:'tool' — пробный запуск инструмента. */
export async function handleAI(request, env, origin, user) {
  if (abroadPaused(env)) return fail(env, origin, PAUSED_AI, 503);
  if (!env.AI_API_KEY) return fail(env, origin, "AI_API_KEY не задан в секретах воркера", 500);

  const b = await request.json().catch(() => ({}));
  const prompt = String(b.prompt || "").slice(0, MAX_PROMPT);
  const system = String(b.system || DEFAULT_SYSTEM).slice(0, MAX_SYSTEM) + PLAIN_TEXT_RULE;
  const kind = b.kind === "tool" ? "tool" : "chat";
  if (!prompt) return fail(env, origin, "Пустой запрос");

  const spent = kind === "tool" ? await spendTool(env, user) : await spendAI(env, user);
  if (!spent) {
    /* Зовём в «Базовый», а не в «Про»: ограничение снимает уже он.
       Называть цену выше настоящей — лишний барьер на ровном месте. */
    return paywall(env, origin, kind === "tool"
      ? "Пробный запуск израсходован. Инструменты без ограничений — в тарифе «Базовый» за 290 ₽ в месяц"
      : "На сегодня вопросы закончились. В тарифе «Базовый» их 300 в день — это 290 ₽ в месяц", kind);
  }

  /* Обезличиваем перед отправкой. Вычисления идут за пределами
     России, и пока в тексте есть опознаватели человека — это
     трансграничная передача персональных данных. После замены
     передавать нечего.

     Соответствие меток и настоящих значений остаётся здесь, в памяти
     этого запроса, и никуда не записывается. */
  const hide = redactOn(env) ? redact(prompt) : { text: prompt, map: new Map() };

  try {
    let text = await callProvider(env, {
      model: MODEL_FOR(env),
      messages: [{ role: "system", content: system }, { role: "user", content: hide.text }],
      maxTokens: Math.min(3000, Math.max(200, Number(b.maxTokens) || 1500)),
    });
    /* Возвращаем настоящие значения: иначе человек прочитает
       «[ФИО-1] обязан уплатить» и решит, что сервис сломался. */
    text = restore(text, hide.map);
    /* Приглашение окупилось: человек не просто зарегистрировался, а поработал.
       Награду начисляем тихо — на ответ она не влияет. */
    await rewardIfEarned(env, user.email).catch(() => {});
    return json(env, origin, { text, quota: await quotaSnapshot(env, user) });
  } catch (e) {
    /* Ответа нет — возвращаем списанное. Иначе провайдер «икнул», а
       заплатил за это человек: у бесплатного тарифа пробный запуск один. */
    await (kind === "tool" ? refundTool(env, user) : refundAI(env, user));
    return upstreamError(env, origin, e);
  }
}

/* POST /api/analyze — разбор документа: текст из файла и/или страницы-картинки. */
export async function handleAnalyze(request, env, origin, user) {
  if (abroadPaused(env)) return fail(env, origin, PAUSED_AI, 503);
  if (!env.AI_API_KEY) return fail(env, origin, "AI_API_KEY не задан в секретах воркера", 500);

  const b = await request.json().catch(() => ({}));
  const text = String(b.text || "").slice(0, MAX_PROMPT);
  const images = Array.isArray(b.images) ? b.images.slice(0, MAX_IMAGES) : [];
  const fileName = String(b.fileName || "документ").slice(0, 200);

  for (const img of images) {
    if (typeof img !== "string" || !img.startsWith("data:image/"))
      return fail(env, origin, "Некорректный формат изображения");
    if (img.length > MAX_IMAGE_BYTES)
      return fail(env, origin, "Изображение слишком большое — сожмите до 4 МБ");
  }
  if (!text && !images.length) return fail(env, origin, "Не из чего делать разбор: пустой файл");

  /* На бесплатном тарифе разбор идёт за счёт пробного запуска, на платных —
     за счёт месячной квоты разборов. */
  if (isPro(user)) {
    const spent = await spendAnalyze(env, user);
    if (!spent) {
      const q = await analyzeQuota(env, user);
      return paywall(env, origin,
        `Разборов документов в этом месяце израсходовано ${q.spent} из ${q.limit}. На тарифе «Про» их без ограничений`,
        "analyze");
    }
  } else {
    const spent = await spendTool(env, user);
    if (!spent) return paywall(env, origin,
      "Пробный запуск израсходован. Разбор документов входит в платные тарифы", "tool");
  }

  /* Изображения сначала превращаются в текст, и только потом идут в
     разбор. Раньше картинка уходила прямо в зрячую модель за границей —
     это тот самый канал, который нельзя прикрыть маскированием.

     Заодно разбор стал дешевле: текстовая модель на порядок дешевле
     зрячей, а распознавание тарифицируется как страница. */
  let full = text;
  if (images.length) {
    try {
      const r = await recognize(env, images, { callProvider, fileName });
      full = [text, r.text].filter(Boolean).join("\n\n");
    } catch (e) {
      await (isPro(user) ? refundAnalyze(env, user) : refundTool(env, user));
      return upstreamError(env, origin, e);
    }
  }
  if (!full.trim()) {
    await (isPro(user) ? refundAnalyze(env, user) : refundTool(env, user));
    return fail(env, origin, "Не удалось прочитать документ: страница пустая или снимок нечёткий");
  }

  const model = MODEL_FOR(env);
  /* Распознанный текст документа обезличивается так же, как вопрос:
     в договоре и в требовании из налоговой опознавателей больше, чем
     где-либо ещё. */
  const hide = redactOn(env) ? redact(full) : { text: full, map: new Map() };
  const content = `Файл: ${fileName}\n\nТекст документа:\n${hide.text}`;

  /* Своя системная подсказка. Раньше здесь стояла одна на всё —
     «разбери документ», — и зрячая модель годилась ровно для одного
     инструмента. Любому другому, которому нужен файл (протокол
     разногласий, ответ на требование), она вернула бы вместо его
     результата обычный разбор.

     Длина ограничена тем же пределом, что и в текстовой ручке: это
     строка из браузера, и доверять её размеру нельзя. */
  const system = (String(b.system || "").slice(0, MAX_SYSTEM) || ANALYZE_SYSTEM) + PLAIN_TEXT_RULE;

  try {
    const out = await callProvider(env, {
      model,
      messages: [{ role: "system", content: system }, { role: "user", content }],
      maxTokens: 3000,
    });
    await logAction(env, user.email, "Анализ документа: " + fileName);
    return json(env, origin, {
      text: restore(out, hide.map),
      quota: await quotaSnapshot(env, user),
    });
  } catch (e) {
    await (isPro(user) ? refundAnalyze(env, user) : refundTool(env, user));
    return upstreamError(env, origin, e);
  }
}

/* POST /api/ocr — превратить фотографии страниц в текст, и только.

   Зачем отдельно от /api/analyze. Разбор документа возвращает готовый
   вывод: риски, чего не хватает, что исправить. Но фотографию человек
   приносит и в другие инструменты — составить ответ на претензию,
   объяснить простыми словами, сравнить две редакции. Там нужен не
   разбор, а сам текст: дальше с ним работает уже свой инструмент.

   Раньше это означало «перепечатайте руками», то есть чаще всего —
   «не пользуйтесь». Теперь любое поле на сайте принимает фото.

   Расход тот же, что у разбора: работает та же зрячая модель, и она
   стоит столько же. Считать распознавание бесплатным было бы способом
   получать разбор в обход лимита — достаточно распознать, а потом
   отправить текст обычным инструментом. */
export async function handleOcr(request, env, origin, user) {
  /* Здесь запрет условный, и это важно. Распознавание идёт тремя
     путями, и первые два — Yandex Vision и tesseract на нашей же
     машине — за границу ничего не отправляют. Останавливать их вместе
     с моделью значило бы выключить работающее вместе с выключенным.
     Отказываем только тогда, когда остаётся один путь — зарубежный. */
  if (abroadPaused(env) && !ocrReady(env) && !(await localOcrReady()))
    return fail(env, origin, PAUSED_AI, 503);
  if (!env.AI_API_KEY && !ocrReady(env) && !(await localOcrReady()))
    return fail(env, origin, "AI_API_KEY не задан в секретах воркера", 500);

  const b = await request.json().catch(() => ({}));
  const images = Array.isArray(b.images) ? b.images.slice(0, MAX_IMAGES) : [];
  const fileName = String(b.fileName || "документ").slice(0, 200);

  if (!images.length) return fail(env, origin, "Нет изображений для распознавания");
  for (const img of images) {
    if (typeof img !== "string" || !img.startsWith("data:image/"))
      return fail(env, origin, "Некорректный формат изображения");
    if (img.length > MAX_IMAGE_BYTES)
      return fail(env, origin, "Изображение слишком большое — сожмите до 4 МБ");
  }

  /* Списываем так же, как разбор: на платных — из месячной квоты
     разборов, на бесплатном — из пробного запуска. */
  if (isPro(user)) {
    const spent = await spendAnalyze(env, user);
    if (!spent) {
      const q = await analyzeQuota(env, user);
      return paywall(env, origin,
        `Распознано документов в этом месяце ${q.spent} из ${q.limit}. На тарифе «Про» их без ограничений`,
        "analyze");
    }
  } else {
    const spent = await spendTool(env, user);
    if (!spent) return paywall(env, origin,
      "Пробный запуск израсходован. Распознавание документов по фото входит в платные тарифы", "tool");
  }

  try {
    const { text, where } = await recognize(env, images, { callProvider, fileName });
    /* В журнале видно, кто распознавал. Политика обещает, что это
       происходит в России, и запасной путь не должен уходить за
       границу незаметно. */
    await logAction(env, user.email,
      `Распознан документ: ${fileName}` + (where === "ru" ? "" : " (зарубежная модель)"));
    return json(env, origin, { text, quota: await quotaSnapshot(env, user) });
  } catch (e) {
    await (isPro(user) ? refundAnalyze(env, user) : refundTool(env, user));
    return upstreamError(env, origin, e);
  }
}

/* Актуальные остатки. Читаем пользователя заново: списание уже произошло. */
export async function quotaSnapshot(env, user) {
  const fresh = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(user.email).first();
  const ai = await aiQuota(env, fresh);
  const tool = toolQuota(fresh);
  const analyze = await analyzeQuota(env, fresh);
  return {
    pro: isPro(fresh),
    tier: ai.tier,
    analyze: { left: analyze.left, limit: analyze.limit },
    ai: { left: ai.left, limit: ai.limit },
    tool: {
      left: tool.left === Infinity ? null : tool.left,
      limit: tool.limit === Infinity ? null : tool.limit,
    },
  };
}

/* GET /api/quota — кабинет и пейволл рисуются по этим числам. */
export async function handleQuota(request, env, origin, user) {
  return json(env, origin, await quotaSnapshot(env, user));
}
