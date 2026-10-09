/* ============ Письма людям — на подставном почтовом сервере ============

   Проверяет то, что сервис пишет сам, без просьбы человека: напоминание
   о сроке, сводку недели и предупреждение о списании за подписку. И то,
   без чего такие письма слать нельзя: отказ от них — галкой в кабинете
   и ссылкой из письма, без входа.

   Две части. В первой поднимается сам сервис со своей временной базой,
   и всё делается так, как делал бы человек: регистрация, срок, письмо,
   ссылка «отключить». Во второй расписание запускается напрямую, на
   отдельной базе: только так можно поставить человеку «ночь», «утро
   понедельника» и «три дня до списания», не дожидаясь их.

   Настоящая почта, боевой сервер и ЮKassa не участвуют; API_URL из
   окружения проверка не читает.

   Запуск:  node tests/mail-letters.mjs                                */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startSmtp, read } from "./_smtp.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const SMTP_PORT = 8805, SITE_PORT = 8806, API_PORT = 8807;
const SITE = `http://127.0.0.1:${SITE_PORT}`;
const BOX = "info@ecofin26.ru", BOX_PASS = "parol-ot-yaschika";
const OWNER = "vladelec@mail.ru";

let pass = 0, fail = 0;
const ok = (c, label, got = "") => {
  c ? (pass++, console.log("  ✓", label)) : (fail++, console.log("  ✗", label, got === "" ? "" : "→ " + JSON.stringify(got)));
};

const { inbox, close: closeSmtp } = await startSmtp({ port: SMTP_PORT, box: BOX, pass: BOX_PASS });
const cfg = {
  MAIL_SMTP_HOST: "127.0.0.1", MAIL_SMTP_PORT: String(SMTP_PORT), MAIL_SMTP_INSECURE: "1",
  MAIL_SMTP_USER: BOX, MAIL_SMTP_PASS: BOX_PASS,
};

