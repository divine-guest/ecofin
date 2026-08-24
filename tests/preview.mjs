const API="https://pravofin-api.pravofin.workers.dev", O="https://divine-guest.github.io";
const rf=globalThis.fetch; globalThis.fetch=async(u,i)=>{let l;for(let n=0;n<4;n++){try{return await rf(u,i);}catch(e){l=e;await new Promise(r=>setTimeout(r,1500*(n+1)));}}throw l;};
let p=0,f=0; const ok=(c,l,x="")=>{c?(p++,console.log("  ✓",l)):(f++,console.log("  ✗",l,x));};
async function call(path,{method="GET",body,token}={}){const r=await fetch(API+path,{method,headers:{Origin:O,...(body?{"Content-Type":"application/json"}:{}),...(token?{Authorization:"Bearer "+token}:{})},body:body?JSON.stringify(body):undefined});return{status:r.status,data:await r.json().catch(()=>({}))};}

const st=Date.now();
const t=(await call("/api/auth/register",{method:"POST",body:{name:"Превью Тест",email:`pv${st}@test.ru`,password:"parol12345"}})).data.token;

console.log("\n— Бесплатный тариф —");
const l0=await call("/api/courses/lesson?course=acc&lesson=0",{token:t});
ok(l0.status===200 && l0.data.lesson?.body, `первый урок открыт: «${l0.data.lesson?.title}»`);
ok(l0.data.preview===true, "помечен как ознакомительный");
ok(l0.data.total===4, `всего уроков в курсе: ${l0.data.total}`);

const l1=await call("/api/courses/lesson?course=acc&lesson=1",{token:t});
ok(l1.status===402, `второй урок закрыт: ${l1.data.error}`);
ok(!JSON.stringify(l1.data).includes("ККТ"), "содержимое второго урока не утекло");

const l3=await call("/api/courses/lesson?course=law&lesson=0",{token:t});
ok(l3.status===200, "первый урок второго платного курса тоже открыт");
ok((await call("/api/courses/lesson?course=law&lesson=2",{token:t})).status===402,"третий закрыт");

console.log("\n— После оплаты —");
await call("/api/billing/promo",{method:"POST",token:t,body:{code:"PRO2026"}});
const all=await call("/api/courses/lesson?course=acc&lesson=3",{token:t});
ok(all.status===200 && all.data.preview===false, "последний урок открылся, метка превью снята");

console.log(`\nИТОГО: ${p} пройдено, ${f} провалено\n`);
