/* Полная проверка доступов: что закрыто бесплатному тарифу,
   что открывается на «Базовом», что только на «Про». */
/* Адрес сервера можно подменить: так один и тот же набор проверок
   гоняется и по боевому Cloudflare, и по новому серверу до переезда.
   API_URL=http://127.0.0.1:8080 node tests/run-all.mjs */
const API = process.env.API_URL || "https://pravofin-api.pravofin.workers.dev";
import { makeAdmin, cleanup } from "./_admin.mjs";
const O = "https://divine-guest.github.io";
const rf = globalThis.fetch;
globalThis.fetch = async (u, i) => {
  let l;
  for (let n = 0; n < 4; n++) {
    try { return await rf(u, i); }
    catch (e) { l = e; await new Promise(r => setTimeout(r, 1500 * (n + 1))); }
  }
  throw l;
};
let pass = 0, fail = 0;
const ok = (c, l, x = "") => { c ? (pass++, console.log("  ✓", l)) : (fail++, console.log("  ✗", l, x)); };
async function call(p, { method = "GET", body, token } = {}) {
  const r = await fetch(API + p, {
    method,
    headers: { Origin: O, ...(body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

const st = Date.now();

async function make(name) {
  const email = `acc${st}${name}@test.ru`;
  const r = await call("/api/auth/register", { method: "POST", body: { name: "Доступ " + name, email, password: "parol12345" } });
  return { email, token: r.data.token };
}

const free = await make("free");
console.log("\n— Бесплатный тариф: что видно —");
const me = await call("/api/auth/me", { token: free.token });
const u = me.data.user;
ok(u.tier === "free", `тариф: ${u.tier} («${u.planTitle}»)`);
ok(u.features.theming === false, "темы оформления: закрыто");
ok(u.features.courses === false, "платные курсы: закрыто");
ok(u.features.telegram === false, "доставка в Telegram: закрыта");
ok(u.features.priority === false, "приоритет: закрыт");

console.log("\n— Бесплатный тариф: попытки обойти —");
ok((await call("/api/themes", { method: "POST", token: free.token, body: { id: "plum" } })).status === 402,
   "сменить тему — 402 пейволл");
ok((await call("/api/auth/profile", { method: "POST", token: free.token, body: { plan: "pro", tier: "pro", role: "admin" } })).data.user?.tier === "free",
   "выдать себе тариф через профиль — не вышло");
ok((await call("/api/admin/grant", { method: "POST", token: free.token, body: { email: free.email, plan: "year", tier: "pro" } })).status === 403,
   "выдать себе подписку — 403");
ok((await call("/api/admin/points", { method: "POST", token: free.token, body: { email: free.email, delta: 99999 } })).status === 403,
   "начислить себе баллы — 403");
ok((await call("/api/admin/users", { token: free.token })).status === 403, "список пользователей — 403");

console.log("\n— Лимиты бесплатного —");
let q = (await call("/api/quota", { token: free.token })).data;
ok(q.ai.limit === 3, `вопросов ИИ в день: ${q.ai.limit}`);
ok(q.tool.limit === 1, `пробных запусков: ${q.tool.limit}`);
const r1 = await call("/api/reminders", { method: "POST", token: free.token, body: { title: "Один", due: "2027-01-15", channel: "telegram" } });
ok(r1.status === 201, "первое напоминание создаётся");
const lst = await call("/api/reminders", { token: free.token });
ok(lst.data.reminders[0].channel === "site", "канал Telegram понижен до сайта");
await call("/api/reminders", { method: "POST", token: free.token, body: { title: "Два", due: "2027-01-16" } });
await call("/api/reminders", { method: "POST", token: free.token, body: { title: "Три", due: "2027-01-17" } });
ok((await call("/api/reminders", { method: "POST", token: free.token, body: { title: "Четыре", due: "2027-01-18" } })).status === 402,
   "четвёртое напоминание — 402");

console.log("\n— Инструменты: пробный запуск —");
const t1 = await call("/api/ai", { method: "POST", token: free.token, body: { kind: "tool", prompt: "Чек-лист регистрации ИП, кратко", maxTokens: 150 } });
ok(t1.status === 200, "первый запуск проходит");
ok((await call("/api/ai", { method: "POST", token: free.token, body: { kind: "tool", prompt: "Ещё", maxTokens: 100 } })).status === 402,
   "второй — 402");
ok((await call("/api/analyze", { method: "POST", token: free.token, body: { text: "ДОГОВОР. Пункт 1.", fileName: "d.txt" } })).status === 402,
   "разбор документа — 402");

console.log("\n— Владелец выдаёт «Базовый» —");
const admin = await makeAdmin(call);
let ot = admin.token;
if (!ot) { console.log("    (владелец недоступен — блок пропущен)"); }
else {
  await call("/api/admin/grant", { method: "POST", token: ot, body: { email: free.email, plan: "month", tier: "basic" } });
  const b = (await call("/api/auth/me", { token: free.token })).data.user;
  ok(b.tier === "basic", `тариф стал: ${b.tier}`);
  ok(b.features.telegram === true, "Telegram открылся");
  ok(b.features.courses === false, "курсы всё ещё закрыты");
  ok(b.features.theming === false, "темы всё ещё закрыты");
  ok((await call("/api/themes", { method: "POST", token: free.token, body: { id: "plum" } })).status === 402,
     "сменить тему на «Базовом» — по-прежнему 402");
  const qb = (await call("/api/quota", { token: free.token })).data;
  ok(qb.ai.limit === 300, `лимит ИИ: ${qb.ai.limit}`);
  ok(qb.analyze.limit === 20, `разборов в месяц: ${qb.analyze.limit}`);

  console.log("\n— Владелец выдаёт «Про» —");
  await call("/api/admin/grant", { method: "POST", token: ot, body: { email: free.email, plan: "month", tier: "pro" } });
  const p = (await call("/api/auth/me", { token: free.token })).data.user;
  ok(p.tier === "pro", `тариф стал: ${p.tier}`);
  ok(p.features.courses === true && p.features.theming === true, "курсы и темы открылись");
  ok((await call("/api/themes", { method: "POST", token: free.token, body: { id: "plum" } })).status === 200, "тема применяется");
  const qp = (await call("/api/quota", { token: free.token })).data;
  ok(qp.analyze.limit === null, "разборы стали безлимитными");

  console.log("\n— Истечение подписки —");
  await call("/api/admin/revoke", { method: "POST", token: ot, body: { email: free.email } });
  const after = (await call("/api/auth/me", { token: free.token })).data.user;
  ok(after.tier === "free", `после снятия: ${after.tier}`);
  ok(after.features.theming === false, "темы снова закрыты");
  ok((await call("/api/themes", { method: "POST", token: free.token, body: { id: "" } })).status === 200,
     "вернуться к теме сервиса можно и без подписки");
}


console.log("\n— Распознавание документа по фото —");
{
  /* Крошечная белая точка: содержимое неважно, важно, что запрос
     проходит проверки и доходит до модели. */
  const dot = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

  ok((await call("/api/ocr", { method: "POST", body: { images: [dot] } })).status === 401,
     "без входа распознавание закрыто");

  const guest = await make("ocr");
  ok((await call("/api/ocr", { method: "POST", token: guest.token, body: { images: [] } })).status === 400,
     "пустой список изображений отклонён");
  ok((await call("/api/ocr", { method: "POST", token: guest.token, body: { images: ["javascript:alert(1)"] } })).status === 400,
     "не-картинка отклонена");
  ok((await call("/api/ocr", { method: "POST", token: guest.token, body: { images: ["data:image/png;base64," + "A".repeat(7e6)] } })).status === 400,
     "слишком большое изображение отклонено");

  /* Расход тот же, что у разбора: иначе распознавание стало бы способом
     получить разбор в обход лимита — распознал, отправил текст дальше. */
  const before = (await call("/api/quota", { token: guest.token })).data;
  const run = await call("/api/ocr", { method: "POST", token: guest.token, body: { images: [dot], fileName: "точка.png" } });
  ok(run.status === 200 || run.status === 502 || run.status === 504,
     `распознавание отвечает (${run.status})`, run.data.error);

  const after = (await call("/api/quota", { token: guest.token })).data;
  if (run.status === 200) {
    ok(after.tool.left === before.tool.left - 1, `успешный запуск списал попытку: было ${before.tool.left}, стало ${after.tool.left}`);
    /* Второй заход на исчерпанном лимите обязан упереться в пейволл,
       а не молча сработать. */
    const again = await call("/api/ocr", { method: "POST", token: guest.token, body: { images: [dot] } });
    ok(again.status === 402 && again.data.paywall, "на исчерпанном лимите — предложение подписки, а не отказ");
  } else {
    /* Провайдер не ответил — попытка должна вернуться. У бесплатного
       тарифа она одна, и сжигать её за чужой сбой нечестно. */
    ok(after.tool.left === before.tool.left,
       `при сбое провайдера попытка возвращена: было ${before.tool.left}, осталось ${after.tool.left}`);
  }
}

console.log(`\nИТОГО: ${pass} пройдено, ${fail} провалено\n`);

await cleanup(admin.email);
