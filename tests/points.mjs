const API="https://pravofin-api.pravofin.workers.dev", O="https://divine-guest.github.io";
import { makeAdmin, cleanup, sql } from "./_admin.mjs";
const rf=globalThis.fetch; globalThis.fetch=async(u,i)=>{let l;for(let n=0;n<4;n++){try{return await rf(u,i);}catch(e){l=e;await new Promise(r=>setTimeout(r,1500*(n+1)));}}throw l;};
let p=0,f=0; const ok=(c,l,x="")=>{c?(p++,console.log("  ✓",l)):(f++,console.log("  ✗",l,x));};
async function call(path,{method="GET",body,token}={}){const r=await fetch(API+path,{method,headers:{Origin:O,...(body?{"Content-Type":"application/json"}:{}),...(token?{Authorization:"Bearer "+token}:{})},body:body?JSON.stringify(body):undefined});return{status:r.status,data:await r.json().catch(()=>({}))};}

const st=Date.now();
const admin = await makeAdmin(call);
const ot = admin.token;

console.log("\n— Пригласивший и приглашённый —");
const inv=`inv${st}@test.ru`, frn=`frn${st}@test.ru`;
const a=await call("/api/auth/register",{method:"POST",body:{name:"Пригласивший Тест",email:inv,password:"parol12345"}});
const at=a.data.token;
const rs=await call("/api/referral",{token:at});
const code=rs.data.code;
ok(rs.data.balance===0, `у пригласившего 0 баллов на старте`);
ok(rs.data.reward.inviterPaid===500, `награда за оплату друга: ${rs.data.reward.inviterPaid} баллов`);

const b=await call("/api/auth/register",{method:"POST",body:{name:"Друг Тест",email:frn,password:"parol12345",ref:code}});
const bt=b.data.token;
const fp=await call("/api/points",{token:bt});
ok(fp.data.balance===150, `приглашённому сразу начислено ${fp.data.balance} баллов`);
ok(fp.data.rules.includes("не выводятся"), "правила указывают, что баллы не выводятся");

console.log("\n— Награда за реальное использование —");
await call("/api/ai",{method:"POST",token:bt,body:{kind:"chat",prompt:"Ответь: ок",maxTokens:30}});
const ip=await call("/api/points",{token:at});
ok(ip.data.balance===150, `пригласившему начислено ${ip.data.balance} баллов после работы друга`);
await call("/api/ai",{method:"POST",token:bt,body:{kind:"chat",prompt:"Ещё раз",maxTokens:30}});
const ip2=await call("/api/points",{token:at});
ok(ip2.data.balance===150, `повторное использование не начисляет второй раз (${ip2.data.balance})`);

console.log("\n— Скидка считается на сервере —");
const ex=ip2.data.example;
ok(ex.used===150 && ex.toPay===340, `при 150 баллах месяц за 490 ₽ → списать ${ex.used}, доплатить ${ex.toPay}`);
const big=await call("/api/admin/points",{method:"POST",token:ot,body:{email:inv,delta:5000,reason:"проверка потолка"}});
ok(big.status===200 && big.data.balance===5150, `админ начислил вручную, баланс ${big.data.balance}`);
const ex2=(await call("/api/points",{token:at})).data.example;
ok(ex2.used===245, `потолок работает: при 5150 баллах спишется только ${ex2.used} из 490 ₽ (половина)`);

console.log("\n— Защита —");
ok((await call("/api/admin/points",{method:"POST",token:at,body:{email:inv,delta:9999,reason:"сам себе"}})).status===403,
   "обычный пользователь не может начислить себе баллы");
const neg=await call("/api/admin/points",{method:"POST",token:ot,body:{email:frn,delta:-99999,reason:"в минус"}});
ok((await call("/api/points",{token:bt})).data.balance===0, "баланс не уходит в минус");

console.log("\n— История —");
const h=await call("/api/points",{token:at});
ok(h.data.history.length>=2, `операций в журнале: ${h.data.history.length}`);
h.data.history.slice(0,3).forEach(x=>console.log(`    ${x.delta>0?"+":""}${x.delta} — ${x.reason}`));

console.log(`\nИТОГО: ${p} пройдено, ${f} провалено\n`);

await cleanup(admin.email);
