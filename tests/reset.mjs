/* Смена забытого пароля по коду из письма.

   Главное, что проверяем, — не «работает ли счастливый путь», а то, что
   форма не превращается в две опасные вещи:

   1. Проверку «есть ли у этого человека аккаунт в ЭкоФине». Ответ на
      запрос кода обязан быть одинаковым для своего и чужого адреса.
   2. Дверь в чужой аккаунт. Шесть цифр перебираются за минуты, и от
      подбора защищают только срок кода и счётчик попыток.

   Проверки идут и с настроенной почтой, и без неё: пока ключа провайдера
   нет, сброса не должно быть вовсе — ни формы, ни обещаний.

   API_URL=http://127.0.0.1:8770 node tests/reset.mjs                  */

const API = process.env.API_URL || "https://ecofin26.ru";
const ORIGIN = process.env.ORIGIN || "https://ecofin26.ru";

let pass = 0, fail = 0;
const ok = (c, label, extra = "") => {
  c ? (pass++, console.log("  ✓", label)) : (fail++, console.log("  ✗", label, extra));
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
  let data = {};
  try { data = await r.json(); } catch {}
  return { status: r.status, data };
}

const stamp = Date.now();
const mine = `reset${stamp}@test.ru`;
const stranger = `nobody${stamp}@test.ru`;

console.log("\n— Умеет ли сервис слать письма —");
const state = await call("/api/auth/reset/state");
ok(state.status === 200 && typeof state.data.mail === "boolean",
   `состояние почты отдаётся: ${JSON.stringify(state.data)}`);
const mailOn = state.data.mail === true;

console.log(mailOn
  ? "  почта настроена — проверяем полный путь"
  : "  почта не настроена — проверяем, что сброса нет и ничего не обещано");

console.log("\n— Заведомо неверные запросы —");
ok((await call("/api/auth/reset/request", { method: "POST", body: { email: "не-почта" } })).status === 400,
   "адрес без собаки отклонён");
ok((await call("/api/auth/reset/confirm", { method: "POST", body: { email: mine, code: "123456", newPassword: "1234" } })).status === 400,
   "короткий пароль отклонён");

const noCode = await call("/api/auth/reset/confirm",
  { method: "POST", body: { email: stranger, code: "123456", newPassword: "parol12345" } });
ok(noCode.status === 400 && /не запрашивали|устарел/i.test(noCode.data.error || ""),
   "подтверждение без запроса кода отклонено", JSON.stringify(noCode.data));

if (!mailOn) {
  console.log("\n— Почты нет: сброс недоступен —");
  const r = await call("/api/auth/reset/request", { method: "POST", body: { email: mine } });
  ok(r.status === 200 && r.data.mail === false && r.data.sent === false,
     "сервер честно отвечает, что письма не отправляет", JSON.stringify(r.data));
} else {
  console.log("\n— Почта есть: полный путь —");
  const reg = await call("/api/auth/register", {
    method: "POST",
    body: { name: "Сброс Тест", email: mine, password: "parol12345", consent: true },
  });
  ok(reg.status === 200, "тестовый аккаунт заведён", JSON.stringify(reg.data).slice(0, 120));

  /* Ответ обязан быть одинаковым для существующего адреса и для чужого:
     иначе форма отвечает на вопрос «а зарегистрирован ли такой человек». */
  const a = await call("/api/auth/reset/request", { method: "POST", body: { email: mine } });
  const b = await call("/api/auth/reset/request", { method: "POST", body: { email: stranger } });
  ok(a.status === b.status && JSON.stringify(a.data) === JSON.stringify(b.data),
     "ответ одинаков для своего и чужого адреса",
     `${a.status} ${JSON.stringify(a.data)} / ${b.status} ${JSON.stringify(b.data)}`);

  const wrong = await call("/api/auth/reset/confirm",
    { method: "POST", body: { email: mine, code: "000000", newPassword: "novyiparol123" } });
  ok(wrong.status === 400 && /код/i.test(wrong.data.error || ""),
     "неверный код не пускает", JSON.stringify(wrong.data));
  ok(/осталось попыток/i.test(wrong.data.error || ""),
     "и человек видит, сколько попыток осталось", wrong.data.error);

  /* Сам код знает только почтовый ящик, поэтому дальше проверять нечего:
     удачный путь проверяется руками при настройке провайдера. */
  const t = reg.data.token;
  if (t) await call("/api/auth/delete", { method: "POST", token: t });
}

console.log(`\nИТОГО: ${pass} пройдено, ${fail} провалено\n`);
process.exit(fail ? 1 : 0);
