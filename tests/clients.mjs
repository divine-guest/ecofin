/* Несколько дел в одном кабинете.

   Главное здесь — не «работает ли добавление», а изоляция: учёт одного
   клиента не должен подмешиваться к другому и тем более к чужому
   кабинету. Ошибка тут означает неверный налог у живого человека,
   и заметят её через месяц, когда искать поздно. */
const API = process.env.API_URL || "https://pravofin-api.pravofin.workers.dev", O = "https://divine-guest.github.io";
import { makeAdmin, cleanup } from "./_admin.mjs";
const rf=globalThis.fetch; globalThis.fetch=async(u,i)=>{let l;for(let n=0;n<4;n++){try{return await rf(u,i);}catch(e){l=e;await new Promise(r=>setTimeout(r,1500*(n+1)));}}throw l;};
let pass=0,fail=0; const ok=(c,l,x="")=>{c?(pass++,console.log("  ✓",l)):(fail++,console.log("  ✗",l,x));};
async function call(p,{method="GET",body,token}={}){const r=await fetch(API+p,{method,headers:{Origin:O,...(body?{"Content-Type":"application/json"}:{}),...(token?{Authorization:"Bearer "+token}:{})},body:body?JSON.stringify(body):undefined});return{status:r.status,data:await r.json().catch(()=>({}))};}

const st = Date.now();
const admin = await makeAdmin(call);
const day = new Date().toISOString().slice(0, 10);

const buh = `buh${st}@test.ru`, oth = `oth${st}@test.ru`;
const T = (await call("/api/auth/register", { method: "POST", body: { name: "Бухгалтер Тест", email: buh, password: "parol12345" } })).data.token;
const T2 = (await call("/api/auth/register", { method: "POST", body: { name: "Чужой Тест", email: oth, password: "parol12345" } })).data.token;

console.log("\n— Закрыто без подписки —");
ok((await call("/api/clients", { token: T })).status === 402, "список дел требует платного тарифа");
ok((await call("/api/clients", { method: "POST", token: T, body: { name: "ИП Иванов" } })).status === 402, "добавить дело нельзя");
ok((await call("/api/clients")).status === 401, "без входа — 401");

await call("/api/admin/grant", { method: "POST", token: admin.token, body: { email: buh, plan: "pro", period: "month" } });
await call("/api/admin/grant", { method: "POST", token: admin.token, body: { email: oth, plan: "pro", period: "month" } });

console.log("\n— С подпиской —");
const empty = await call("/api/clients", { token: T });
ok(empty.status === 200 && empty.data.own?.id === 0, "своё дело есть всегда");
ok((empty.data.clients || []).length === 0, "клиентов пока нет");

const c1 = await call("/api/clients", { method: "POST", token: T, body: { name: "ИП Петров", inn: "770712345678", form: "ip", regime: "usn6" } });
const c2 = await call("/api/clients", { method: "POST", token: T, body: { name: "ООО Ромашка", form: "ooo", regime: "usn15" } });
ok(c1.status === 201 && c2.status === 201, "два дела заведены");
ok((await call("/api/clients", { method: "POST", token: T, body: { name: "я" } })).status === 400, "имя короче двух букв не принимается");
ok((await call("/api/clients", { method: "POST", token: T, body: { name: "Выдумка", regime: "мимо" } })).status === 201, "выдуманный режим не валит запрос");

console.log("\n— Учёт разделён по делам —");
await call("/api/book/op", { method: "POST", token: T, body: { day, kind: "income", amount: 100000, client: c1.data.id } });
await call("/api/book/op", { method: "POST", token: T, body: { day, kind: "income", amount: 500000, client: c2.data.id } });
await call("/api/book/op", { method: "POST", token: T, body: { day, kind: "income", amount: 7000 } });

const b1 = (await call(`/api/book?client=${c1.data.id}`, { token: T })).data;
const b2 = (await call(`/api/book?client=${c2.data.id}`, { token: T })).data;
const b0 = (await call("/api/book", { token: T })).data;
ok(b1.year.income === 100000, `у первого клиента ${b1.year.income}`);
ok(b2.year.income === 500000, `у второго ${b2.year.income}`);
ok(b0.year.income === 7000, `в своём деле ${b0.year.income} — чужое не подмешалось`);
ok(b1.profile.regime === "usn6" && b2.profile.regime === "usn15", "у каждого дела свой режим");
ok(b1.profile.name === "ИП Петров", "название дела приходит на страницу");

const all = (await call("/api/clients", { token: T })).data;
ok(all.clients.find(c => c.id === c1.data.id)?.year.income === 100000, "в списке дел итоги посчитаны");
ok(all.own.year.income === 7000, "и по своему делу тоже");

console.log("\n— Чужое трогать нельзя —");
ok((await call(`/api/book?client=${c1.data.id}`, { token: T2 })).status === 404, "чужое дело не открыть по номеру");
ok((await call("/api/clients/delete", { method: "POST", token: T2, body: { id: c1.data.id } })).status === 404, "и не удалить");
ok((await call("/api/book/op", { method: "POST", token: T2, body: { day, kind: "income", amount: 1, client: c1.data.id } })).status === 404, "и не записать операцию");
ok((await call(`/api/book/export?client=${c1.data.id}`, { token: T2 })).status === 404, "и не выгрузить книгу учёта");

console.log("\n— Удаление уносит записи —");
ok((await call("/api/clients/delete", { method: "POST", token: T, body: { id: c1.data.id } })).status === 200, "дело удалено");
ok((await call(`/api/book?client=${c1.data.id}`, { token: T })).status === 404, "и больше не открывается");
ok((await call("/api/book", { token: T })).data.year.income === 7000, "своё дело не пострадало");

console.log(`\nИТОГО: ${pass} пройдено, ${fail} провалено\n`);
await cleanup(admin.email);
