/* ПравоФин — ИИ-воркер для Cloudflare Workers
   Тот же функционал, что backend/server.js: прокси к AITunnel,
   ключ только на сервере, CORS для сайта, лимит запросов. */
const AI_BASE_URL = "https://api.aitunnel.ru/v1";
const AI_API_KEY = "sk-aitunnel-pzJPkXgjt0TMEwaA00FCC6EBFSqCv9DK";
const AI_MODEL = "deepseek-chat";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json; charset=utf-8",
};

const DEFAULT_SYSTEM = `Ты — старший ИИ-консультант сервиса «ПравоФин» (право, налоги, финансы, бухучёт России). Сегодня: ${new Date().toLocaleDateString("ru-RU")}.

ПРАВИЛА:
1. Отвечай ПОДРОБНО и структурно: короткий вывод → разбор по пунктам → рекомендуемые действия. Сложные темы раскрывай полностью: этапы, сроки, суммы, номера статей (ГК РФ, НК РФ, ТК РФ, ФЗ-127 и др.).
2. НЕОВРЕМЕННОСТЬ ДАННЫХ: твои знания могут отставать от изменений законодательства. При ответах о ставках, лимитах, сроках добавляй в конце: «Проверьте актуальную редакцию — нормы регулярно меняются (КонсультантПлюс, сайт ФНС)».
3. Это информационная справка, не юридическая консультация — упоминай один раз кратко в конце.
4. НЕ ПО ТЕМЕ: на вопросы не о праве/налогах/финансах/бизнесе отвечай ровно: «Я консультант ПравоФин и отвечаю только на рабочие вопросы: право, налоги, финансы, бухучёт. Чем могу помочь по делу?»
5. Если для точного ответа нужен статус (ИП/ООО/самозанятый), суммы или регион — дай разбор по вариантам и задай 1–2 уточняющих вопроса в конце.
6. Русский язык, деловой и живой, без воды.`;

/* Лимит: 40 запросов/час на IP (в пределах одного инстанса — базовая защита) */
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < 3600000);
  if (arr.length >= 40) return true;
  arr.push(now);
  hits.set(ip, arr);
  return false;
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (url.pathname === "/api/health")
      return new Response(JSON.stringify({ ok: true, model: AI_MODEL, host: "cloudflare-workers" }), { headers: CORS });
    if (url.pathname !== "/api/ai" || request.method !== "POST")
      return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: CORS });

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    if (rateLimited(ip))
      return new Response(JSON.stringify({ error: "Слишком много запросов, попробуйте через час" }), { status: 429, headers: CORS });

    let body;
    try { body = await request.json(); } catch { body = {}; }
    const prompt = String(body.prompt || "").slice(0, 12000);
    const system = String(body.system || DEFAULT_SYSTEM).slice(0, 4000);
    if (!prompt) return new Response(JSON.stringify({ error: "Пустой запрос" }), { status: 400, headers: CORS });

    try {
      const r = await fetch(AI_BASE_URL + "/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + AI_API_KEY },
        body: JSON.stringify({
          model: AI_MODEL,
          messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
          max_tokens: Math.min(3000, body.maxTokens || 1500),
        }),
      });
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        return new Response(JSON.stringify({ error: "Ошибка ИИ-провайдера " + r.status + " " + t.slice(0, 200) }), { status: 502, headers: CORS });
      }
      const data = await r.json();
      return new Response(JSON.stringify({ text: data.choices[0].message.content }), { headers: CORS });
    } catch (e) {
      return new Response(JSON.stringify({ error: "Сбой соединения: " + e.message }), { status: 500, headers: CORS });
    }
  },
};
