/* Временный админ для тестов.

   Раньше сюиты входили под настоящим аккаунтом владельца с паролем,
   зашитым в код. Владелец сменил пароль — и половина тестов «упала»,
   хотя сайт исправен. Теперь каждая сюита заводит свой одноразовый
   аккаунт и повышает его до админа прямо в базе: тесты больше не
   зависят от живого пароля и не трогают рабочий аккаунт. */
const CF = "https://api.cloudflare.com/client/v4/accounts/04620413cc9a8d415f85febe903d7e60/d1/database/00a64f5f-477b-4eb4-98a0-7bd1385556e5/query";

export async function sql(statement) {
  const r = await fetch(CF, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + process.env.D1_API_TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ sql: statement }),
  });
  const j = await r.json();
  if (!j.success) throw new Error("D1: " + JSON.stringify(j.errors));
  return j.result[0].results;
}

/** Регистрирует свежий аккаунт, делает его админом, возвращает {email, token}. */
export async function makeAdmin(call) {
  const email = `adm${Date.now()}@test.ru`;
  const reg = await call("/api/auth/register", {
    method: "POST",
    body: { name: "Тест Админ", email, password: "parol12345" },
  });
  if (!reg.data.token) throw new Error("не создан админ: " + JSON.stringify(reg.data));
  await sql(`UPDATE users SET role='admin' WHERE email='${email}'`);
  /* Роль читается из базы при каждом запросе, поэтому выданный токен
     уже действует как админский — перевходить не нужно. */
  return { email, token: reg.data.token };
}

/** Убирает за собой: аккаунт и все его следы. */
export async function cleanup(email) {
  for (const t of ["reminders", "point_ops", "sessions", "usage",
                   "actions", "payments", "notifications"]) {
    try { await sql(`DELETE FROM ${t} WHERE email='${email}'`); } catch {}
  }
  try { await sql(`DELETE FROM users WHERE email='${email}'`); } catch {}
}
