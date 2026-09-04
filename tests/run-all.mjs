/* ============ Запуск всех проверок ============

   Проверки бьют по боевому серверу: отдельного стенда нет. Каждая
   сюита заводит свои аккаунты на @test.ru и удаляет их за собой.

   Запуск:
     D1_API_TOKEN=<токен> node tests/run-all.mjs

   Токен нужен, чтобы завести временного админа и почистить счётчик
   попыток между сюитами: лимит регистраций 8 в час на адрес
   выбирается за пару прогонов, и дальше всё выглядит как провал
   тестов, хотя сайт исправен.                                     */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { sql } from "./_admin.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/* Порядок не случайный: сначала сквозной путь и безопасность —
   если сломано там, остальное разбирать бессмысленно. */
const SUITES = [
  /* Эти две не ходят на сервер и не заводят аккаунтов: они сверяют
     арифметику ставок и то, что витрина не расходится с содержанием.
     Раньше они лежали рядом и не запускались вовсе — сто с лишним
     проверок, о которых никто не знал. Ставим первыми: если сломана
     арифметика налогов, остальное разбирать смысла нет. */
  ["rates", "арифметика ставок: налоги, взносы, пособия, сроки"],
  ["content", "витрина не расходится с содержанием сайта"],
  ["plaintext", "чистка разметки из ответов ИИ: убирает звёздочки, не трогает номера карт"],
  ["e2e", "сквозной путь: регистрация, лимиты, роли, промокод"],
  ["security", "подделка токена, чужой домен, перебор пароля"],
  ["aijobs", "фоновый ИИ: вопрос переживает уход со страницы"],
  ["access", "что закрыто бесплатному и открыто платному"],
  ["multidevice", "вход с нескольких устройств, список сессий"],
  ["tiers", "лимиты каждого тарифа, цены, оформление"],
  ["ref", "реферальные ссылки и защита от накрутки"],
  ["profile_test", "аватар, смена имени и пароля, сброс доступа"],
  ["courses", "платные уроки закрыты, первый открыт"],
  ["points", "баллы: начисление, потолок, запрет минуса"],
  ["preview", "что видно до оплаты"],
  ["extras", "блокнот, итоги и достижения"],
  ["cabinet", "сохранённые расчёты и история вопросов"],
  ["book", "«Моё дело»: учёт, итог года, книга учёта"],
  ["clients", "несколько дел в кабинете: изоляция учёта"],
  ["trial", "пробный «Про»: один раз, не поверх подписки"],
  ["qa", "публичная лента: согласие, проверка, публикация"],
  ["bot", "команды Telegram: подписка, профиль, промокод"],
  ["digest", "сводка недели: не спамит и отключается"],
  ["cron", "ежечасная рассылка напоминаний"],
];

function run(file) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [join(HERE, file + ".mjs")], {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("close", (code) => resolve({ code, out }));
  });
}

/* Секрет вебхука лежит в worker/.env. Без него сюита бота молча
   проверяет одну строчку вместо двадцати — это хуже, чем падение,
   потому что выглядит как успех. */
if (!process.env.TELEGRAM_WEBHOOK_SECRET) {
  try {
    const env = readFileSync(join(HERE, "..", "worker", ".env"), "utf8");
    const m = env.match(/^TELEGRAM_WEBHOOK_SECRET=(.*)$/m);
    if (m) process.env.TELEGRAM_WEBHOOK_SECRET = m[1].trim();
  } catch {}
}

/* Сюитам нужен прямой доступ к базе — завести одноразового админа и
   убрать за собой. На Cloudflare это REST API базы и токен, на своём
   сервере — сам файл базы, и тогда токен не нужен вовсе.

   Раньше здесь требовался только токен, и проверки на своём сервере
   отказывались запускаться, хотя всё для них было. */
if (!process.env.D1_API_TOKEN && !process.env.DB_FILE) {
  console.error("Нужен доступ к базе — без него не завести временного админа.");
  console.error("  на Cloudflare:   D1_API_TOKEN=<токен>");
  console.error("  на своём сервере: DB_FILE=<путь к файлу базы>");
  process.exit(2);
}

let totalPass = 0, totalFail = 0, broken = 0;

for (const [file, what] of SUITES) {
  /* Счётчик попыток чистим перед каждой сюитой, иначе лимит
     регистраций выбьет следующую и это будет выглядеть как поломка. */
  try { await sql("DELETE FROM ratelimit"); } catch {}

  const { code, out } = await run(file);
  const line = out.split("\n").filter((l) => l.includes("ИТОГО")).pop();

  if (!line) {
    broken++;
    const err = out.split("\n").find((l) => /Error|error:/.test(l)) || "нет итоговой строки";
    console.log(`✗ ${file.padEnd(14)} СБОЙ — ${err.trim().slice(0, 80)}`);
    continue;
  }

  const pass = Number((line.match(/(\d+) (?:пройдено|проверок)/) || [])[1] || 0);
  const fail = Number((line.match(/(\d+) (?:провалено|рисков)/) || [])[1] || 0);
  totalPass += pass;
  totalFail += fail;

  const mark = fail === 0 && code === 0 ? "✓" : "✗";
  console.log(`${mark} ${file.padEnd(14)} ${String(pass).padStart(3)} пройдено, ${fail} провалено — ${what}`);
  if (fail > 0) {
    out.split("\n").filter((l) => l.includes("✗")).forEach((l) => console.log("   " + l.trim()));
  }
}

/* Убираем за собой всё, что могли оставить упавшие сюиты. */
for (const t of ["reminders", "reminder_sent", "point_ops", "payments",
                 "notifications", "sessions", "usage", "actions",
                 "tg_link_codes", "ai_jobs", "public_qa", "qa_useful", "saved_calcs"]) {
  try { await sql(`DELETE FROM ${t} WHERE email LIKE '%@test.ru'`); } catch {}
}
try { await sql("DELETE FROM users WHERE email LIKE '%@test.ru'"); } catch {}

console.log("\n" + "-".repeat(52));
console.log(`ВСЕГО: ${totalPass} пройдено, ${totalFail} провалено` +
            (broken ? `, сюит не запустилось: ${broken}` : ""));

process.exit(totalFail > 0 || broken > 0 ? 1 : 0);
