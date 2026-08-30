/* Куда Telegram присылает сообщения бота.

   Бот не опрашивает сервер сам — наоборот, Telegram стучится к нам на
   указанный адрес. Пока адрес указывает на Cloudflare, все команды бота
   пишутся в старую базу: человек подключит телеграм, а на новом сервере
   этого не будет. Поэтому переставить адрес — обязательная часть переезда,
   а не украшение.

   Telegram принимает только https и только действующий сертификат.
   Секретный заголовок обязателен: без него любой, кто узнает адрес,
   сможет присылать серверу поддельные сообщения от имени людей.

   Запуск:
       node worker/set-webhook.mjs                 — показать, куда стоит сейчас
       node worker/set-webhook.mjs <адрес сайта>   — переставить

   Например:
       node worker/set-webhook.mjs https://84-201-164-112.nip.io          */

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

const env = {};
try {
  const raw = await readFile(join(HERE, ".env"), "utf8");
  for (const line of raw.replace(/\r\n?/g, "\n").split("\n")) {
    const m = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
} catch {
  console.error("Не нашёл worker/.env — без него нет токена бота.");
  process.exit(1);
}

const TOKEN = env.TELEGRAM_BOT_TOKEN;
const SECRET = env.TELEGRAM_WEBHOOK_SECRET;
if (!TOKEN) {
  console.error("В worker/.env нет TELEGRAM_BOT_TOKEN.");
  process.exit(1);
}

/* У Node короткий таймаут на установку соединения, и до Telegram он
   с первой попытки доходит не всегда — к самому Telegram это отношения
   не имеет. В тестах для этого уже есть такой же обход. */
async function tryFetch(url, init, attempts = 5) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try { return await fetch(url, init); }
    catch (e) { last = e; await new Promise(r => setTimeout(r, 1200 * (i + 1))); }
  }
  throw last;
}

const api = async (method, body) => {
  const r = await tryFetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  return r.json();
};

const info = async () => {
  const j = await api("getWebhookInfo");
  if (!j.ok) throw new Error(JSON.stringify(j).slice(0, 200));
  return j.result;
};

const before = await info();
console.log("\nСейчас Telegram шлёт сообщения сюда:");
console.log("  адрес:            " + (before.url || "никуда не шлёт"));
console.log("  секрет проверяет: " + (before.has_custom_certificate ? "свой сертификат" : (before.url ? "да" : "—")));
console.log("  ждут доставки:    " + (before.pending_update_count ?? 0));
if (before.last_error_message) {
  console.log("  последняя ошибка: " + before.last_error_message);
}

const site = process.argv[2];
if (!site) {
  console.log("\nЧтобы переставить: node worker/set-webhook.mjs https://адрес-сайта\n");
  process.exit(0);
}

if (!site.startsWith("https://")) {
  console.error("\nTelegram принимает только https. Обычный http он отвергнет.\n");
  process.exit(1);
}

const url = site.replace(/\/+$/, "") + "/api/telegram/webhook";

/* Сначала убеждаемся, что новый адрес вообще отвечает. Переставить вебхук
   на неработающий сервер — значит тихо оставить бота без ответов: Telegram
   будет складывать сообщения в очередь, а люди решат, что бот сломался. */
/* Ключ --verified пропускает эту проверку.
 *
 * Нужен, когда сервер точно работает, а не доходит до него именно та
 * машина, с которой запускают скрипт. У нас так и вышло: адрес отвечал
 * в десяти точках мира из десяти, а отсюда — ни разу. Отказываться от
 * переезда из-за своего маршрута было бы странно.
 *
 * Но пропускать вслепую нельзя, поэтому ключ отдельный и заметный:
 * его ставят, когда доступность подтверждена со стороны. */
const verified = process.argv.includes("--verified");

if (verified) {
  console.log("\nПроверку доступности пропускаю: сказано, что она сделана со стороны.");
}

if (!verified) {
process.stdout.write("\nПроверяю, что новый адрес отвечает… ");
try {
  const r = await fetch(site.replace(/\/+$/, "") + "/api/health", { signal: AbortSignal.timeout(20000) });
  const j = await r.json();
  if (!j.ok) throw new Error("сервер ответил не ok");
  console.log(`да (база: ${j.db ? "есть" : "НЕТ"}, бот настроен: ${j.telegram ? "да" : "НЕТ"})`);
  if (!j.telegram) {
    console.error("\nНа сервере нет токена бота — переставлять некуда.\n");
    process.exit(1);
  }
} catch (e) {
  console.error("НЕТ.\n" + String(e.message).slice(0, 160));
  console.error("\nВебхук не трогаю: бот остался там, где был.");
  console.error("Если сервер точно работает, а не доходит именно эта машина —");
  console.error("проверьте доступность со стороны и повторите с ключом --verified.\n");
  process.exit(1);
}
}

const res = await api("setWebhook", {
  url,
  secret_token: SECRET || undefined,
  /* Старые накопившиеся сообщения не переносим: они адресованы прежнему
     серверу и в новой базе выглядели бы приветом из ниоткуда. */
  drop_pending_updates: true,
  allowed_updates: ["message", "callback_query"],
});

if (!res.ok) {
  console.error("\nНе получилось: " + JSON.stringify(res).slice(0, 300) + "\n");
  process.exit(1);
}

const after = await info();
console.log("\nГотово. Теперь Telegram шлёт сюда:");
console.log("  " + after.url);
console.log("  секрет проверяется: " + (SECRET ? "да" : "НЕТ — стоит задать TELEGRAM_WEBHOOK_SECRET"));
console.log("");
