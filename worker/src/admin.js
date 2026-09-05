/* ЭкоФин — админские эндпоинты. Роль проверяется в роутере до вызова,
   но каждая опасная операция дополнительно защищена от выстрела в ногу. */
import { json, fail, now, normEmail, publicUser, isPro, hashPassword } from "./lib.js";
import { extendUntil } from "./quota.js";
import { adminEmails, ownerEmails, logAction } from "./auth.js";
import { runReminders } from "./telegram.js";

import { PLANS, PERIOD_DAYS } from "./plans.js";
const PLAN_DAYS = PERIOD_DAYS;

/* Написания поискового запроса, по которым имеет смысл искать.

   SQLite меняет регистр только у латиницы: lower('Егор') — это по-прежнему
   'Егор'. Из-за этого поиск в админке вёл себя необъяснимо: «Егор» находил
   человека, «егор» — нет, и понять правило со стороны было невозможно.

   Чинить это в базе нечем: своей функции в D1 не завести, а отдельная
   колонка с готовым нижним регистром потребовала бы пересчёта всех уже
   заведённых строк. Зато регистр кириллицы прекрасно понимает JavaScript —
   поэтому варианты написания строим здесь и ищем по любому из них.

   Четыре варианта покрывают всё, что человек набирает в поиске руками:
   как ввёл, строчными, прописными и с заглавной у каждого слова.        */
function searchPatterns(raw) {
  const t = String(raw || "").trim().slice(0, 120);
  const title = t.toLowerCase().replace(/(^|\s)(\S)/gu, (_, sp, ch) => sp + ch.toUpperCase());
  return [...new Set([t, t.toLowerCase(), t.toUpperCase(), title])].map(v => `%${v}%`);
}

