/* Адрес сервера можно подменить: так один и тот же набор проверок
   гоняется и по боевому Cloudflare, и по новому серверу до переезда.
   API_URL=http://127.0.0.1:8080 node tests/run-all.mjs */
const API = process.env.API_URL || "https://pravofin-api.pravofin.workers.dev";
import { makeAdmin, cleanup } from "./_admin.mjs";
const ORIGIN = "https://divine-guest.github.io";
const rawFetch = globalThis.fetch;
globalThis.fetch = async (u, i) => {
  let last;
  for (let n = 0; n < 4; n++) {
    try { return await rawFetch(u, i); }
    catch (e) { last = e; await new Promise(r => setTimeout(r, 1500 * (n + 1))); }
  }
  throw last;
};
let pass = 0, fail = 0;
const ok = (c, l, x = "") => { c ? (pass++, console.log("  ✓", l)) : (fail++, console.log("  ✗", l, x)); };
async function call(path, { method = "GET", body, token } = {}) {
  const r = await fetch(API + path, {
    method,
    headers: { Origin: ORIGIN, ...(body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

const email = `prof${Date.now()}@test.ru`;

console.log("\n— Фото на аватарке —");
const reg = await call("/api/auth/register", { method: "POST", body: { name: "Фото Тест", email, password: "parol12345" } });
const t = reg.data.token;

const tinyJpeg = "data:image/jpeg;base64," + "A".repeat(2000);
ok((await call("/api/auth/profile", { method: "POST", token: t, body: { avatar: tinyJpeg } })).data.user?.avatar === tinyJpeg,
   "картинка JPEG принимается и возвращается");
ok((await call("/api/auth/profile", { method: "POST", token: t, body: { avatar: "⚖" } })).data.user?.avatar === "⚖",
   "emoji тоже принимается");
ok((await call("/api/auth/profile", { method: "POST", token: t, body: { avatar: "data:image/svg+xml;base64,PHN2Zz4=" } })).status === 400,
   "SVG отклоняется (в нём можно спрятать скрипт)");
ok((await call("/api/auth/profile", { method: "POST", token: t, body: { avatar: "data:image/jpeg;base64," + "A".repeat(70000) } })).status === 400,
   "слишком тяжёлое фото отклоняется");
ok((await call("/api/auth/profile", { method: "POST", token: t, body: { name: "Я" } })).status === 400,
   "имя из одной буквы отклоняется");

console.log("\n— Мои устройства —");
const l1 = await call("/api/auth/login", { method: "POST", body: { email, password: "parol12345" } });
const l2 = await call("/api/auth/login", { method: "POST", body: { email, password: "parol12345" } });
const ses = await call("/api/auth/sessions", { token: t });
ok(ses.data.sessions?.length === 3, `видны все три сессии (${ses.data.sessions?.length})`);
ok(ses.data.sessions.filter(x => x.current).length === 1, "ровно одна помечена как текущая");
ok(!JSON.stringify(ses.data).includes("token"), "сами токены наружу не отдаются");

console.log("\n— Выход везде —");
const la = await call("/api/auth/logout-all", { method: "POST", token: t });
ok(la.data.closed === 2, `закрыто чужих сессий: ${la.data.closed}`);
ok((await call("/api/auth/me", { token: t })).status === 200, "текущее устройство осталось в аккаунте");
ok((await call("/api/auth/me", { token: l1.data.token })).status === 401, "первое чужое вышло");
ok((await call("/api/auth/me", { token: l2.data.token })).status === 401, "второе чужое вышло");

console.log("\n— Сброс пароля администратором —");
const admin = await makeAdmin(call);
const ot = admin.token;

ok((await call("/api/admin/reset-password", { method: "POST", token: t, body: { email: admin.email } })).status === 403,
   "обычный пользователь сбросить чужой пароль не может");

const rp = await call("/api/admin/reset-password", { method: "POST", token: ot, body: { email } });
ok(rp.status === 200 && rp.data.tempPassword?.startsWith("pf-"), `владелец выдал временный пароль (${rp.data.tempPassword})`);
ok((await call("/api/auth/me", { token: t })).status === 401, "все сессии сброшенного закрыты");
ok((await call("/api/auth/login", { method: "POST", body: { email, password: rp.data.tempPassword } })).status === 200,
   "вход по временному паролю работает — доступ восстановлен");
ok((await call("/api/auth/login", { method: "POST", body: { email, password: "parol12345" } })).status === 401,
   "старый пароль больше не подходит");

console.log(`\nИТОГО: ${pass} пройдено, ${fail} провалено\n`);
process.exit(fail ? 1 : 0);

await cleanup(admin.email);
