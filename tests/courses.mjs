const API = process.env.API_URL || "https://pravofin-api.pravofin.workers.dev", O = "https://divine-guest.github.io";
const rf=globalThis.fetch; globalThis.fetch=async(u,i)=>{let l;for(let n=0;n<4;n++){try{return await rf(u,i);}catch(e){l=e;await new Promise(r=>setTimeout(r,1500*(n+1)));}}throw l;};
let p=0,f=0; const ok=(c,l,x="")=>{c?(p++,console.log("  ✓",l)):(f++,console.log("  ✗",l,x));};
async function call(path,{method="GET",body,token}={}){const r=await fetch(API+path,{method,headers:{Origin:O,...(body?{"Content-Type":"application/json"}:{}),...(token?{Authorization:"Bearer "+token}:{})},body:body?JSON.stringify(body):undefined});return{status:r.status,data:await r.json().catch(()=>({}))};}

const st=Date.now();
const em=`crs${st}@test.ru`;
const t=(await call("/api/auth/register",{method:"POST",body:{name:"Курсы Тест",email:em,password:"parol12345"}})).data.token;

console.log("\n— Без входа —");
ok((await call("/api/courses/lesson?course=acc&lesson=0")).status===401,"аноним — 401");

console.log("\n— Бесплатный тариф —");
// Первый урок открыт намеренно как ознакомительный, закрыты со второго
const l0=await call("/api/courses/lesson?course=acc&lesson=0",{token:t});
ok(l0.status===200 && l0.data.preview===true, "первый урок открыт как ознакомительный");
const lx=await call("/api/courses/lesson?course=acc&lesson=1",{token:t});
ok(lx.status===402 && lx.data.paywall, `второй урок — 402 (${lx.data.error})`);
ok(!JSON.stringify(lx.data).includes("ККТ"), "текст закрытого урока не утёк");

console.log("\n— Текста нет и в файле курсов —");
const js=await (await fetch("https://divine-guest.github.io/ecofin/js/courses.js?v=41")).text();
ok(!js.includes("402-ФЗ"), "содержимое платных уроков отсутствует в js/courses.js");
ok(js.includes("locked: true"), "платные уроки помечены locked");
ok(js.includes("Первичные документы"), "названия уроков остались — каталог показывает, что покупаешь");

console.log("\n— После оплаты (промокод) —");
await call("/api/billing/promo",{method:"POST",token:t,body:{code:"PRO2026"}});
const l1=await call("/api/courses/lesson?course=acc&lesson=0",{token:t});
ok(l1.status===200 && l1.data.lesson?.body, `урок открылся: «${l1.data.lesson?.title}»`);
ok(l1.data.lesson.body.includes("402-ФЗ"), "содержимое пришло полностью");

console.log("\n— Границы —");
ok((await call("/api/courses/lesson?course=fin&lesson=0",{token:t})).status===404,"бесплатный курс через этот маршрут не отдаётся");
ok((await call("/api/courses/lesson?course=acc&lesson=99",{token:t})).status===404,"несуществующий урок — 404");
ok((await call("/api/courses/lesson?course=hack&lesson=0",{token:t})).status===404,"выдуманный курс — 404");

console.log(`\nИТОГО: ${p} пройдено, ${f} провалено\n`);
