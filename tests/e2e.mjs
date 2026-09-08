/* Сквозной тест живого API: проверяем, что запреты нельзя обойти. */
/* У Node 18 короткий таймаут соединения, на Cloudflare это даёт ложные обрывы.
   Ретраим — к самому API отношения не имеет. */
const rawFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  let last;
  for (let i = 0; i < 4; i++) {
    try { return await rawFetch(url, init); }
    catch (e) { last = e; await new Promise(r => setTimeout(r, 1500 * (i + 1))); }
  }
  throw last;
};
/* Адрес сервера можно подменить: так один и тот же набор проверок
   гоняется и по боевому Cloudflare, и по новому серверу до переезда.
   API_URL=http://127.0.0.1:8080 node tests/run-all.mjs */
const API = process.env.API_URL || "https://pravofin-api.pravofin.workers.dev";
import { makeAdmin, cleanup, sql } from "./_admin.mjs";
const ORIGIN = "https://divine-guest.github.io";

let pass = 0, fail = 0;
const ok = (cond, label, extra = "") => {
  if (cond) { pass++; console.log("  ✓", label); }
  else { fail++; console.log("  ✗", label, extra); }
};

async function call(path, { method = "GET", body, token } = {}) {
  const r = await fetch(API + path, {
    method,
    headers: {
      Origin: ORIGIN,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

const stamp = Date.now();
const alice = `alice${stamp}@test.ru`;
const bob = `bob${stamp}@test.ru`;

console.log("\n— Регистрация и роли —");
const a = await call("/api/auth/register", { method: "POST", body: { name: "Алиса Тест", email: alice, password: "parol12345", consent: true } });
ok(a.status === 201 && a.data.user.role === "user", "обычный пользователь получает роль user");
ok(a.data.user.plan === "free", "и тариф free");
const aliceT = a.data.token;

const b = await call("/api/auth/register", { method: "POST", body: { name: "Боб Тест", email: bob, password: "parol12345", consent: true } });
const bobT = b.data.token;

/* Работаем под одноразовым админом: настоящий аккаунт владельца
   тесты не трогают — ни паролем, ни регистрацией. */
const admin = await makeAdmin(call);
const ownerT = admin.token;

/* Свойство «почта из OWNER_EMAILS = владелец» проверяем чтением:
   на рабочей базе аккаунт владельца уже есть, трогать его нельзя.

   На пустой базе (так гоняют тесты локально) его нет, и раньше проверка
   падала на ровном месте — не потому что сайт сломан, а потому что базу
   только что создали. Поэтому недостающий аккаунт заводим сами и сами же
   убираем. Удаляем строго при условии, что создали её мы: иначе один
   прогон против рабочей базы снёс бы владельцу вход. */
const OWNER = "9034092309egor@gmail.com";
let ownerCreated = false;
let all = await call("/api/admin/users", { token: ownerT });
let ownerRow = (all.data.users || []).find(u => u.email === OWNER);
if (!ownerRow) {
  const made = await call("/api/auth/register", {
    method: "POST",
    body: { name: "Владелец", email: OWNER, password: "parol12345", consent: true },
  });
  ownerCreated = made.status === 201;
  all = await call("/api/admin/users", { token: ownerT });
  ownerRow = (all.data.users || []).find(u => u.email === OWNER);
}
ok(ownerRow?.role === "owner", `почта из OWNER_EMAILS имеет роль владельца (${ownerRow?.role})`);
if (ownerCreated) await cleanup(OWNER);
ok(admin.token && (await call("/api/auth/me", { token: ownerT })).data.user.isAdmin === true,
   "у админа открыта админка");

console.log("\n— Запреты —");
ok((await call("/api/admin/users", { token: aliceT })).status === 403, "обычный пользователь не видит список пользователей");
ok((await call("/api/admin/stats", { token: aliceT })).status === 403, "и не видит выручку");
ok((await call("/api/admin/grant", { method: "POST", token: aliceT, body: { email: alice, plan: "year" } })).status === 403,
   "и не может выдать Pro сам себе");
ok((await call("/api/admin/set-role", { method: "POST", token: aliceT, body: { email: alice, role: "admin" } })).status === 403,
   "и не может сделать себя админом");
ok((await call("/api/admin/users")).status === 401, "без токена — 401");
ok((await call("/api/admin/users", { token: "poddelka" })).status === 401, "с выдуманным токеном — 401");

console.log("\n— Лимиты бесплатного тарифа —");
let q = (await call("/api/quota", { token: aliceT })).data;
ok(q.tool.left === 1 && q.tool.limit === 1, `пробный запуск инструмента: ${q.tool.left} из ${q.tool.limit}`);
ok(q.ai.limit === 3, `лимит ИИ в сутки: ${q.ai.limit}`);

/* Отказ поставщика ИИ — не наша поломка.

   К этому месту несколько сюит уже отстрелялись по внешней модели, и
   она начинает отвечать отказом по частоте. Эти две проверки падали в
   каждом полном прогоне и проходили при повторе поодиночке.

   Считать это провалом нельзя: постоянно моргающая проверка приучает
   не смотреть на красное, и однажды за ней прячется настоящая ошибка.
   Отказ по любой ДРУГОЙ причине по-прежнему валит проверку. */
const upstreamDown = r =>
  r.status === 502 || r.status === 503 || r.status === 429 ||
  /провайдер|upstream|перегруж|попробуйте/i.test(String((r.data && r.data.error) || ""));

let t1 = await call("/api/ai", { method: "POST", token: aliceT, body: { kind: "tool", prompt: "Составь чек-лист регистрации ИП. Кратко.", maxTokens: 200 } });

/* Одна повторная попытка: короткий всплеск частоты проходит сам. */
if (upstreamDown(t1)) {
  await new Promise(r => setTimeout(r, 4000));
  t1 = await call("/api/ai", { method: "POST", token: aliceT, body: { kind: "tool", prompt: "Составь чек-лист регистрации ИП. Кратко.", maxTokens: 200 } });
}

const aiSkipped = upstreamDown(t1);
if (aiSkipped) {
  console.log("  ~ поставщик ИИ не отвечает — две проверки запусков пропущены:",
              String((t1.data && t1.data.error) || t1.status).slice(0, 70));
} else {
  ok(t1.status === 200 && t1.data.text, "первый запуск инструмента проходит", t1.data);
}

const t2 = await call("/api/ai", { method: "POST", token: aliceT, body: { kind: "tool", prompt: "Ещё один чек-лист", maxTokens: 200 } });
if (!aiSkipped) ok(t2.status === 402 && t2.data.paywall, "второй запуск упирается в пейволл (402)");

const t3 = await call("/api/analyze", { method: "POST", token: aliceT, body: { text: "ДОГОВОР ОКАЗАНИЯ УСЛУГ. Пункт 1. Предмет.", fileName: "d.txt" } });
ok(t3.status === 402, "анализ документа тоже закрыт после исчерпания пробного");

console.log("\n— Владелец выдаёт Pro —");
const g = await call("/api/admin/grant", { method: "POST", token: ownerT, body: { email: alice, plan: "month" } });
ok(g.status === 200 && g.data.user.plan === "pro", "Pro выдан на месяц");
const days = Math.round((g.data.user.proUntil - Date.now()) / 86400000);
ok(days === 30, `срок подписки: ${days} дн.`);

const g2 = await call("/api/admin/grant", { method: "POST", token: ownerT, body: { email: alice, plan: "year" } });
const days2 = Math.round((g2.data.user.proUntil - Date.now()) / 86400000);
ok(days2 === 395, `повторная выдача продлевает, а не перезаписывает: ${days2} дн.`);

q = (await call("/api/quota", { token: aliceT })).data;
ok(q.pro === true && q.tool.left === null, "у Pro лимит инструментов снят");
const t4 = await call("/api/ai", { method: "POST", token: aliceT, body: { kind: "tool", prompt: "Проверка доступа Pro. Ответь словом ОК.", maxTokens: 50 } });
ok(t4.status === 200, "инструменты снова работают");

console.log("\n— Роли: границу держит окружение, а не база —");
/* Ключевое свойство: роль владельца выдаётся только переменной
   OWNER_EMAILS. Запись 'owner' прямо в базу понижается до admin,
   поэтому доступ к базе не даёт прав владельца. */
await sql(`UPDATE users SET role='owner' WHERE email='${admin.email}'`);
const climb = await call("/api/auth/me", { token: ownerT });
ok(climb.data.user.role === "admin",
   `запись 'owner' в базу НЕ делает владельцем (роль осталась ${climb.data.user.role})`);

ok((await call("/api/admin/set-role", { method: "POST", token: ownerT, body: { email: bob, role: "admin" } })).status === 403,
   "админ не может назначить другого админа — только владелец");
ok((await call("/api/admin/set-role", { method: "POST", token: ownerT, body: { email: OWNER, role: "user" } })).status === 403,
   "админ не может понизить владельца");
ok((await call("/api/admin/stats", { token: ownerT })).status === 200,
   "статистика админу доступна — это его работа");


console.log("\n— Промокод —");
/* Свежая сессия Боба: блок, где она заводилась, переписан. */
const bobT2 = (await call("/api/auth/login", { method: "POST",
  body: { email: bob, password: "parol12345" } })).data.token;

const p1 = await call("/api/billing/promo", { method: "POST", token: bobT2, body: { code: "PRO2026" } });
ok(p1.status === 200 && p1.data.days === 30, "промокод PRO2026 даёт 30 дней");
ok((await call("/api/billing/promo", { method: "POST", token: bobT2, body: { code: "PRO2026" } })).status === 409,
   "повторно тот же код не активируется");
ok((await call("/api/billing/promo", { method: "POST", token: bobT2, body: { code: "VYDUMANNYJ" } })).status === 404,
   "выдуманный код отклоняется");

console.log("\n— Оплата —");
const bp = await call("/api/billing/plans");
ok(bp.data.enabled === false, "эквайринг пока не подключён — так и сообщается");
ok((await call("/api/billing/create", { method: "POST", token: aliceT, body: { plan: "year" } })).status === 503,
   "создать платёж нельзя, пока нет ключей ЮKassa");

console.log("\n— Согласие на обработку данных —");
{
  /* Галочка в форме — не доказательство. Обязанность доказать, что
     согласие получено, лежит на операторе (часть 1 статьи 9 152-ФЗ),
     а проверка в браузере обходится одним запросом к API мимо формы.
     И обходилась: аккаунт заводился, в базе не оставалось ничего.

     Здесь проверяется ровно это: без отметки сервер отказывает, с
     отметкой сохраняет момент и редакцию политики, и человек видит
     их в своей выгрузке. */
  const noCons = `nocons${stamp}@test.ru`;
  const r1 = await call("/api/auth/register", {
    method: "POST", body: { name: "Без Согласия", email: noCons, password: "parol12345" },
  });
  ok(r1.status === 400, "регистрация без согласия отклоняется", r1.status);

  const r2 = await call("/api/auth/register", {
    method: "POST", body: { name: "Мимо Формы", email: noCons, password: "parol12345", consent: "да" },
  });
  ok(r2.status === 400, "строка вместо отметки согласием не считается", r2.status);

  const consEmail = `cons${stamp}@test.ru`;
  const r3 = await call("/api/auth/register", {
    method: "POST", body: { name: "С Согласием", email: consEmail, password: "parol12345", consent: true },
  });
  ok(r3.status === 201, "с согласием регистрация проходит", r3.status);

  const dump = await call("/api/auth/export", { token: r3.data.token });
  const c = dump.data && dump.data.profile && dump.data.profile.consent;
  ok(!!c && !!c.at, "момент согласия сохранён и виден в выгрузке", c);
  ok(!!c && /^\d{4}-\d{2}-\d{2}/.test(String(c.policyVersion || "")),
     "вместе с согласием сохранена редакция политики", c && c.policyVersion);

  /* И в журнале действий — туда человек смотрит сам. */
  const meRow = await call("/api/auth/me", { token: r3.data.token });
  const acts = ((meRow.data && meRow.data.actions) || []).map(a => a.text).join(" | ");
  ok(/Согласие на обработку/.test(acts), "согласие записано в журнал действий", acts.slice(0, 120));
}

console.log("\n— Согласие у тех, кого не спросили как следует —");
{
  /* Аккаунты, заведённые до восьмого сентября, живут без отметки:
     галочка в форме была, но на сервер не приезжала. Дорисовать дату
     задним числом нельзя — это подлог. Значит спрашиваем ещё раз.

     Здесь проверяется главное свойство этой ручки: она ставит
     сегодняшнюю дату и НЕ переписывает уже стоящую. Иначе при каждом
     входе согласие «обновлялось» бы, и первая — настоящая — дата
     терялась. Доказательство, которое само себя затирает, ничего
     не доказывает. */
  await sql("DELETE FROM ratelimit WHERE bucket LIKE 'register:%'");
  const oldEmail = `oldacc${stamp}@test.ru`;
  const reg = await call("/api/auth/register", {
    method: "POST", body: { name: "Старый Аккаунт", email: oldEmail, password: "parol12345", consent: true },
  });
  const T = reg.data.token;
  ok(reg.data.user.needsConsent === false,
     "у нового аккаунта окно не появляется", reg.data.user.needsConsent);

  /* Приводим аккаунт в то состояние, в котором сейчас живут все,
     кто зарегистрировался раньше. */
  await sql(`UPDATE users SET consent_at = NULL, consent_doc = NULL WHERE email = '${oldEmail}'`);

  const me1 = await call("/api/auth/me", { token: T });
  ok(me1.data.user.needsConsent === true, "старый аккаунт помечен как «надо спросить»", me1.data.user.needsConsent);

  const no = await call("/api/auth/consent", { method: "POST", token: T, body: { consent: false } });
  ok(no.status === 400, "отказ не засчитывается за согласие", no.status);

  const yes = await call("/api/auth/consent", { method: "POST", token: T, body: { consent: true } });
  ok(yes.status === 200 && yes.data.consentAt, "подтверждение записывается", yes.data);

  const me2 = await call("/api/auth/me", { token: T });
  ok(me2.data.user.needsConsent === false, "и больше не спрашивается", me2.data.user.needsConsent);

  const again = await call("/api/auth/consent", { method: "POST", token: T, body: { consent: true } });
  ok(again.data.already === true && again.data.consentAt === yes.data.consentAt,
     "повторное подтверждение не переписывает первую дату", [yes.data.consentAt, again.data.consentAt]);

  /* Отметка должна дойти и до журнала, и до выгрузки — как у новых. */
  const dump = await call("/api/auth/export", { token: T });
  ok(dump.data.profile.consent && dump.data.profile.consent.at === yes.data.consentAt,
     "подтверждение видно в выгрузке", dump.data.profile.consent);

  /* Дата хранится в читаемом виде. Сначала она писалась числом
     миллисекунд в текстовую колонку, SQLite дописывал «.0», и
     значение в базе переставало совпадать с тем, что сервер вернул
     в ответе. Доказательство, которое читают люди, должно читаться. */
  ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(String(yes.data.consentAt)),
     "дата согласия записана в читаемом виде", yes.data.consentAt);
}

console.log("\n— Гигиена —");
/* Счётчик регистраций с одного адреса — восемь в час, и этот набор
   заводит людей чаще. Без сброса проверка «повторный email отклонён»
   получала бы 429 вместо 409 и падала, хотя сайт исправен. Ровно та
   же ловушка, из-за которой перед каждой сюитой чистится ratelimit. */
await sql("DELETE FROM ratelimit WHERE bucket LIKE 'register:%'");
ok((await call("/api/auth/register", { method: "POST", body: { name: "Дубль", email: alice, password: "parol12345", consent: true } })).status === 409,
   "повторная регистрация того же email отклоняется");
const wrongOrigin = await fetch(API + "/api/quota", { headers: { Origin: "https://zloj-sajt.example", Authorization: "Bearer " + aliceT } });
ok(wrongOrigin.status === 403, "запрос с чужого домена отклоняется");
ok((await call("/api/auth/logout", { method: "POST", token: aliceT })).status === 200, "выход выполняется");
ok((await call("/api/quota", { token: aliceT })).status === 401, "после выхода токен недействителен");

console.log(`\nИТОГО: ${pass} пройдено, ${fail} провалено\n`);
process.exit(fail ? 1 : 0);

await cleanup(admin.email);
