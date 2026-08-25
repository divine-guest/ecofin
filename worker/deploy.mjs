/* Деплой воркера через REST API Cloudflare — без wrangler,
   потому что wrangler 4 требует Node 22, а на машине 18.

   Запуск:
     CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... node deploy.mjs
   Переменные окружения воркера берутся из соседнего .env (не в git). */
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
/* Права на Workers и на D1 могут жить в разных токенах — тогда второй
   кладётся в D1_API_TOKEN. Если он не задан, для всего берётся основной. */
const D1_TOKEN = process.env.D1_API_TOKEN || TOKEN;
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const SCRIPT = process.env.WORKER_NAME || "pravofin-api";
const API = "https://api.cloudflare.com/client/v4";

if (!TOKEN || !ACCOUNT) {
  console.error("Нужны CLOUDFLARE_API_TOKEN и CLOUDFLARE_ACCOUNT_ID");
  process.exit(1);
}

/* Что считать секретом, а что обычной переменной. Секреты не видны в дашборде
   после сохранения и не попадают в вывод этого скрипта. */
const SECRET_KEYS = new Set(["AI_API_KEY", "YOOKASSA_SECRET_KEY", "TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET", "RECOVERY_SECRET"]);
const VAR_KEYS = [
  "AI_BASE_URL", "AI_MODEL", "AI_VISION_MODEL",
  "ALLOWED_ORIGINS", "OWNER_EMAILS", "ADMIN_EMAILS", "SITE_URL", "PROMO_CODES",
  "YOOKASSA_SHOP_ID", "TELEGRAM_BOT_USERNAME",
];

async function loadEnvFile() {
  try {
    const raw = await readFile(join(HERE, ".env"), "utf8");
    return Object.fromEntries(
      raw.split(/\r?\n/)
        .map(l => l.trim())
        .filter(l => l && !l.startsWith("#"))
        .map(l => {
          const i = l.indexOf("=");
          return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
        })
        .filter(([k]) => k)
    );
  } catch {
    console.warn("worker/.env не найден — переменные возьму только из окружения процесса");
    return {};
  }
}

/* Node 18 на этой машине периодически рвёт соединение с api.cloudflare.com.
   Без ретрая деплой «успешно» проходил без привязки базы — молча ломая API. */
async function fetchRetry(url, init, attempts = 4) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try { return await fetch(url, init); }
    catch (e) { last = e; await new Promise(r => setTimeout(r, 2000 * (i + 1))); }
  }
  throw new Error(`сеть недоступна после ${attempts} попыток: ${last?.message}`);
}

async function cf(path, init = {}) {
  const token = path.includes("/d1/") ? D1_TOKEN : TOKEN;
  const r = await fetchRetry(API + path, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) },
  });
  const data = await r.json().catch(() => ({}));
  if (!data.success) {
    const msg = (data.errors || []).map(e => `${e.code} ${e.message}`).join("; ") || r.status;
    throw new Error(`${path} → ${msg}`);
  }
  return data.result;
}

async function findDatabase(name) {
  const list = await cf(`/accounts/${ACCOUNT}/d1/database`);
  return (list || []).find(d => d.name === name) || null;
}

