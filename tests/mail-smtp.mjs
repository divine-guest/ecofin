/* ============ Письма через почтовый ящик — на подставном почтовом сервере ============

   Проверяет второй путь доставки писем (worker/node/mail-smtp.mjs) и то,
   ради чего он нужен: человек забыл пароль, получил код письмом и сменил
   пароль сам, без владельца.

   Поднимаются подставной почтовый сервер, который записывает всё, что ему
   прислали, и сам сервис со своей временной базой. Настоящая почта и
   боевой сервер не участвуют; API_URL из окружения проверка не читает.

   Запуск:  node tests/mail-smtp.mjs                                    */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startSmtp, read } from "./_smtp.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const SMTP_PORT = 8785, SITE_PORT = 8786, API_PORT = 8787;
const SITE = `http://127.0.0.1:${SITE_PORT}`;
const BOX = "info@ecofin26.ru", BOX_PASS = "parol-ot-yaschika";

let pass = 0, fail = 0;
const ok = (c, label, got = "") => {
  c ? (pass++, console.log("  ✓", label)) : (fail++, console.log("  ✗", label, got === "" ? "" : "→ " + JSON.stringify(got)));
};

/* ---------------- Подставной почтовый сервер ---------------- */

const { inbox, close: closeSmtp } = await startSmtp({ port: SMTP_PORT, box: BOX, pass: BOX_PASS });

/* ---------------- 1. Сама отправка ---------------- */

const { smtpConfigured, makeSmtpSender } = await import(pathToFileURL(join(ROOT, "worker", "node", "mail-smtp.mjs")).href);
const { mailReady, sendMail } = await import(pathToFileURL(join(ROOT, "worker", "src", "mail.js")).href);

const cfg = {
  MAIL_SMTP_HOST: "127.0.0.1", MAIL_SMTP_PORT: String(SMTP_PORT), MAIL_SMTP_INSECURE: "1",
  MAIL_SMTP_USER: BOX, MAIL_SMTP_PASS: BOX_PASS,
};

console.log("\n— Настройки —");
ok(smtpConfigured({}) === false, "без настроек ящика отправка через него выключена");
ok(smtpConfigured({ MAIL_SMTP_HOST: "x", MAIL_SMTP_USER: "y" }) === false, "без пароля ящик настроенным не считается");
ok(smtpConfigured(cfg) === true, "с адресом сервера, ящиком и паролем — настроен");
ok(mailReady({}) === false, "сервис без ключа и без ящика честно говорит: писем нет");
ok(mailReady({ MAIL_SEND: makeSmtpSender(cfg) }) === true, "с ящиком сервис считает почту готовой");
ok(mailReady({ MAIL_API_KEY: "k", MAIL_FROM: "a@b.ru" }) === true, "прежний путь через сервис рассылок не сломан");

console.log("\n— Письмо доходит таким, каким написано —");
{
  const env = { MAIL_SEND: makeSmtpSender(cfg) };
  const text = "Здравствуйте, Иван.\n\nКод для смены пароля в ЭкоФине: 482913\n.строка с точки\n\nhttps://ecofin26.ru/recovery.html";
  const r = await sendMail(env, { to: "ivan@mail.ru", subject: "Код для смены пароля: 482913", text });
  ok(r.ok === true, "отправка сообщает об успехе", r);
  const l = inbox.at(-1);
  ok(Boolean(l), "почтовый сервер принял письмо");
  ok(l.auth === BOX, "вход выполнен под ящиком сервиса");
  ok(l.from === BOX && l.to.length === 1 && l.to[0] === "ivan@mail.ru", "отправитель — наш ящик, получатель один и тот самый", [l.from, l.to]);
  const m = read(l);
  ok(m.subject === "Код для смены пароля: 482913", "тема по-русски читается", m.subject);
  ok(m.from.includes("ЭкоФин") && m.from.includes(BOX), "письмо подписано «ЭкоФин» и нашим адресом", m.from);
  ok(/text\/plain/i.test(m.type) && /utf-8/i.test(m.type), "письмо — простой текст в UTF-8", m.type);
  ok(m.body.replace(/\r\n/g, "\n").trim() === text, "текст дошёл без искажений, включая строку с точки", m.body);
  ok(Boolean(m.header("Message-ID")) && Boolean(m.header("Date")), "у письма есть номер и дата — без них его чаще отправляют в спам");
}

