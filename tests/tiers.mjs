const API = process.env.API_URL || "https://pravofin-api.pravofin.workers.dev", O = "https://divine-guest.github.io";
import io from "node:fs";
const THEMES_JS = new URL("../js/themes.js", import.meta.url);
import { makeAdmin, cleanup, sql } from "./_admin.mjs";
const rf=globalThis.fetch; globalThis.fetch=async(u,i)=>{let l;for(let n=0;n<4;n++){try{return await rf(u,i);}catch(e){l=e;await new Promise(r=>setTimeout(r,1500*(n+1)));}}throw l;};
let p=0,f=0; const ok=(c,l,x="")=>{c?(p++,console.log("  ✓",l)):(f++,console.log("  ✗",l,x));};
async function call(path,{method="GET",body,token}={}){const r=await fetch(API+path,{method,headers:{Origin:O,...(body?{"Content-Type":"application/json"}:{}),...(token?{Authorization:"Bearer "+token}:{})},body:body?JSON.stringify(body):undefined});return{status:r.status,data:await r.json().catch(()=>({}))};}

const st=Date.now();

console.log("\n— Бесплатный тариф —");
const em=`t${st}@test.ru`;
const u=await call("/api/auth/register",{method:"POST",body:{name:"Тариф Тест",email:em,password:"parol12345"}});
const t=u.data.token;
ok(u.data.user.tier==="free", `уровень: ${u.data.user.tier}, называется «${u.data.user.planTitle}»`);
const q=await call("/api/quota",{token:t});
ok(q.data.ai.limit===3, `вопросов ИИ в день: ${q.data.ai.limit}`);
ok(q.data.tool.limit===1, `пробных запусков: ${q.data.tool.limit}`);
ok(u.data.user.features.theming===false, "оформление недоступно");

console.log("\n— Оформление под себя — только «Про» —");
const th=await call("/api/themes",{token:t});
ok(th.data.allowed===false, "на Старте оформление закрыто");
const clientThemes = (io.readFileSync(THEMES_JS, "utf8").match(/id:\s*"([a-z]+)"/g) || [])
  .map(m => m.split('"')[1]);
const serverThemes = th.data.ids || [];
const missing = clientThemes.filter(id => !serverThemes.includes(id));
ok(missing.length === 0,
   `сервер принимает все ${clientThemes.length} тем клиента`,
   missing.length ? "сервер не знает: " + missing.join(", ") : "");
const deny=await call("/api/themes",{method:"POST",token:t,body:{id:"indigo"}});
ok(deny.status===402 && deny.data.paywall, "смена оформления упирается в пейволл");
ok((await call("/api/themes",{method:"POST",token:t,body:{id:""}})).status===200, "вернуться к оформлению сервиса можно всегда");

console.log("\n— Админ выдаёт конкретный тариф —");
const admin = await makeAdmin(call);
let ot = admin.token;
if(!ot){ console.log("    (владелец недоступен, пропускаю блок)"); }
else {
  await call("/api/admin/grant",{method:"POST",token:ot,body:{email:em,plan:"month",tier:"basic"}});
  const me=await call("/api/auth/me",{token:t});
  ok(me.data.user.tier==="basic", `выдан тариф: ${me.data.user.tier} («${me.data.user.planTitle}»)`);
  const q2=await call("/api/quota",{token:t});
  ok(q2.data.ai.limit===300, `лимит ИИ вырос до ${q2.data.ai.limit}`);
  ok(q2.data.analyze.limit===20, `разборов документов в месяц: ${q2.data.analyze.limit}`);
  ok((await call("/api/themes",{token:t})).data.allowed===false, "на Базовом оформление всё ещё закрыто");

  await call("/api/admin/grant",{method:"POST",token:ot,body:{email:em,plan:"month",tier:"pro"}});
  const me2=await call("/api/auth/me",{token:t});
  ok(me2.data.user.tier==="pro", `повышен до: ${me2.data.user.tier}`);
  const q3=await call("/api/quota",{token:t});
  ok(q3.data.analyze.limit===null, "разборы стали безлимитными");
  ok((await call("/api/themes",{token:t})).data.allowed===true, "оформление открылось");
  const set=await call("/api/themes",{method:"POST",token:t,body:{id:"indigo"}});
  ok(set.status===200 && set.data.current==="indigo", `оформление выбрано: ${set.data.current}`);
  const me3=await call("/api/auth/me",{token:t});
  ok(me3.data.user.themeAccent==="indigo", "оформление сохранилось в профиле");
}

console.log("\n— Цены —");
const pl=await call("/api/billing/plans");
const basic=pl.data.plans.find(x=>x.id==="basic"), pro=pl.data.plans.find(x=>x.id==="pro");
ok(basic.price.month===290 && pro.price.month===690, `цены: ${basic.price.month} и ${pro.price.month} ₽`);
ok(basic.yearDiscount===28 && pro.yearDiscount===34, `годовая скидка: ${basic.yearDiscount}% и ${pro.yearDiscount}%`);
ok(pl.data.enterprise.contact===true, "тариф «Бухгалтер» — по запросу, не продаётся кнопкой");

console.log(`\nИТОГО: ${p} пройдено, ${f} провалено\n`);
