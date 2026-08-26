/* ============ ПравоФин — сервер на обычной машине ============

   Тот же самый код, что работает на Cloudflare Workers, запущенный под
   Node. Ни один файл из worker/src здесь не меняется: воркер отдаёт
   наружу две функции — fetch(request, env, ctx) и scheduled(event, env, ctx),
   и обе принимают стандартные Request и Response, которые в Node есть
   с восемнадцатой версии.

   Значит вся работа этого файла — три перевода:
     1. запрос Node          → Request
     2. Response             → ответ Node
     3. окружение Cloudflare → объект env, собранный из .env и базы

   Плюс крон вместо триггеров Cloudflare и аккуратное завершение, чтобы
   при перезапуске не оборвать фоновые задачи ИИ на середине.

   Запуск:
       node worker/node/server.mjs
   Переменные берутся из worker/.env, порт — из PORT (по умолчанию 8080),
   файл базы — из DB_FILE (по умолчанию worker/data/pravofin.db).      */

/* Строго первым: подставляет то, чего в Node нет, а в Workers есть.
   Модули выполняются в порядке импорта, поэтому к загрузке worker/src
   всё уже на месте. */
import "./polyfill.mjs";

import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { openDatabase, applySchema } from "./db.mjs";
import worker from "../src/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKER = join(HERE, "..");

/* ---------- Переменные окружения ---------- */

async function loadEnvFile(file) {
  try {
    const raw = await readFile(file, "utf8");
    return Object.fromEntries(
      raw.split(/\r?\n/)
        .map(l => l.trim())
        .filter(l => l && !l.startsWith("#"))
        .map(l => {
          const i = l.indexOf("=");
          return i < 0 ? null : [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
        })
        .filter(Boolean)
    );
  } catch {
    console.warn("worker/.env не найден — беру только переменные процесса");
    return {};
  }
}

/* ---------- Перевод запроса ---------- */

/* Тело читаем целиком: разбор документа по фотографии приходит одним
   куском в несколько мегабайт, потоковая обработка тут ничего не даёт.
   Ограничение нужно, чтобы одним запросом нельзя было съесть память. */
const MAX_BODY = 24 * 1024 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", c => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error("too-large"), { tooLarge: true }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function toRequest(req, body, origin) {
  const url = new URL(req.url, origin);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v === undefined) continue;
    headers.set(k, Array.isArray(v) ? v.join(", ") : String(v));
  }
  const hasBody = req.method !== "GET" && req.method !== "HEAD" && body.length > 0;
  return new Request(url, { method: req.method, headers, body: hasBody ? body : undefined });
}

async function sendResponse(res, response) {
  const headers = {};
  response.headers.forEach((v, k) => { headers[k] = v; });
  const buf = Buffer.from(await response.arrayBuffer());
  res.writeHead(response.status, headers);
  res.end(buf);
}

/* ---------- Фоновые задачи ----------

   На Cloudflare ctx.waitUntil продлевает жизнь изолята после ответа.
   Здесь процесс и так живёт дальше, поэтому достаточно не ждать промис —
   но держать его в списке нужно: при перезапуске мы дадим фоновым
   задачам договорить, а не оборвём их на середине.                    */
const pending = new Set();

function makeCtx() {
  return {
    waitUntil(promise) {
      if (!promise || typeof promise.then !== "function") return;
      pending.add(promise);
      promise.catch(e => console.error("фоновая задача:", e && e.message))
             .finally(() => pending.delete(promise));
    },
    passThroughOnException() {},
  };
}

/* ---------- Запуск ---------- */

const cfg = { ...(await loadEnvFile(join(WORKER, ".env"))), ...process.env };
const PORT = Number(cfg.PORT || 8080);
const HOST = cfg.HOST || "127.0.0.1";     // наружу смотрит nginx, не мы
const DB_FILE = resolve(cfg.DB_FILE || join(WORKER, "data", "pravofin.db"));
/* Адрес, по которому сервер доступен снаружи. Нужен только чтобы
   собрать объект Request: путь и параметры берутся из него. */
