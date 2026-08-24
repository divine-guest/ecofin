const API = "https://pravofin-api.pravofin.workers.dev";
const O = "https://divine-guest.github.io";
const rawFetch = globalThis.fetch;
globalThis.fetch = async (u,i)=>{let l;for(let n=0;n<4;n++){try{return await rawFetch(u,i);}catch(e){l=e;await new Promise(r=>setTimeout(r,1500*(n+1)));}}throw l;};
let pass=0,fail=0; const ok=(c,l,x="")=>{c?(pass++,console.log("  ✓",l)):(fail++,console.log("  ✗",l,x));};
async function call(p,{method="GET",body,token}={}){const r=await fetch(API+p,{method,headers:{Origin:O,...(body?{"Content-Type":"application/json"}:{}),...(token?{Authorization:"Bearer "+token}:{})},body:body?JSON.stringify(body):undefined});return{status:r.status,data:await r.json().catch(()=>({}))};}

const st = Date.now();
const inviter = `inv${st}@test.ru`, friend = `frn${st}@test.ru`;

const a = await call("/api/auth/register",{method:"POST",body:{name:"Пригласивший Тест",email:inviter,password:"parol12345"}});
const at = a.data.token;
const rs = await call("/api/referral",{token:at});
const code = rs.data.code;
ok(/^PF-[A-Z2-9]{5}$/.test(code), `код выдан: ${code}`);
ok(rs.data.link.includes("ref="+code), "ссылка-приглашение собрана");
ok(rs.data.invited.length === 0, "приглашённых пока нет");

console.log("\n— Проверка кода до регистрации —");
const pv = await call("/api/referral/check?code="+code);
ok(pv.status===200 && pv.data.valid, `код проверяется публично, пригласил: ${pv.data.inviter}`);
ok(!JSON.stringify(pv.data).includes(inviter), "почта пригласившего наружу не уходит");
ok((await call("/api/referral/check?code=PF-ZZZZZ")).status===404, "выдуманный код отклонён");

console.log("\n— Регистрация по приглашению —");
const b = await call("/api/auth/register",{method:"POST",body:{name:"Друг Тест",email:friend,password:"parol12345",ref:code}});
const bt = b.data.token;
ok(b.status===201, "друг зарегистрировался");
ok(b.data.user.plan==="free", "награда НЕ выдана сразу — только за пустую регистрацию не платим");

const after = await call("/api/referral",{token:at});
ok(after.data.invited.length===1, "приглашённый виден в списке");
ok(!after.data.invited[0].hint.includes("frn"), `почта скрыта: ${after.data.invited[0].hint}`);
ok(after.data.invited[0].rewarded===false, "помечен как «награда ещё не начислена»");

console.log("\n— Награда после реального использования —");
const use = await call("/api/ai",{method:"POST",token:bt,body:{kind:"chat",prompt:"Ответь словом ОК",maxTokens:30}});
ok(use.status===200, "друг воспользовался ИИ");
const inv2 = await call("/api/auth/me",{token:at});
const frn2 = await call("/api/auth/me",{token:bt});
/* Награда — баллы на баланс, а не подписка: сервис ничего не теряет,
   а потратить их можно только внутри сервиса. */
const balInv = inv2.data.user.points ?? 0;
const balFrn = frn2.data.user.points ?? 0;
ok(balInv === 150, `пригласившему начислено баллов: ${balInv}`);
ok(balFrn === 150, `приглашённому начислено баллов: ${balFrn}`);
ok(inv2.data.user.plan !== "pro" && frn2.data.user.plan !== "pro",
   "подписка за приглашение НЕ выдаётся — только баллы");

console.log("\n— Защита от накрутки —");
await call("/api/ai",{method:"POST",token:bt,body:{kind:"chat",prompt:"ещё раз",maxTokens:30}});
const inv3 = await call("/api/auth/me",{token:at});
const d2 = inv3.data.user.points ?? 0;
ok(d2===150, `повторное использование не платит второй раз (баллов по-прежнему ${d2})`);
const self = await call("/api/auth/register",{method:"POST",body:{name:"Сам Себя",email:`self${st}@test.ru`,password:"parol12345",ref:code}});
ok(self.status===201, "регистрация с чужим кодом проходит");
const badref = await call("/api/auth/register",{method:"POST",body:{name:"Кривой Код",email:`bad${st}@test.ru`,password:"parol12345",ref:"PF-XXXXX"}});
ok(badref.status===201, "неверный код не мешает зарегистрироваться");

console.log(`\nИТОГО: ${pass} пройдено, ${fail} провалено\n`);
