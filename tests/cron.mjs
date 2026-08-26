/* Адрес сервера можно подменить: так один и тот же набор проверок
   гоняется и по боевому Cloudflare, и по новому серверу до переезда.
   API_URL=http://127.0.0.1:8080 node tests/run-all.mjs */
const API = process.env.API_URL || "https://pravofin-api.pravofin.workers.dev";
import { makeAdmin, cleanup } from "./_admin.mjs";
const O = "https://divine-guest.github.io";
const rawFetch = globalThis.fetch;
globalThis.fetch = async (u,i)=>{let l;for(let n=0;n<4;n++){try{return await rawFetch(u,i);}catch(e){l=e;await new Promise(r=>setTimeout(r,1500*(n+1)));}}throw l;};
let pass=0,fail=0; const ok=(c,l,x="")=>{c?(pass++,console.log("  ✓",l)):(fail++,console.log("  ✗",l,x));};
async function call(p,{method="GET",body,token}={}){const r=await fetch(API+p,{method,headers:{Origin:O,...(body?{"Content-Type":"application/json"}:{}),...(token?{Authorization:"Bearer "+token}:{})},body:body?JSON.stringify(body):undefined});return{status:r.status,data:await r.json().catch(()=>({}))};}

const admin = await makeAdmin(call);
const ot = admin.token;
if(!ot){ ot=(await call("/api/auth/register",{method:"POST",body:{name:"Егор",email:owner,password:"parol12345"}})).data.token; }

const today=new Date(Date.now()+3*3600000).toISOString().slice(0,10);
const in3=new Date(Date.now()+3*86400000+3*3600000).toISOString().slice(0,10);

console.log("\n— Готовим сроки: сегодня и через 3 дня —");
await call("/api/reminders",{method:"POST",token:ot,body:{title:"Платёж сегодня",due:today,notifyDays:"3,1,0"}});
await call("/api/reminders",{method:"POST",token:ot,body:{title:"Платёж через три дня",due:in3,notifyDays:"3,1,0"}});
const before=(await call("/api/notifications",{token:ot})).data;
console.log(`  уведомлений до прогона: ${before.notifications.length}`);

console.log("\n— Прогон рассылки —");
const run=await call("/api/admin/run-reminders",{method:"POST",token:ot});
ok(run.status===200, `рассылка отработала: отправлено ${run.data.sent}, перенесено ${run.data.rolled}`);

const after=(await call("/api/notifications",{token:ot})).data;
ok(after.notifications.length>before.notifications.length, `в ленте появилось ${after.notifications.length-before.notifications.length} уведомления`);
after.notifications.slice(0,3).forEach(n=>console.log(`    · ${n.title} — ${n.body}`));
ok(after.unread>0, `непрочитанных: ${after.unread}`);

console.log("\n— Повторный прогон не задваивает —");
const run2=await call("/api/admin/run-reminders",{method:"POST",token:ot});
ok(run2.data.sent===0, `второй прогон отправил ${run2.data.sent} (должно быть 0)`);
const after2=(await call("/api/notifications",{token:ot})).data;
ok(after2.notifications.length===after.notifications.length, "в ленте ничего не задвоилось");

console.log("\n— Отметка прочитанным —");
await call("/api/notifications/read",{method:"POST",token:ot,body:{}});
const read=(await call("/api/notifications",{token:ot})).data;
ok(read.unread===0, "все отмечены прочитанными");

console.log(`\nИТОГО: ${pass} пройдено, ${fail} провалено\n`);

await cleanup(admin.email);
