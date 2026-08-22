# Как запустить ИИ-бэкенд (5 минут)

Бэкенд нужен, чтобы ключ ИИ не светился в коде сайта. Сайт на GitHub Pages
продолжает работать как есть; при подключении URL бэкенда все ИИ-функции
(инструменты, чат, личный чат) начинают отвечать настоящим ИИ.

## Шаг 1. Получите API-ключ ИИ (любой один вариант)

| Провайдер | Где взять | Что вписать в Render |
|---|---|---|
| OpenAI | platform.openai.com → API keys | AI_BASE_URL: `https://api.openai.com/v1`, AI_MODEL: `gpt-4o-mini` |
| YandexGPT | console.yandex.cloud → сервисные аккаунты → API-ключ | AI_BASE_URL: `https://llm.api.cloud.yandex.net/v1compat` (OpenAI-совместимый), AI_MODEL: `yandexgpt-lite` |
| DeepSeek | platform.deepseek.com | AI_BASE_URL: `https://api.deepseek.com/v1`, AI_MODEL: `deepseek-chat` |
| Groq (бесплатно) | console.groq.com | AI_BASE_URL: `https://api.groq.com/openai/v1`, AI_MODEL: `llama-3.3-70b-versatile` |

## Шаг 2. Задеплойте на Render (бесплатный тариф)

1. Зайдите на render.com через аккаунт GitHub
2. New → Blueprint → выберите репозиторий `divine-guest/ecofin`
   (Render сам увидит `render.yaml` и создаст сервис `pravofin-ai`)
3. При создании он спросит AI_API_KEY — вставьте ключ из шага 1
4. Дождитесь статуса Live — скопируйте URL вида
   `https://pravofin-ai.onrender.com`
5. Проверка: откройте `https://ваш-url/api/health` — должно быть `{"ok":true,...}`

Альтернатива вручную: New → Web Service → репозиторий ecofin →
Root Directory: `backend` → Build: `npm install` → Start: `npm start` →
добавьте переменные AI_API_KEY, AI_BASE_URL, AI_MODEL.

## Шаг 3. Подключите сайт

Откройте `js/ai.js`, найдите строку `BACKEND_URL: ""` и впишите ваш URL:

```js
BACKEND_URL: "https://pravofin-ai.onrender.com",
```

Закоммитьте изменения — через минуту весь сайт отвечает через ИИ.

## Что уже учтено

- CORS разрешён только для GitHub Pages и localhost
- Лимит 40 запросов/час с IP — ключ не сольют
- Ключ читается только из переменных окружения Render
- Если бэкенд спит (free-тариф засыпает через 15 мин) — первый запрос
  может занять ~30 сек, сайт в это время показывает «Генерация…»

## Локальный запуск для проверки

```bash
cd backend && npm install
AI_API_KEY=ваш_ключ npm start
# проверка: curl localhost:3000/api/health
```