/* GET /api/admin/users?q=&limit=&offset= */
export async function listUsers(request, env, origin) {
  const url = new URL(request.url);
  const pats = searchPatterns(url.searchParams.get("q"));
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 100));
  const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);

  /* Условие собираем под число вариантов: их от одного до четырёх.
     Нумерованные подстановки, а не «?», — на них завязана прослойка db.mjs. */
  const whereU = pats.map((_, i) => `u.email LIKE ?${i + 1} OR u.name LIKE ?${i + 1}`).join(" OR ");
  const where  = pats.map((_, i) => `email LIKE ?${i + 1} OR name LIKE ?${i + 1}`).join(" OR ");
  const nLim = pats.length + 1, nOff = pats.length + 2;

  const rows = await env.DB.prepare(
    `SELECT u.*,
            (SELECT COALESCE(SUM(p.amount), 0) FROM payments p
              WHERE p.email = u.email AND p.status = 'succeeded') AS paid,
            (SELECT COALESCE(SUM(g.n), 0) FROM usage g
              WHERE g.email = u.email AND g.kind = 'ai') AS ai_total
       FROM users u
      WHERE ${whereU}
      ORDER BY u.created_at DESC
      LIMIT ?${nLim} OFFSET ?${nOff}`
  ).bind(...pats, limit, offset).all();

  const total = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM users WHERE ${where}`
  ).bind(...pats).first();

  const users = (rows.results || []).map(r => ({
    ...publicUser(r),
    paid: r.paid || 0,
    aiTotal: r.ai_total || 0,
    lastLoginAt: r.last_login_at,
  }));

  return json(env, origin, { users, total: total ? total.n : users.length, limit, offset });
}

/* GET /api/admin/stats — сводка для верхних плиток. */
export async function stats(request, env, origin) {
  const g = async (sql, ...bind) => (await env.DB.prepare(sql).bind(...bind).first()) || {};
  const monthAgo = now() - 30 * 86400000;

  const users = await g("SELECT COUNT(*) AS n FROM users");
  const pro = await g(
    "SELECT COUNT(*) AS n FROM users WHERE role IN ('admin','owner') OR (plan IN ('basic','pro') AND (pro_until IS NULL OR pro_until > ?))",
    now()
  );
  const revenue = await g("SELECT COALESCE(SUM(amount), 0) AS n FROM payments WHERE status = 'succeeded'");
  const revenue30 = await g(
    "SELECT COALESCE(SUM(amount), 0) AS n FROM payments WHERE status = 'succeeded' AND completed_at > ?",
    monthAgo
  );
  const paidCount = await g("SELECT COUNT(*) AS n FROM payments WHERE status = 'succeeded' AND source = 'yookassa'");
  const manualCount = await g("SELECT COUNT(*) AS n FROM payments WHERE source = 'manual'");
  const aiTotal = await g("SELECT COALESCE(SUM(n), 0) AS n FROM usage WHERE kind = 'ai'");
  const new30 = await g("SELECT COUNT(*) AS n FROM users WHERE created_at > ?", monthAgo);
  const active7 = await g("SELECT COUNT(*) AS n FROM users WHERE last_login_at > ?", now() - 7 * 86400000);

  return json(env, origin, {
    users: users.n || 0,
    pro: pro.n || 0,
    revenue: revenue.n || 0,
    revenue30: revenue30.n || 0,
    paidCount: paidCount.n || 0,
    manualCount: manualCount.n || 0,
    aiTotal: aiTotal.n || 0,
    new30: new30.n || 0,
    active7: active7.n || 0,
    owners: ownerEmails(env),
    envAdmins: adminEmails(env),
  });
}

/* POST /api/admin/grant {email, plan:'month'|'year'|'days', days?}
   Ручная выдача Pro. Пишется в payments с source='manual' и нулевой суммой,
   чтобы подарки не искажали выручку, но были видны в истории. */
export async function grant(request, env, origin, admin) {
  const b = await request.json().catch(() => ({}));
  const email = normEmail(b.email);
  const plan = b.plan === "year" ? "year" : b.plan === "days" ? "days" : "month";
  const days = plan === "days" ? Math.min(3650, Math.max(1, Number(b.days) || 0)) : PLAN_DAYS[plan];
  if (!days) return fail(env, origin, "Укажите срок в днях");
  /* Какой именно тариф дарим: по умолчанию старший. */
  const tier = PLANS[b.tier] && b.tier !== "free" ? b.tier : "pro";

  const target = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
  if (!target) return fail(env, origin, "Пользователь не найден", 404);

  const until = extendUntil(target.pro_until, days);
  await env.DB.prepare("UPDATE users SET plan = ?, pro_until = ? WHERE email = ?").bind(tier, until, email).run();
  await env.DB.prepare(
    `INSERT INTO payments (id, email, amount, plan, source, status, granted_by, created_at, completed_at)
     VALUES (?, ?, 0, ?, 'manual', 'succeeded', ?, ?, ?)`
  ).bind(`manual-${now()}-${email}`, email, plan === "days" ? `${days}д` : plan, admin.email, now(), now()).run();

  const tierName = PLANS[tier].title;
  await logAction(env, email, `Администратор выдал «${tierName}» на ${days} дн.`);
  await logAction(env, admin.email, `Выдал «${tierName}» (${days} дн.) пользователю ${email}`);

  const row = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
  return json(env, origin, { user: publicUser(row) });
}

/* POST /api/admin/revoke {email} — снять подписку немедленно. */
export async function revoke(request, env, origin, admin) {
  const b = await request.json().catch(() => ({}));
  const email = normEmail(b.email);
  const target = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
  if (!target) return fail(env, origin, "Пользователь не найден", 404);
  if (target.role !== "user") return fail(env, origin, "У администратора доступ бессрочный по роли", 400);

  await env.DB.prepare("UPDATE users SET plan = 'free', pro_until = NULL WHERE email = ?").bind(email).run();
  await logAction(env, email, "Администратор снял подписку «Про»");
  await logAction(env, admin.email, `Снял «Про» у ${email}`);
  const row = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
  return json(env, origin, { user: publicUser(row) });
}

/* POST /api/admin/reset-trial {email} — вернуть пробный запуск инструментов. */
export async function resetTrial(request, env, origin, admin) {
  const b = await request.json().catch(() => ({}));
  const email = normEmail(b.email);
  const target = await env.DB.prepare("SELECT email FROM users WHERE email = ?").bind(email).first();
  if (!target) return fail(env, origin, "Пользователь не найден", 404);

  await env.DB.prepare("UPDATE users SET tool_uses = 0 WHERE email = ?").bind(email).run();
  await env.DB.prepare("DELETE FROM usage WHERE email = ? AND kind = 'ai'").bind(email).run();
  await logAction(env, admin.email, `Сбросил лимиты пользователю ${email}`);
  const row = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
  return json(env, origin, { user: publicUser(row) });
}

/* DELETE /api/admin/user {email} */
export async function removeUser(request, env, origin, admin) {
  const b = await request.json().catch(() => ({}));
  const email = normEmail(b.email);
  if (email === admin.email) return fail(env, origin, "Нельзя удалить самого себя", 400);

  const target = await env.DB.prepare("SELECT role FROM users WHERE email = ?").bind(email).first();
  if (!target) return fail(env, origin, "Пользователь не найден", 404);
  if (target.role !== "user") return fail(env, origin, "Сначала снимите права администратора", 400);

  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE email = ?").bind(email),
    env.DB.prepare("DELETE FROM usage    WHERE email = ?").bind(email),
    env.DB.prepare("DELETE FROM actions  WHERE email = ?").bind(email),
    env.DB.prepare("DELETE FROM users    WHERE email = ?").bind(email),
  ]);
  await logAction(env, admin.email, `Удалил пользователя ${email}`);
  return json(env, origin, { ok: true });
}

/* GET /api/admin/payments — последние операции, включая ручные выдачи. */
export async function payments(request, env, origin) {
  const rows = await env.DB.prepare(
    `SELECT id, email, amount, plan, source, status, granted_by, created_at, completed_at
       FROM payments ORDER BY created_at DESC LIMIT 200`
  ).all();
  return json(env, origin, { payments: rows.results || [] });
}

/* GET /api/admin/user?email= — карточка одного пользователя с журналом. */
export async function userCard(request, env, origin) {
  const email = normEmail(new URL(request.url).searchParams.get("email"));
  const row = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
  if (!row) return fail(env, origin, "Пользователь не найден", 404);

  const actions = await env.DB.prepare(
    "SELECT text, at FROM actions WHERE email = ? ORDER BY at DESC LIMIT 50"
  ).bind(email).all();
  const pays = await env.DB.prepare(
    "SELECT id, amount, plan, source, status, granted_by, created_at FROM payments WHERE email = ? ORDER BY created_at DESC"
  ).bind(email).all();

  return json(env, origin, {
    user: { ...publicUser(row), pro: isPro(row), lastLoginAt: row.last_login_at },
    actions: actions.results || [],
    payments: pays.results || [],
  });
}

/* POST /api/admin/set-role {email, role:'admin'|'user'}
   Доступно ТОЛЬКО владельцу. Владельцев назначает переменная OWNER_EMAILS —
   через сайт получить или отобрать статус владельца нельзя. */
export async function setRole(request, env, origin, owner) {
  const b = await request.json().catch(() => ({}));
  const email = normEmail(b.email);
  const role = b.role === "admin" ? "admin" : "user";

  if (ownerEmails(env).includes(email))
    return fail(env, origin, "Роль владельца меняется только в настройках воркера", 400);
  if (email === owner.email)
    return fail(env, origin, "Нельзя менять собственную роль", 400);

  const target = await env.DB.prepare("SELECT email, role FROM users WHERE email = ?").bind(email).first();
  if (!target) return fail(env, origin, "Пользователь не найден", 404);

  if (role === "user" && adminEmails(env).includes(email))
    return fail(env, origin, "Этот админ задан в переменной ADMIN_EMAILS — уберите его оттуда", 400);

  await env.DB.prepare("UPDATE users SET role = ? WHERE email = ?").bind(role, email).run();
  /* Смена роли обнуляет чужие сессии: новые права должны примениться сразу. */
  await env.DB.prepare("DELETE FROM sessions WHERE email = ?").bind(email).run();

  await logAction(env, owner.email, role === "admin" ? `Выдал админку ${email}` : `Снял админку с ${email}`);
  await logAction(env, email, role === "admin" ? "Выданы права администратора" : "Сняты права администратора");

  const row = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
  return json(env, origin, { user: publicUser(row) });
}

/* POST /api/admin/reset-password {email}
   Пока к сервису не подключена почта, восстановить доступ можно только так:
   администратор выдаёт временный пароль и передаёт его человеку лично.
   Пароль показывается один раз и в базе лежит только его хэш. */
export async function resetPassword(request, env, origin, admin) {
  const b = await request.json().catch(() => ({}));
  const email = normEmail(b.email);

  const target = await env.DB.prepare("SELECT email, role FROM users WHERE email = ?").bind(email).first();
  if (!target) return fail(env, origin, "Пользователь не найден", 404);
  if (target.role === "owner" && admin.role !== "owner")
    return fail(env, origin, "Пароль владельца может сбросить только он сам", 403);

  /* Читаемый временный пароль: его придётся продиктовать голосом или в мессенджере.
     Символы, которые легко перепутать (0/O, 1/l/I), исключены. */
  const abc = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const temp = "pf-" + [...bytes].map(n => abc[n % abc.length]).join("");

  await env.DB.prepare("UPDATE users SET pass_hash = ? WHERE email = ?")
    .bind(await hashPassword(temp), email).run();
  /* Все сессии закрываем: если аккаунт увели, чужой доступ обрывается сразу. */
  await env.DB.prepare("DELETE FROM sessions WHERE email = ?").bind(email).run();

  await logAction(env, email, "Администратор сбросил пароль");
  await logAction(env, admin.email, `Сбросил пароль пользователю ${email}`);
  return json(env, origin, { ok: true, tempPassword: temp });
}

/* POST /api/admin/run-reminders — прогнать рассылку немедленно.
   Обычно её запускает крон раз в час; ручной запуск нужен, чтобы проверить
   настройку и чтобы не ждать час после правки сроков. */
export async function runRemindersNow(request, env, origin, admin) {
  const r = await runReminders(env);
  await logAction(env, admin.email, `Ручной прогон напоминаний: отправлено ${r.sent}`);
  return json(env, origin, r);
}