async function ensureDatabase(name) {
  const existing = await findDatabase(name);
  if (existing) {
    console.log(`  база ${name} уже есть (${existing.uuid})`);
    return existing;
  }
  const created = await cf(`/accounts/${ACCOUNT}/d1/database`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  console.log(`  база ${name} создана (${created.uuid})`);
  return created;
}

async function applySchema(dbId) {
  const sql = await readFile(join(HERE, "schema.sql"), "utf8");
  await cf(`/accounts/${ACCOUNT}/d1/database/${dbId}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sql }),
  });
  console.log("  схема применена");
  await applyMigrations(dbId);
}

/* Миграции применяются сами при каждой выкатке.

   Раньше их гоняли руками, и это ломалось дважды: выкатывался код,
   который обращается к новой колонке, а колонки в базе ещё нет —
   и живой сервис отвечал ошибкой до тех пор, пока про миграцию
   не вспомнят.

   Правила, из-за которых на этом уже спотыкались:
   1. Комментарии срезаем ДО разбиения по «;» — точка с запятой внутри
      комментария рвёт выражение пополам.
   2. Каждое выражение шлём отдельно: D1 не любит пачку в одном запросе.
   3. «Колонка уже есть» и «таблица уже есть» — не ошибки, а норма:
      миграции обязаны переживать повторный запуск.                 */
const HARMLESS = /duplicate column|already exists|no such index/i;

async function applyMigrations(dbId) {
  const files = (await readdir(HERE)).filter(f => /^migrate.*\.sql$/.test(f)).sort();
  let applied = 0, skipped = 0;

  for (const f of files) {
    const raw = await readFile(join(HERE, f), "utf8");
    const clean = raw
      .split("\n")
      .map(line => line.replace(/--.*$/, ""))
      .join("\n");

    for (const stmt of clean.split(";").map(s => s.trim()).filter(Boolean)) {
      try {
        await cf(`/accounts/${ACCOUNT}/d1/database/${dbId}/query`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sql: stmt }),
        });
        applied++;
      } catch (e) {
        if (HARMLESS.test(e.message)) { skipped++; continue; }
        console.warn(`  ${f}: ${e.message.slice(0, 120)}`);
      }
    }
  }
  console.log(`  миграций: файлов ${files.length}, выполнено ${applied}, уже было ${skipped}`);
}

async function uploadScript(bindings) {
  const dir = join(HERE, "src");
  const files = (await readdir(dir)).filter(f => f.endsWith(".js"));

  const metadata = {
    main_module: "index.js",
    compatibility_date: "2025-05-01",
    compatibility_flags: ["nodejs_compat"],
    bindings,
  };

  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  for (const f of files) {
    const code = await readFile(join(dir, f), "utf8");
    form.append(f, new Blob([code], { type: "application/javascript+module" }), f);
  }

  await cf(`/accounts/${ACCOUNT}/workers/scripts/${SCRIPT}`, { method: "PUT", body: form });
  console.log(`  загружено модулей: ${files.length}`);
}

/* Расписание крона задаётся отдельным запросом, не через метаданные скрипта. */
async function setSchedule() {
  await cf(`/accounts/${ACCOUNT}/workers/scripts/${SCRIPT}/schedules`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([{ cron: "0 * * * *" }]),   // каждый час
  });
  console.log("  расписание: каждый час");
}

async function enableSubdomain() {
  await cf(`/accounts/${ACCOUNT}/workers/scripts/${SCRIPT}/subdomain`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: true, previews_enabled: false }),
  });
  const sub = await cf(`/accounts/${ACCOUNT}/workers/subdomain`);
  return `https://${SCRIPT}.${sub.subdomain}.workers.dev`;
}

const main = async () => {
  const cfg = { ...(await loadEnvFile()), ...process.env };
  console.log(`Деплой воркера «${SCRIPT}»`);

  const bindings = [];

  console.log("· база данных");
  let db = null;

  /* Привязать базу можно, зная только её id — права на D1 API для этого
     не нужны. Полезно, когда токен D1 недоступен: воркер всё равно
     выкатится с рабочей базой, просто без применения схемы. */
  if (cfg.D1_DATABASE_ID) {
    bindings.push({ type: "d1", name: "DB", id: cfg.D1_DATABASE_ID });
    db = { uuid: cfg.D1_DATABASE_ID, fromEnv: true };
    console.log(`  база привязана по id из настроек (${cfg.D1_DATABASE_ID})`);
    try {
      await applySchema(cfg.D1_DATABASE_ID);
    } catch (e) {
      console.warn(`  схему применить не удалось (${e.message}) — на выкатку не влияет`);
    }
  }

  try {
    if (db) throw { skip: true };
    db = await ensureDatabase(process.env.D1_NAME || "pravofin");
    await applySchema(db.uuid);
    bindings.push({ type: "d1", name: "DB", id: db.uuid });
  } catch (e) {
    if (e && e.skip) { /* база уже привязана по id */ } else {
    /* Молча деплоить без базы нельзя: API останется живым, но перестанет
       работать целиком. Лучше упасть здесь. */
    console.error(`  ОШИБКА БАЗЫ: ${e.message}`);
    console.error("  Деплой прерван, чтобы не выкатить воркер без привязки DB.");
    console.error("  Если это осознанно (первый запуск без D1) — запустите с SKIP_DB=1");
    console.error("  Либо укажите D1_DATABASE_ID в .env — тогда права на D1 API не нужны.");
    if (!process.env.SKIP_DB) process.exit(1);
    console.warn("  SKIP_DB=1 — продолжаю без базы");
    }
  }

  console.log("· переменные и секреты");
  for (const k of VAR_KEYS) {
    if (cfg[k]) bindings.push({ type: "plain_text", name: k, text: cfg[k] });
  }
  for (const k of SECRET_KEYS) {
    if (cfg[k]) bindings.push({ type: "secret_text", name: k, text: cfg[k] });
  }
  console.log(`  переменных: ${bindings.filter(b => b.type === "plain_text").length}, ` +
              `секретов: ${bindings.filter(b => b.type === "secret_text").length}`);

  console.log("· загрузка кода");
  await uploadScript(bindings);

  console.log("· расписание напоминаний");
  try { await setSchedule(); }
  catch (e) { console.warn(`  ПРОПУЩЕНО: ${e.message}`); }

  console.log("· публикация");
  const url = await enableSubdomain();

  console.log(`\nГотово: ${url}`);
  console.log(`Проверка: curl ${url}/api/health`);
  if (!db) process.exitCode = 2;
};

main().catch(e => {
  console.error("\nОШИБКА:", e.message);
  process.exit(1);
});