console.log("\n— От чьего имени и куда отвечать —");
{
  const env = { MAIL_SEND: makeSmtpSender({ ...cfg, MAIL_FROM: "no-reply@ecofin26.ru", MAIL_FROM_NAME: "ЭкоФин — служба заботы", MAIL_REPLY_TO: "buch26@inbox.ru" }) };
  await sendMail(env, { to: "olga@yandex.ru", subject: "Проверка", text: "Текст" });
  const m = read(inbox.at(-1));
  ok(m.from.includes("no-reply@ecofin26.ru") && m.from.includes("служба заботы"), "адрес и подпись отправителя берутся из настроек", m.from);
  ok(m.header("Reply-To").includes("buch26@inbox.ru"), "ответ человека уйдёт туда, где его прочитают", m.header("Reply-To"));
}

console.log("\n— Когда что-то не так —");
{
  const before = inbox.length;
  const wrong = await sendMail({ MAIL_SEND: makeSmtpSender({ ...cfg, MAIL_SMTP_PASS: "ne-tot" }) }, { to: "a@mail.ru", subject: "x", text: "y" });
  ok(wrong.ok === false && wrong.reason === "auth", "неверный пароль ящика — отказ с понятной причиной", wrong);
  ok(inbox.length === before, "с неверным паролем письмо не ушло");

  const t0 = Date.now();
  const dead = await sendMail({ MAIL_SEND: makeSmtpSender({ ...cfg, MAIL_SMTP_PORT: "8799" }) }, { to: "a@mail.ru", subject: "x", text: "y" });
  ok(dead.ok === false, "почтовый сервер недоступен — отказ, а не падение", dead);
  ok(Date.now() - t0 < 20000, "и ждать этого отказа не приходится долго");

  const thrown = await sendMail({ MAIL_SEND: async () => { throw new Error("сломалось"); } }, { to: "a@mail.ru", subject: "x", text: "y" });
  ok(thrown.ok === false, "даже упавшая отправка не роняет запрос", thrown);
}

/* ---------------- Пробное письмо перед сохранением настроек ---------------- */

/* mail-test.mjs запускается на сервере из vps-secret.sh: настройки ящика
   приходят потоком, ещё не сохранённые, и проверяются настоящим письмом. */
