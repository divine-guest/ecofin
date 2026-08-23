/* ПравоФин — прокси к ИИ. Ключ живёт только в секретах воркера,
   лимиты проверяются здесь, до обращения к провайдеру. */
import { json, fail, isPro } from "./lib.js";
import { aiQuota, toolQuota, spendAI, spendTool } from "./quota.js";
import { logAction } from "./auth.js";
import { rewardIfEarned } from "./referral.js";

const MAX_PROMPT = 12000;
const MAX_SYSTEM = 4000;
const UPSTREAM_TIMEOUT = 60000;
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024; // ~4,5 МБ исходника после base64

export const DEFAULT_SYSTEM = `Ты — старший ИИ-консультант сервиса «ПравоФин» (право, налоги, финансы, бухучёт России).

ПРАВИЛА:
1. Отвечай ПОДРОБНО и структурно: короткий вывод → разбор по пунктам → рекомендуемые действия. Сложные темы раскрывай полностью: этапы, сроки, суммы, номера статей (ГК РФ, НК РФ, ТК РФ, ФЗ-127 и др.).
2. АКТУАЛЬНОСТЬ ДАННЫХ: твои знания могут отставать от изменений законодательства. При ответах о ставках, лимитах, сроках добавляй в конце: «Проверьте актуальную редакцию — нормы регулярно меняются (КонсультантПлюс, сайт ФНС)».
3. Это информационная справка, не юридическая консультация — упоминай один раз кратко в конце.
4. НЕ ПО ТЕМЕ: на вопросы не о праве/налогах/финансах/бизнесе отвечай ровно: «Я консультант ПравоФин и отвечаю только на рабочие вопросы: право, налоги, финансы, бухучёт. Чем могу помочь по делу?»
5. Если для точного ответа нужен статус (ИП/ООО/самозанятый), суммы или регион — дай разбор по вариантам и задай 1–2 уточняющих вопроса в конце.
6. Русский язык, деловой и живой, без воды.`;

const ANALYZE_SYSTEM = `Ты — юрист-аналитик сервиса «ПравоФин». Тебе передают текст или скан документа (договор, претензия, уведомление, акт, решение).

Разбери его строго по структуре:
1. ЧТО ЭТО ЗА ДОКУМЕНТ — вид, стороны, предмет, дата, срок действия.
2. КЛЮЧЕВЫЕ УСЛОВИЯ — цена, порядок расчётов, сроки, ответственность, порядок расторжения.
3. РИСКИ — по пунктам, каждый со ссылкой на норму (ГК РФ, ТК РФ, НК РФ, 152-ФЗ и др.) и пометкой критичности: высокая / средняя / низкая.
4. ЧЕГО НЕ ХВАТАЕТ — обязательные условия, отсутствующие в тексте.
5. ЧТО СДЕЛАТЬ — конкретные формулировки правок, пронумерованно.

Если текст обрывочный или скан читается плохо — прямо скажи, какие места не разобрал, и не выдумывай их содержание.
В конце одной строкой: разбор информационный, не заменяет юридическую консультацию.`;

async function callProvider(env, { model, messages, maxTokens }) {
  const base = env.AI_BASE_URL || "https://api.aitunnel.ru/v1";
  const r = await fetch(base + "/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + env.AI_API_KEY },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens }),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    console.error("upstream", r.status, t.slice(0, 500)); // детали в логи, не пользователю
    throw Object.assign(new Error("provider"), { status: r.status });
  }
  const data = await r.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw Object.assign(new Error("empty"), { status: 502 });
  return text;
}

function upstreamError(env, origin, e) {
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
  if (!env.AI_API_KEY) return fail(env, origin, "AI_API_KEY не задан в секретах воркера", 500);

  const b = await request.json().catch(() => ({}));
  const prompt = String(b.prompt || "").slice(0, MAX_PROMPT);
  const system = String(b.system || DEFAULT_SYSTEM).slice(0, MAX_SYSTEM);
  const kind = b.kind === "tool" ? "tool" : "chat";
  if (!prompt) return fail(env, origin, "Пустой запрос");

  const spent = kind === "tool" ? await spendTool(env, user) : await spendAI(env, user);
  if (!spent) {
    return paywall(env, origin, kind === "tool"
      ? "Пробный запуск инструментов израсходован. Оформите Pro, чтобы пользоваться без ограничений"
      : "Дневной лимит обращений к ИИ исчерпан. Оформите Pro — лимит снимается", kind);
  }

  try {
    const text = await callProvider(env, {
      model: env.AI_MODEL || "deepseek-chat",
      messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
      maxTokens: Math.min(3000, Math.max(200, Number(b.maxTokens) || 1500)),
    });
    /* Приглашение окупилось: человек не просто зарегистрировался, а поработал.
       Награду начисляем тихо — на ответ она не влияет. */
    await rewardIfEarned(env, user.email).catch(() => {});
    return json(env, origin, { text, quota: await quotaSnapshot(env, user) });
  } catch (e) {
    return upstreamError(env, origin, e);
  }
}

/* POST /api/analyze — разбор документа: текст из файла и/или страницы-картинки. */
export async function handleAnalyze(request, env, origin, user) {
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

  const spent = await spendTool(env, user);
  if (!spent) return paywall(env, origin, "Пробный запуск израсходован. Анализ документов доступен по подписке Pro", "tool");

  /* Со сканами работает только зрячая модель; чистый текст отдаём дешёвой текстовой. */
  const vision = images.length > 0;
  const model = vision ? (env.AI_VISION_MODEL || "gpt-4o-mini") : (env.AI_MODEL || "deepseek-chat");

  const content = vision
    ? [
        { type: "text", text: `Файл: ${fileName}\n${text ? "Распознанный текст:\n" + text + "\n\n" : ""}Разбери документ на изображениях ниже.` },
        ...images.map(url => ({ type: "image_url", image_url: { url } })),
      ]
    : `Файл: ${fileName}\n\nТекст документа:\n${text}`;

  try {
    const out = await callProvider(env, {
      model,
      messages: [{ role: "system", content: ANALYZE_SYSTEM }, { role: "user", content }],
      maxTokens: 3000,
    });
    await logAction(env, user.email, "Анализ документа: " + fileName);
    return json(env, origin, { text: out, quota: await quotaSnapshot(env, user) });
  } catch (e) {
    return upstreamError(env, origin, e);
  }
}

/* Актуальные остатки. Читаем пользователя заново: списание уже произошло. */
export async function quotaSnapshot(env, user) {
  const fresh = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(user.email).first();
  const ai = await aiQuota(env, fresh);
  const tool = toolQuota(fresh);
  return {
    pro: isPro(fresh),
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