const PUBLIC_ORIGIN = cfg.API_ORIGIN || `http://${HOST}:${PORT}`;

await mkdir(dirname(DB_FILE), { recursive: true });
const DB = await openDatabase(DB_FILE);
const schema = await applySchema(DB, WORKER);

/* env повторяет то, что Cloudflare подставляет воркеру: все переменные
   плюс привязка базы под именем DB. */
const env = { ...cfg, DB };

const server = createServer(async (req, res) => {
  let body;
  try {
    body = await readBody(req);
  } catch (e) {
    if (e.tooLarge) {
      res.writeHead(413, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({ error: "Файл слишком большой" }));
    }
    res.writeHead(400).end();
    return;
  }

  const ctx = makeCtx();
  try {
    const request = toRequest(req, body, PUBLIC_ORIGIN);
    const response = await worker.fetch(request, env, ctx);
    await sendResponse(res, response);
  } catch (e) {
    /* Подробности — в журнал, наружу только общая фраза: текст ошибки
       может содержать кусок запроса или строку подключения. */
    console.error("запрос упал:", req.method, req.url, e && e.stack);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Внутренняя ошибка сервера" }));
    } else {
      res.end();
    }
  }
});

/* Долгие ответы ИИ: 90 секунд ожидания провайдера плюс запас.
   Значение по умолчанию в Node меньше, и запрос обрывался бы на середине. */
server.requestTimeout = 180000;
server.headersTimeout = 190000;
server.keepAliveTimeout = 75000;

server.listen(PORT, HOST, () => {
  console.log(`ПравоФин API слушает http://${HOST}:${PORT}`);
  console.log(`  база: ${DB_FILE} (${DB.driverName})`);
  console.log(`  схема: файлов ${schema.files}, выражений ${schema.applied}, уже было ${schema.skipped}`);
  console.log(`  ключ ИИ: ${cfg.AI_API_KEY ? "есть" : "НЕТ"}, Telegram: ${cfg.TELEGRAM_BOT_TOKEN ? "есть" : "НЕТ"}, ЮKassa: ${cfg.YOOKASSA_SHOP_ID ? "есть" : "нет"}`);
});

/* ---------- Крон ----------

   На Cloudflare расписание задавалось отдельным запросом к API.
   Здесь достаточно таймера в самом процессе: сервис всё равно должен
   работать непрерывно, а отдельный системный cron — лишняя деталь,
   которую забудут настроить при переустановке. */
const HOUR = 3600 * 1000;

async function runCron() {
  try {
    await worker.scheduled({ scheduledTime: Date.now(), cron: "0 * * * *" }, env, makeCtx());
  } catch (e) {
    console.error("крон:", e && e.message);
  }
}

/* Ждём до начала следующего часа, дальше ровно раз в час: так задачи
   идут по часам, а не по времени последнего перезапуска сервера. */
const untilNextHour = HOUR - (Date.now() % HOUR);
setTimeout(() => { runCron(); setInterval(runCron, HOUR); }, untilNextHour);
console.log(`  крон: первый запуск через ${Math.round(untilNextHour / 60000)} мин, дальше раз в час`);

/* ---------- Аккуратное завершение ----------

   Перезапуск не должен обрывать ответ ИИ на середине: человек получил
   номер задачи, задача считается — если процесс просто убить, она
   останется висеть, и её подберёт только опрос. Даём договорить. */
let stopping = false;
async function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  console.log(`\n${signal}: завершаюсь, фоновых задач в работе: ${pending.size}`);
  server.close();
  const wait = Promise.allSettled([...pending]);
  const timeout = new Promise(r => setTimeout(r, 20000));
  await Promise.race([wait, timeout]);
  try { DB.close(); } catch {}
  console.log("остановлен");
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

/* Необработанная ошибка в промисе не должна ронять весь сервис:
   упасть должен один запрос, а не сайт целиком. */
process.on("unhandledRejection", e => console.error("необработанный промис:", e && e.stack));
process.on("uncaughtException", e => console.error("необработанная ошибка:", e && e.stack));
