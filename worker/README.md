# ИИ-бэкенд ПравоФин на Cloudflare Workers

Заменяет `backend/` на Render: нет засыпания, ~50 мс отклик, 100 000 запросов/сутки бесплатно.

## Развёртывание

```bash
cd worker
npm install
npx wrangler login          # или: export CLOUDFLARE_API_TOKEN=...
npx wrangler secret put AI_API_KEY   # вставить НОВЫЙ ключ AITunnel
npx wrangler deploy
```

Wrangler напечатает адрес вида `https://pravofin-ai.<ваш-субдомен>.workers.dev`.
Этот адрес вписывается в `js/ai.js` → `AI.BACKEND_URL`.

## Проверка

```bash
curl https://pravofin-ai.<субдомен>.workers.dev/api/health
```

Должно вернуться `{"ok":true,"model":"deepseek-chat","key":true,...}`.
`"key": false` означает, что секрет `AI_API_KEY` не задан.

## Важное

- Ключ провайдера хранится ТОЛЬКО в секретах Cloudflare. В репозитории его нет и быть не должно.
- Список доменов, которым разрешён доступ, — константа `ALLOWED_ORIGINS` в `src/index.js`.
  При переезде на свой домен добавьте его туда и передеплойте.
- Лимит 40 запросов/час на IP. Без KV он считается по каждому изоляту отдельно
  (реальный лимит выше). Для честного счёта создайте KV-namespace и раскомментируйте
  блок `kv_namespaces` в `wrangler.toml`.