function probe(settings, to = "") {
  return new Promise(resolve => {
    const p = spawn(process.execPath, [join(ROOT, "worker", "node", "mail-test.mjs"), "-", ...(to ? [to] : [])],
      { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    p.stdout.on("data", d => (out += d));
    p.on("close", code => resolve({ code, line: out.trim().split("\n").pop() }));
    p.stdin.end(Object.entries(settings).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
  });
}

console.log("\n— Пробное письмо до сохранения настроек —");
{
  const before = inbox.length;
  const good = await probe(cfg);
  ok(good.line === "MAIL_OK" && good.code === 0, "верные настройки — письмо уходит, ответ MAIL_OK", good);
  const l = inbox.at(-1);
  ok(inbox.length === before + 1 && l.to[0] === BOX, "пробное письмо приходит в сам ящик");
  ok(read(l).subject === "ЭкоФин: почта подключена", "по теме понятно, что это проверка", read(l).subject);

  const bad = await probe({ ...cfg, MAIL_SMTP_PASS: "ne-tot-parol" });
  ok(bad.line === "MAIL_FAIL auth" && bad.code !== 0, "неверный пароль — ответ MAIL_FAIL auth", bad);
  const nowhere = await probe({ ...cfg, MAIL_SMTP_PORT: "8799" });
  ok(nowhere.line.startsWith("MAIL_FAIL") && !nowhere.line.includes("auth"), "неверный адрес сервера — отказ с другой причиной", nowhere);
  const empty = await probe({ MAIL_SMTP_HOST: "127.0.0.1" });
  ok(empty.line === "NOT_CONFIGURED", "неполные настройки — ответ NOT_CONFIGURED", empty);
  /* Кавычки вокруг значения сервер срезает — проверка обязана видеть
     пароль таким же, иначе она пропустит то, что потом не заработает. */
  const quoted = await probe({ ...cfg, MAIL_SMTP_PASS: `"${BOX_PASS}"` });
  ok(quoted.line === "MAIL_OK", "значение в кавычках читается так же, как его прочтёт сервер", quoted);
}

/* ---------------- 2. Ради чего всё: сброс пароля письмом ---------------- */

const tmp = mkdtempSync(join(tmpdir(), "ecofin-mail-"));
const app = spawn(process.execPath, [join(ROOT, "worker", "node", "dev-server.mjs")], {
  cwd: ROOT,
  env: {
    ...process.env, ...cfg,
    PORT: String(SITE_PORT), API_PORT: String(API_PORT), DB_FILE: join(tmp, "mail.db"),
    MAIL_API_KEY: "", MAIL_FROM: "", MAIL_REPLY_TO: "",
    SITE_URL: "https://ecofin26.ru/", ALLOWED_ORIGINS: "https://ecofin26.ru", TELEGRAM_OFF: "1",
    YOOKASSA_SHOP_ID: "", YOOKASSA_SECRET_KEY: "",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let appLog = "";
app.stdout.on("data", d => (appLog += d));
app.stderr.on("data", d => (appLog += d));

const finish = code => {
  try { app.kill(); } catch { /* уже завершился */ }
  closeSmtp();
  setTimeout(() => {
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* файл базы ещё занят */ }
    process.exit(code);
  }, 400);
};
const call = async (path, { method = "GET", body } = {}) => {
  const r = await fetch(SITE + path, { method, headers: { Origin: SITE, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};

try {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    await new Promise(r => setTimeout(r, 250));
    up = await fetch(SITE + "/api/health").then(r => r.ok).catch(() => false);
  }
  if (!up) throw new Error("сервис не поднялся");

  console.log("\n— Забыл пароль: код приходит письмом —");
  const health = (await call("/api/health")).data;
  ok(health.mail === true, "сервис сообщает, что почта настроена", health.mail);
  ok((await call("/api/auth/reset/state")).data.mail === true, "страница входа узнаёт, что код можно прислать");

  const email = "zabyvchivyy@mail.ru";
  const reg = await call("/api/auth/register", { method: "POST", body: { name: "Пётр", email, password: "staryy-parol-1", consent: true } });
  ok(reg.status === 201, "человек зарегистрирован", reg.data);

  const before = inbox.length;
  const asked = await call("/api/auth/reset/request", { method: "POST", body: { email } });
  ok(asked.data.sent === true, "сервис принял просьбу прислать код", asked.data);
  ok(inbox.length === before + 1, "ушло ровно одно письмо", inbox.length - before);
  const letter = inbox.at(-1);
  const m = read(letter);
  ok(letter.to[0] === email, "письмо адресовано тому, кто просил");
  const code = (m.body.match(/ЭкоФине: (\d{6})/) || [])[1];
  ok(Boolean(code), "в письме шестизначный код", m.body.slice(0, 120));
  ok(m.subject.includes(code), "код виден уже в теме — его не надо искать", m.subject);
  ok(m.body.includes("Здравствуйте, Пётр"), "к человеку обращаются по имени");
  ok(m.body.includes("https://ecofin26.ru/recovery.html") && !m.body.includes("ru//recovery"), "ссылка в письме без двойной косой", (m.body.match(/https:\S+/) || [])[0]);

  const stranger = await call("/api/auth/reset/request", { method: "POST", body: { email: "nikto@mail.ru" } });
  ok(stranger.data.sent === true && inbox.length === before + 1, "для незнакомого адреса ответ тот же, а письма нет — так нельзя узнать, кто зарегистрирован");

  const badCode = await call("/api/auth/reset/confirm", { method: "POST", body: { email, code: "000000", newPassword: "novyy-parol-2" } });
  ok(badCode.status >= 400, "неверный код не принимается", badCode.data);
  const done = await call("/api/auth/reset/confirm", { method: "POST", body: { email, code, newPassword: "novyy-parol-2" } });
  ok(done.status === 200 && Boolean(done.data.token), "верный код меняет пароль и сразу впускает", done.data.error || "");
  const oldLogin = await call("/api/auth/login", { method: "POST", body: { email, password: "staryy-parol-1" } });
  const newLogin = await call("/api/auth/login", { method: "POST", body: { email, password: "novyy-parol-2" } });
  ok(oldLogin.status >= 400 && newLogin.status === 200, "старый пароль больше не подходит, новый подходит", [oldLogin.status, newLogin.status]);
  const again = await call("/api/auth/reset/confirm", { method: "POST", body: { email, code, newPassword: "tretiy-parol-3" } });
  ok(again.status >= 400, "использованный код второй раз не работает");

  console.log(`\nИТОГО: ${pass} пройдено, ${fail} провалено\n`);
  if (fail) console.log("журнал сервиса (хвост):\n" + appLog.slice(-1200));
  finish(fail ? 1 : 0);
} catch (e) {
  console.log("\nСБОЙ ПРОВЕРКИ:", e.stack || e.message);
  console.log("журнал сервиса (хвост):\n" + appLog.slice(-1500));
  finish(1);
}
