/* Проверки раздела «Моё дело».

   Что здесь важно проверить и почему именно это:

   1. Итог года считается по ВСЕМ записям, а не по тем, что видны.
      На бесплатном тарифе часть истории закрыта, и если бы итог
      складывался из выданных строк, человек видел бы заниженный доход —
      и заниженный остаток до лимита. То есть сервис врал бы ровно в том,
      ради чего его открывают.

   2. Чужую запись нельзя удалить, подставив её номер.

   3. Копейки. Суммы хранятся целыми копейками; проверяем, что рубль
      с копейками возвращается тем же, а не 1234.5600000001.            */

const API = process.env.API_URL || "https://pravofin-api.pravofin.workers.dev", O = "https://divine-guest.github.io";
import { makeAdmin, cleanup } from "./_admin.mjs";
const rf=globalThis.fetch; globalThis.fetch=async(u,i)=>{let l;for(let n=0;n<4;n++){try{return await rf(u,i);}catch(e){l=e;await new Promise(r=>setTimeout(r,1500*(n+1)));}}throw l;};
let p=0,f=0; const ok=(c,l,x="")=>{c?(p++,console.log("  ✓",l)):(f++,console.log("  ✗",l,x));};
async function call(path,{method="GET",body,token}={}){const r=await fetch(API+path,{method,headers:{Origin:O,...(body?{"Content-Type":"application/json"}:{}),...(token?{Authorization:"Bearer "+token}:{})},body:body?JSON.stringify(body):undefined});return{status:r.status,data:await r.json().catch(()=>({}))};}

const st = Date.now();
const admin = await makeAdmin(call);
const year = new Date().getFullYear();
const thisMonth = new Date().toISOString().slice(0, 7);

const me = `book${st}@test.ru`;
const reg = await call("/api/auth/register", { method: "POST", body: { name: "Учёт Тест", email: me, password: "parol12345" } });
const T = reg.data.token;

console.log("\n— Профиль дела —");
const empty = await call("/api/book", { token: T });
ok(empty.status === 200 && empty.data.profile.regime === "", "у нового аккаунта режим не выбран");
ok(Array.isArray(empty.data.ops) && empty.data.ops.length === 0, "записей нет");

const prof = await call("/api/book/profile", { method: "POST", token: T, body: { form: "ip", regime: "usn6", workers: 0 } });
ok(prof.status === 200 && prof.data.profile.regime === "usn6", "режим сохранён");
const bad = await call("/api/book/profile", { method: "POST", token: T, body: { form: "выдумка", regime: "выдумка" } });
ok(bad.data.profile.regime === "" && bad.data.profile.form === "", "выдуманный режим не сохраняется");
await call("/api/book/profile", { method: "POST", token: T, body: { form: "ip", regime: "usn6", workers: 0 } });

console.log("\n— Записи —");
const add = await call("/api/book/op", { method: "POST", token: T,
  body: { day: `${thisMonth}-05`, kind: "income", amount: 120000, payer: "company", party: "ООО Тест" } });
ok(add.status === 201 && add.data.id, "поступление записано");

const kop = await call("/api/book/op", { method: "POST", token: T,
  body: { day: `${thisMonth}-06`, kind: "income", amount: 1234.56, payer: "person" } });
ok(kop.status === 201, "сумма с копейками принята");

ok((await call("/api/book/op", { method: "POST", token: T, body: { day: "не дата", amount: 100 } })).status === 400,
   "битая дата отклоняется");
ok((await call("/api/book/op", { method: "POST", token: T, body: { day: `${thisMonth}-07`, amount: 0 } })).status === 400,
   "нулевая сумма отклоняется");
ok((await call("/api/book/op", { method: "POST", token: T, body: { day: `${thisMonth}-07`, amount: -5000 } })).status === 400,
   "отрицательная сумма отклоняется");