const tmp = mkdtempSync(join(tmpdir(), "ecofin-letters-"));
const app = spawn(process.execPath, [join(ROOT, "worker", "node", "dev-server.mjs")], {
  cwd: ROOT,
  env: {
    ...process.env, ...cfg,
    PORT: String(SITE_PORT), API_PORT: String(API_PORT), DB_FILE: join(tmp, "letters.db"),
    MAIL_API_KEY: "", MAIL_FROM: "", MAIL_REPLY_TO: "", MAIL_PER_RUN: "",
    SITE_URL: "https://ecofin26.ru/", ALLOWED_ORIGINS: "https://ecofin26.ru", TELEGRAM_OFF: "1",
    OWNER_EMAILS: OWNER, ADMIN_EMAILS: "",
    YOOKASSA_SHOP_ID: "", YOOKASSA_SECRET_KEY: "",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let appLog = "";
app.stdout.on("data", d => (appLog += d));
app.stderr.on("data", d => (appLog += d));

let db2 = null;
const finish = code => {
  try { app.kill(); } catch { /* уже завершился */ }
  try { db2 && db2.close(); } catch { /* не открывалась */ }
  closeSmtp();
  setTimeout(() => {
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* файл базы ещё занят */ }
    process.exit(code);
  }, 400);
};
const call = async (path, { method = "GET", body, token, raw, noOrigin } = {}) => {
  const r = await fetch(SITE + path, {
    method,
    headers: {
      ...(noOrigin ? {} : { Origin: SITE }),
      ...(raw ? { "Content-Type": "application/x-www-form-urlencoded" } : body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: raw ? raw : body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};
const plain = m => m.body.replace(/\r\n/g, "\n");
const day = (shift = 0, tz = 3) => new Date(Date.now() + tz * 3600000 + shift * 86400000).toISOString().slice(0, 10);
const ru = iso => iso.split("-").reverse().join(".");

try {
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    await new Promise(r => setTimeout(r, 250));
    up = await fetch(SITE + "/api/health").then(r => r.ok).catch(() => false);
  }
  if (!up) throw new Error("сервис не поднялся");

  /* ================= 1. Как это видит человек ================= */

  const owner = (await call("/api/auth/register", { method: "POST", body: { name: "Егор", email: OWNER, password: "parol-vladelca-1", consent: true } })).data;
  const email = "predprinimatel@yandex.ru";
  const reg = await call("/api/auth/register", { method: "POST", body: { name: "Анна", email, password: "parol-anny-12", consent: true } });
  const t = reg.data.token;
  if (!owner.token || !t) throw new Error("не удалось завести аккаунты: " + JSON.stringify([owner, reg.data]));
  const run = () => call("/api/admin/run-reminders", { method: "POST", token: owner.token });
  const feed = async () => (await call("/api/notifications", { token: t })).data.notifications || [];

  console.log("\n— Письма включены сразу, и человек это видит —");
  ok(reg.data.user.mailOff === false, "после регистрации письма включены", reg.data.user.mailOff);
  const st = (await call("/api/mail", { token: t })).data;
  ok(st.enabled === true && st.off === false && st.address === email, "кабинет знает: письма придут на этот адрес", st);
  ok((await call("/api/mail")).status === 401, "чужому состояние писем не показывается");

  console.log("\n— Два срока одного утра — одно письмо —");
  await call("/api/reminders", { method: "POST", token: t, body: { title: "Аванс по УСН", due: day(0), notifyDays: "3,1,0", note: "Счёт 40101, сумма в расчёте" } });
  await call("/api/reminders", { method: "POST", token: t, body: { title: "Взносы за себя", due: day(3), notifyDays: "3,1,0" } });
  let before = inbox.length;
  const r1 = await run();
  ok(r1.status === 200 && r1.data.sent === 2, "прогон отметил два напоминания", r1.data);
  ok(r1.data.mailed === 1 && inbox.length === before + 1, "а письмо ушло одно", [r1.data.mailed, inbox.length - before]);
  const l1 = inbox.at(-1), m1 = read(l1), b1 = plain(m1);
  ok(l1.to.length === 1 && l1.to[0] === email, "письмо адресовано хозяину сроков", l1.to);
  ok(m1.subject === "2 срока на подходе", "по теме видно, сколько сроков", m1.subject);
  ok(b1.includes("Здравствуйте, Анна."), "к человеку обращаются по имени");
  ok(b1.includes(`• Аванс по УСН — сегодня, ${ru(day(0))}`), "срок на сегодня назван с датой", b1.slice(0, 200));
  ok(b1.includes(`• Взносы за себя — через 3 дн., ${ru(day(3))}`), "срок через три дня — тоже");
  ok(b1.indexOf("Аванс по УСН") < b1.indexOf("Взносы за себя"), "ближайший срок стоит первым");
  ok(b1.includes("Счёт 40101, сумма в расчёте"), "заметка к сроку попала в письмо");
  ok(b1.includes("https://ecofin26.ru/dashboard.html#reminders"), "есть ссылка на сроки в кабинете");
  const token = (b1.match(/unsubscribe\.html#([0-9a-f]{36})\b/) || [])[1];
  ok(Boolean(token), "в письме ссылка «отключить письма» с ключом");
  ok(!b1.includes(email), "адреса почты в тексте письма нет — ссылку можно переслать, не раскрыв его");
  ok(m1.header("List-Unsubscribe") === `<https://ecofin26.ru/api/mail/unsubscribe?t=${token}>`
     && /One-Click/i.test(m1.header("List-Unsubscribe-Post")),
     "почтовый сервис получит свою кнопку «Отписаться»", m1.header("List-Unsubscribe"));
  ok(!/тариф|скидк|бесплатно|купи|оплат/i.test(b1), "в письме нет ни слова о покупке");
  ok((await feed()).length === 2, "в ленте на сайте оба напоминания остались", (await feed()).length);

  console.log("\n— Повторный прогон не шлёт то же письмо —");
  before = inbox.length;
  const r2 = await run();
  ok(r2.data.sent === 0 && r2.data.mailed === 0 && inbox.length === before, "второй раз ничего не ушло", r2.data);

  console.log("\n— Отказ по ссылке из письма, без входа —");
  ok((await call("/api/mail/unsubscribe", { method: "POST", body: { token: "0".repeat(36) } })).status === 404, "чужой ключ не подходит");
  ok((await call("/api/mail/unsubscribe", { method: "POST", body: { token: "obryvok" } })).status === 400, "обрывок ссылки — понятный отказ");
  ok((await call("/api/mail/unsubscribe", { method: "POST", body: {} })).status === 400, "без ключа — отказ");
  const off = await call("/api/mail/unsubscribe", { method: "POST", body: { token } });
  ok(off.status === 200 && off.data.off === true, "по ключу письма отключаются без пароля", off.data);
  ok(!JSON.stringify(off.data).includes("@"), "ответ не раскрывает, чей это ключ", off.data);
  ok((await call("/api/auth/me", { token: t })).data.user.mailOff === true, "в профиле видно: письма отключены");

  const dec = await call("/api/reminders", { method: "POST", token: t, body: { title: "Декларация", due: day(1), notifyDays: "1" } });
  before = inbox.length;
  const r3 = await run();
  ok(r3.data.sent === 1 && r3.data.mailed === 0 && inbox.length === before, "отключившему письмо не приходит", r3.data);
  ok((await feed()).some(n => n.title.startsWith("Декларация")), "а в ленте на сайте напоминание есть");

  console.log("\n— Письма можно вернуть —");
  const back = await call("/api/mail/unsubscribe", { method: "POST", body: { token, on: true } });
  ok(back.data.off === false, "тем же ключом — если нажали по ошибке", back.data);
  /* Кнопка почтового сервиса: запрос без Origin, ключ в адресе, тело не JSON. */
  const click = await call(`/api/mail/unsubscribe?t=${token}`, { method: "POST", raw: "List-Unsubscribe=One-Click", noOrigin: true });
  ok(click.status === 200 && click.data.off === true, "кнопка «Отписаться» в почтовом сервисе тоже работает", click.data);
  ok((await call(`/api/mail/unsubscribe?t=${token}`)).status === 404, "простое открытие ссылки (GET) ничего не отключает");
  const on = await call("/api/mail", { method: "POST", token: t, body: { off: false } });
  ok(on.status === 200 && on.data.off === false, "и галкой в кабинете", on.data);
  ok((await call("/api/mail", { method: "POST", body: { off: true } })).status === 401, "без входа галку не переключить");

  console.log("\n— Один срок — письмо о нём —");
  /* На бесплатном тарифе мест три — освобождаем одно. */
  await call("/api/reminders/delete", { method: "POST", token: t, body: { id: dec.data.id } });
  await call("/api/reminders", { method: "POST", token: t, body: { title: "Патент: вторая часть", due: day(1), notifyDays: "1" } });
  before = inbox.length;
  await run();
  const m4 = read(inbox.at(-1));
  ok(inbox.length === before + 1 && m4.subject === "Патент: вторая часть — завтра", "тема — сам срок и когда он", m4.subject);
  ok(plain(m4).includes(token), "ключ отказа у человека один и тот же во всех письмах");

  console.log("\n— Код для смены пароля на зарубежный адрес не уходит —");
  before = inbox.length;
  const abroad = await call("/api/auth/reset/request", { method: "POST", body: { email: "someone@gmail.com" } });
  ok(abroad.data.sent === false && abroad.data.foreign === true && inbox.length === before,
     "письма нет, и страница узнаёт почему", abroad.data);
  const home = await call("/api/auth/reset/request", { method: "POST", body: { email } });
  ok(home.data.sent === true && inbox.length === before + 1, "на российский адрес код приходит, как раньше", home.data);
  ok(!plain(read(inbox.at(-1))).includes("unsubscribe"), "в письме с кодом нет ссылки «отключить» — от него не отписываются");

  /* ================= 2. Расписание, запущенное напрямую ================= */

  await import(pathToFileURL(join(ROOT, "worker", "node", "polyfill.mjs")).href);
  const { openDatabase, applySchema } = await import(pathToFileURL(join(ROOT, "worker", "node", "db.mjs")).href);
  const { makeSmtpSender } = await import(pathToFileURL(join(ROOT, "worker", "node", "mail-smtp.mjs")).href);
  const { runReminders } = await import(pathToFileURL(join(ROOT, "worker", "src", "telegram.js")).href);
  const { runDigest } = await import(pathToFileURL(join(ROOT, "worker", "src", "digest.js")).href);
  const { runRenewNotices } = await import(pathToFileURL(join(ROOT, "worker", "src", "billing.js")).href);

  db2 = await openDatabase(join(tmp, "cron.db"));
  await applySchema(db2, join(ROOT, "worker"));
  const env = { DB: db2, MAIL_SEND: makeSmtpSender(cfg), SITE_URL: "https://ecofin26.ru/", TELEGRAM_OFF: "1", OWNER_EMAILS: "" };
  const q = (sql, ...a) => db2.prepare(sql).bind(...a).run();
  const one = (sql, ...a) => db2.prepare(sql).bind(...a).first();
  const quiet = async fn => { const log = console.log; console.log = () => {}; try { return await fn(); } finally { console.log = log; } };

  /* Часовой пояс, при котором у человека сейчас нужный час. Пояс — просто
     сдвиг в часах, поэтому любым целым числом можно поставить и час, и
     день недели, не трогая часы компьютера. */
  const tzForHour = h => { const d = (h - new Date().getUTCHours() + 24) % 24; return d > 12 ? d - 24 : d; };
  const tzForMonday9 = () => {
    for (let tz = -90; tz <= 90; tz++) {
      const d = new Date(Date.now() + tz * 3600000);
      if (d.getUTCDay() === 1 && d.getUTCHours() === 9) return tz;
    }
    throw new Error("не подобрался сдвиг до утра понедельника");
  };
  const addUser = (mail, name, tz, extra = {}) => {
    const cols = { email: mail, name, pass_hash: "x", created_at: Date.now(), tz_offset: tz, ...extra };
    const keys = Object.keys(cols);
    return q(`INSERT INTO users (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`, ...keys.map(k => cols[k]));
  };
  const addReminder = (mail, title, due, notify = "0") =>
    q("INSERT INTO reminders (email, title, due, notify_days, created_at) VALUES (?, ?, ?, ?, ?)", mail, title, due, notify, Date.now());
  const notes = async mail => (await db2.prepare("SELECT title, body FROM notifications WHERE email = ?").bind(mail).all()).results || [];
  const lettersTo = mail => inbox.filter(l => l.to[0] === mail);

  console.log("\n— Ночью не напоминаем —");
  {
    const night = tzForHour(3), morning = tzForHour(10);
    await addUser("sova@mail.ru", "Сова", night);
    await addUser("zhavoronok@mail.ru", "Жаворонок", morning);
    await addReminder("sova@mail.ru", "Ночной срок", day(0, night));
    await addReminder("zhavoronok@mail.ru", "Утренний срок", day(0, morning));
    const r = await quiet(() => runReminders(env));
    ok(r.sent === 1 && r.mailed === 1, "у кого три часа ночи — тому ничего, у кого десять утра — письмо", r);
    ok(lettersTo("sova@mail.ru").length === 0 && (await notes("sova@mail.ru")).length === 0, "ночью нет ни письма, ни отметки — они придут утром");
    ok(lettersTo("zhavoronok@mail.ru").length === 1, "утреннее письмо ушло");
    const forced = await quiet(() => runReminders(env, { force: true }));
    ok(forced.sent === 1 && lettersTo("sova@mail.ru").length === 1, "ничего не потеряно: срок уходит первым же прогоном после ночи", forced);
  }

  console.log("\n— Зарубежный адрес: только лента на сайте —");
  {
    const tz = tzForHour(10);
    await addUser("old@gmail.com", "Давний", tz);
    await addReminder("old@gmail.com", "Срок давнего аккаунта", day(0, tz));
    const before2 = inbox.length;
    const r = await quiet(() => runReminders(env));
    ok(r.sent === 1 && r.mailed === 0 && inbox.length === before2, "письмо за границу не уходит", r);
    ok((await notes("old@gmail.com")).length === 1, "напоминание на сайте есть");
  }

  console.log("\n— Предел писем за прогон бережёт ящик —");
  {
    const tz = tzForHour(11);
    for (const n of [1, 2, 3]) {
      await addUser(`mnogo${n}@mail.ru`, "Человек " + n, tz);
      await addReminder(`mnogo${n}@mail.ru`, "Общий срок", day(0, tz));
    }
    const before2 = inbox.length;
    const r = await quiet(() => runReminders({ ...env, MAIL_PER_RUN: "2" }));
    ok(r.sent === 3 && r.mailed === 2 && inbox.length === before2 + 2, "напоминаний три, писем — сколько разрешено", r);
    const fed = (await Promise.all([1, 2, 3].map(n => notes(`mnogo${n}@mail.ru`)))).map(x => x.length);
    ok(fed.join() === "1,1,1", "в ленте напоминание получили все трое", fed);
  }

  console.log("\n— Почта отказала — прогон не падает и не задваивает —");
  {
    const tz = tzForHour(12);
    await addUser("nevezuchiy@mail.ru", "Невезучий", tz);
    await addReminder("nevezuchiy@mail.ru", "Срок без письма", day(0, tz));
    const broken = { ...env, MAIL_SEND: async () => ({ ok: false, reason: "provider" }) };
    const r = await quiet(() => runReminders(broken));
    ok(r.sent === 1 && r.mailed === 0, "напоминание отмечено, письмо не ушло", r);
    const again = await quiet(() => runReminders(env));
    ok(again.sent === 0 && lettersTo("nevezuchiy@mail.ru").length === 0, "вдогонку оно не шлётся — срок остался в ленте", again);
  }

  console.log("\n— Сводка недели: утро понедельника —");
  {
    const mon = tzForMonday9();
    await addUser("delovoy@mail.ru", "Олег", mon);
    await addReminder("delovoy@mail.ru", "НДФЛ за работников", day(2, mon), "9");
    await addUser("pustoy@mail.ru", "Пётр", mon);                       // сроков нет: сказать нечего, кроме пробного периода
    await addUser("tihiy@mail.ru", "Тихон", mon, { mail_off: 1 });
    await addReminder("tihiy@mail.ru", "Срок тихого", day(1, mon), "9");
    await addUser("ne-utro@mail.ru", "Нина", mon + 5);
    await addReminder("ne-utro@mail.ru", "Срок не в то время", day(1, mon + 5), "9");

    const before2 = inbox.length;
    const d = await runDigest(env, null);
    ok(d.sent === 3 && d.mailed === 1 && inbox.length === before2 + 1, "сводку получили трое, письмом — один", d);
    const m = read(lettersTo("delovoy@mail.ru").at(-1)), b = plain(m);
    ok(m.subject === "На этой неделе: 1 срок", "тема говорит, сколько сроков на неделе", m.subject);
    ok(b.includes(`• НДФЛ за работников — ${ru(day(2, mon))} (через 2 дн.)`), "срок недели в письме", b.slice(0, 220));
    ok(b.includes("Совет недели") && b.includes("unsubscribe.html#"), "есть совет недели и ссылка «отключить»");
    ok(!/бесплатно|kupit|<b>|Продлить/i.test(b.split("Совет недели")[0]), "в письме нет ни предложений, ни разметки мессенджера", b);
    ok(lettersTo("pustoy@mail.ru").length === 0, "тому, кому нечего сказать, кроме предложения, письмо не уходит");
    ok((await notes("pustoy@mail.ru")).some(n => /бесплатно/.test(n.body)), "предложение пробного периода осталось на сайте, в ленте");
    ok(lettersTo("tihiy@mail.ru").length === 0 && (await notes("tihiy@mail.ru")).length === 1, "отключившему письма — только лента");
    ok(lettersTo("ne-utro@mail.ru").length === 0, "у кого сейчас не утро понедельника — ничего");
    const d2 = await runDigest(env, null);
    ok(d2.sent === 0 && inbox.length === before2 + 1, "второй раз за неделю сводка не уходит", d2);
  }

  console.log("\n— Предупреждение о списании —");
  {
    const HOURS = 3600000;
    const pay = { ...env, YOOKASSA_SHOP_ID: "shop", YOOKASSA_SECRET_KEY: "key", YOOKASSA_API_URL: "http://127.0.0.1:8809" };
    const tz = tzForHour(11), late = tzForHour(4);
    const sub = { plan: "basic", auto_renew: 1, auto_method: "pm-1", auto_plan: "basic:month" };
    const soon = Date.now() + 60 * HOURS;
    await addUser("platit@mail.ru", "Павел", tz, { ...sub, pro_until: soon });
    await addUser("molchun@mail.ru", "Матвей", tz, { ...sub, pro_until: soon, mail_off: 1, auto_plan: "pro:year", plan: "pro" });
    await addUser("nezabud@mail.ru", "Надя", tz, { ...sub, pro_until: soon, auto_price: 390 });
    await addUser("rano@mail.ru", "Рая", tz, { ...sub, pro_until: Date.now() + 10 * 24 * HOURS });
    await addUser("otkazalsya@mail.ru", "Олег", tz, { ...sub, pro_until: soon, auto_renew: 0 });
    await addUser("bez-karty@mail.ru", "Борис", tz, { plan: "basic", pro_until: soon });
    await addUser("spit@mail.ru", "Соня", late, { ...sub, pro_until: soon });

    ok((await runRenewNotices(env)).skipped === "billing-off", "пока оплата не подключена, предупреждать не о чем");

    const before2 = inbox.length;
    const r = await runRenewNotices(pay);
    ok(r.told === 3 && r.mailed === 3 && inbox.length === before2 + 3, "предупреждены те, у кого спишут в ближайшие дни", r);
    const m = read(lettersTo("platit@mail.ru").at(-1)), b = plain(m);
    const chargeDay = ru(new Date(soon - 24 * HOURS + tz * HOURS).toISOString().slice(0, 10));
    const until = ru(new Date(soon + tz * HOURS).toISOString().slice(0, 10));
    ok(m.subject === `Подписка продлится ${chargeDay}: спишется до 490 ₽`, "в теме — день списания и сумма", m.subject);
    ok(b.includes(`оплачен до ${until}`) && b.includes(`${chargeDay} подписка продлится автоматически на месяц`), "названы конец срока и день списания", b.slice(0, 260));
    ok(b.includes("спишется 490 ₽") && b.includes("«Базовый»"), "названы тариф и сумма");
    ok(b.includes("«Отменить подписку»"), "сказано, как отказаться, — названием настоящей кнопки");
    ok(!b.includes("unsubscribe") && !m.header("List-Unsubscribe"), "это служебное письмо: от него не отписываются");
    const my = read(lettersTo("molchun@mail.ru").at(-1));
    ok(Boolean(my.subject) && plain(my).includes("на год") && plain(my).includes("6990 ₽"), "отключивший напоминания о списании всё равно узнаёт", my.subject);
    ok(plain(read(lettersTo("nezabud@mail.ru").at(-1))).includes("спишется 390 ₽"), "сумма — зафиксированная за человеком, а не с витрины");
    ok(lettersTo("rano@mail.ru").length === 0, "до списания далеко — письма нет");
    ok(lettersTo("otkazalsya@mail.ru").length === 0, "отключил автопродление — предупреждать не о чем");
    ok(lettersTo("bez-karty@mail.ru").length === 0, "подписка без сохранённой карты не списывается — и письма нет");
    ok(lettersTo("spit@mail.ru").length === 0, "у кого ночь — письмо подождёт до утра");
    ok((await notes("platit@mail.ru")).some(n => n.title === `Подписка продлится ${chargeDay}`), "то же предупреждение лежит в ленте на сайте");

    const r2 = await runRenewNotices(pay);
    ok(r2.told === 0 && inbox.length === before2 + 3, "на одно продление — одно предупреждение", r2);

    /* Прошёл месяц: срок сдвинулся — предупреждение о следующем списании уйдёт снова. */
    await q("UPDATE users SET pro_until = ? WHERE email = ?", soon + 30 * 24 * HOURS, "platit@mail.ru");
    ok((await runRenewNotices(pay)).told === 0, "сразу после продления письма нет");
    await q("UPDATE users SET pro_until = ? WHERE email = ?", Date.now() + 50 * HOURS, "platit@mail.ru");
    const r3 = await runRenewNotices(pay);
    ok(r3.told === 1 && lettersTo("platit@mail.ru").length === 2, "перед следующим списанием — новое предупреждение", r3);
    ok((await one("SELECT renew_notice AS n FROM users WHERE email = ?", "spit@mail.ru")).n === null, "у спящего отметки нет — утром письмо уйдёт");
  }

  console.log(`\nИТОГО: ${pass} пройдено, ${fail} провалено\n`);
  if (fail) console.log("журнал сервиса (хвост):\n" + appLog.slice(-1200));
  finish(fail ? 1 : 0);
} catch (e) {
  console.log("\nСБОЙ ПРОВЕРКИ:", e.stack || e.message);
  console.log("журнал сервиса (хвост):\n" + appLog.slice(-1500));
  finish(1);
}
