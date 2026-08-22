/* ПравоФин — ИИ-бэкенд (деплой на Render)
   Проксирует запросы к ИИ: ключ хранится ТОЛЬКО здесь, в переменных окружения.
   Работает с любым OpenAI-совместимым API: OpenAI, YandexGPT (compat), Groq, DeepSeek и др. */
const express = require("express");
const cors = require("cors");

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(cors({ origin: [/\.github\.io$/, /^https?:\/\/localhost(:\d+)?$/] }));

const BASE = process.env.AI_BASE_URL || "https://api.openai.com/v1";
const KEY = process.env.AI_API_KEY || "";
const MODEL = process.env.AI_MODEL || "gpt-4o-mini";

/* Простой лимит: 40 запросов в час с одного IP — защита ключа от расхищения */
const hits = new Map();
function rateLimit(req, res, next) {
  const ip = req.headers["x-forwarded-for"] || req.ip;
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(t => now - t < 3600000);
  if (arr.length >= 40) return res.status(429).json({ error: "Слишком много запросов, попробуйте через час" });
  arr.push(now);
  hits.set(ip, arr);
  next();
}

app.post("/api/ai", rateLimit, async (req, res) => {
  if (!KEY) return res.status(500).json({ error: "AI_API_KEY не задан в переменных окружения Render" });
  const prompt = String(req.body.prompt || "").slice(0, 12000);
  if (!prompt) return res.status(400).json({ error: "Пустой запрос" });
  try {
    const r = await fetch(BASE + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + KEY },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content: prompt }],
        max_tokens: Math.min(2000, req.body.maxTokens || 1200),
      }),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      return res.status(502).json({ error: "Ошибка ИИ-провайдера " + r.status + " " + t.slice(0, 200) });
    }
    const data = await r.json();
    res.json({ text: data.choices[0].message.content });
  } catch (e) {
    res.status(500).json({ error: "Сбой соединения: " + e.message });
  }
});

app.get("/api/health", (req, res) => res.json({ ok: true, model: KEY ? MODEL : "ключ не задан" }));

const port = process.env.PORT || 3000;
app.listen(port, () => console.log("PravoFin AI backend on port " + port));