const cur = await call("/api/book", { token: T });
const kopRow = cur.data.ops.find(o => o.amount === 1234.56);
ok(Boolean(kopRow), `копейки вернулись без искажения: ${kopRow ? kopRow.amount : "не найдено"}`);
ok(cur.data.year.income === 121234.56, `доход за год: ${cur.data.year.income}`);
ok(cur.data.year.incomeFromPersons === 1234.56, `из них от физлиц: ${cur.data.year.incomeFromPersons}`);

console.log("\n— Итог года считается по всем записям, а не по видимым —");
/* Запись прошлого года и запись давнего месяца: первая в итог не входит,
   вторая входит, хотя на бесплатном тарифе её не видно. */
await call("/api/book/op", { method: "POST", token: T,
  body: { day: `${year}-01-09`, kind: "income", amount: 50000, payer: "company" } });
await call("/api/book/op", { method: "POST", token: T,
  body: { day: `${year - 1}-06-09`, kind: "income", amount: 999999, payer: "company" } });

const wide = await call("/api/book", { token: T });
ok(wide.data.year.income === 171234.56, `итог года учёл январскую запись: ${wide.data.year.income}`);
ok(wide.data.paid === false, "тариф бесплатный");
const janVisible = wide.data.ops.some(o => o.day === `${year}-01-09`);
const jan = new Date().getMonth() === 0;
ok(jan ? janVisible : !janVisible, jan
  ? "в январе своя же запись видна" : "запись прошлых месяцев в списке скрыта");
if (!jan) ok(wide.data.locked && wide.data.locked.count >= 1,
  `скрытых записей: ${wide.data.locked ? wide.data.locked.count : 0}`);
else p++, console.log("  ✓ проверка скрытых пропущена: сейчас январь");

console.log("\n— Книга учёта закрыта без подписки —");
const ex = await call("/api/book/export", { token: T });
ok(ex.status === 402 && ex.data.paywall, "выгрузка требует подписки");
ok(/на месте/.test(ex.data.error || ""), "и сообщает, что записи не потеряны");

console.log("\n— Подписка открывает историю —");
await call("/api/admin/grant", { method: "POST", token: admin.token, body: { email: me, plan: "pro", period: "month" } });
const paid = await call("/api/book", { token: T });
ok(paid.data.paid === true, "тариф стал платным");
ok(paid.data.locked === null, "скрытых записей больше нет");
ok(paid.data.ops.length === 3, `видны все записи года: ${paid.data.ops.length}`);
ok(!paid.data.ops.some(o => o.day.startsWith(String(year - 1))), "запись прошлого года в текущий год не попала");
const ex2 = await call("/api/book/export", { token: T });
ok(ex2.status === 200 && ex2.data.rows.length === 3, `выгрузка отдала строк: ${ex2.data.rows ? ex2.data.rows.length : 0}`);
ok(ex2.data.rows[0].day <= ex2.data.rows[1].day, "выгрузка отсортирована по дате");

console.log("\n— Чужое трогать нельзя —");
const other = `bookx${st}@test.ru`;
const o2 = await call("/api/auth/register", { method: "POST", body: { name: "Чужой Тест", email: other, password: "parol12345" } });
const T2 = o2.data.token;
const mineId = paid.data.ops[0].id;
const steal = await call("/api/book/op/delete", { method: "POST", token: T2, body: { id: mineId } });
ok(steal.status === 404, "чужую запись по номеру удалить нельзя");
ok((await call("/api/book", { token: T })).data.ops.length === 3, "запись на месте");
ok((await call("/api/book")).status === 401, "без входа раздел закрыт");

console.log("\n— Удаление своей —");
const del = await call("/api/book/op/delete", { method: "POST", token: T, body: { id: mineId } });
ok(del.status === 200, "своя запись удаляется");
ok((await call("/api/book", { token: T })).data.ops.length === 2, "список стал короче");

console.log("\n— Удаление аккаунта уносит учёт —");
await call("/api/auth/delete", { method: "POST", token: T2 });
ok((await call("/api/book", { token: T2 })).status === 401, "после удаления аккаунта доступа нет");

console.log(`\nИТОГО: ${p} пройдено, ${f} провалено\n`);

await cleanup(admin.email);
