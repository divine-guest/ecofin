/* ПравоФин — регистрация, вход, сессии, профиль. */
import {
  CFG, json, fail, hashPassword, verifyPassword, newSessionToken, sha256,
  bearer, now, normEmail, validEmail, publicUser, normalizeAvatar,
} from "./lib.js";
import { attachReferral } from "./referral.js";

/* Три уровня доступа:
     owner — задан в OWNER_EMAILS, может выдавать и снимать админку через сайт;
     admin — из ADMIN_EMAILS либо выдан владельцем, управляет пользователями;
     user  — все остальные.
   Порядок регистрации ни на что не влияет. Роль пересчитывается при каждом входе,
   но админка, выданная владельцем через сайт, при этом сохраняется. */
export function ownerEmails(env) {
  return (env.OWNER_EMAILS || "").split(",").map(normEmail).filter(Boolean);
}
export function adminEmails(env) {
  return (env.ADMIN_EMAILS || "").split(",").map(normEmail).filter(Boolean);
}

/* dbRole — что записано в базе; из окружения роль можно только повысить. */
export function roleFor(env, email, dbRole = "user") {
  if (ownerEmails(env).includes(email)) return "owner";
  if (adminEmails(env).includes(email)) return "admin";
  return dbRole === "owner" ? "admin" : dbRole; // владельцем делает только окружение
}

export async function logAction(env, email, text) {
  await env.DB.prepare("INSERT INTO actions (email, text, at) VALUES (?, ?, ?)")
    .bind(email, String(text).slice(0, 300), now()).run();
}

/* Возвращает строку пользователя по Bearer-токену либо null. */
export async function currentUser(request, env) {
  const raw = bearer(request);
  if (!raw) return null;
  const row = await env.DB.prepare(
    `SELECT u.* FROM sessions s JOIN users u ON u.email = s.email
     WHERE s.token = ? AND s.expires_at > ?`
  ).bind(await sha256(raw), now()).first();
  return row || null;
}

async function issueSession(env, email) {
  const raw = newSessionToken();
  const expires = now() + CFG.SESSION_DAYS * 86400000;
  await env.DB.prepare("INSERT INTO sessions (token, email, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256(raw), email, now(), expires).run();
  return { token: raw, expiresAt: expires };
}

export async function register(request, env, origin) {
  const b = await request.json().catch(() => ({}));
  const email = normEmail(b.email);
  const name = String(b.name || "").trim().slice(0, 80);
  const password = String(b.password || "");

  if (name.length < 2) return fail(env, origin, "Укажите имя (минимум 2 символа)");
  if (!validEmail(email)) return fail(env, origin, "Некорректный email");
  if (password.length < 8) return fail(env, origin, "Пароль минимум 8 символов");

  const exists = await env.DB.prepare("SELECT email FROM users WHERE email = ?").bind(email).first();
  if (exists) return fail(env, origin, "Аккаунт с таким email уже зарегистрирован", 409);

  const role = roleFor(env, email);
  await env.DB.prepare(
    `INSERT INTO users (email, name, pass_hash, role, plan, pro_until, created_at, last_login_at)
     VALUES (?, ?, ?, ?, 'free', NULL, ?, ?)`
  ).bind(email, name, await hashPassword(password), role, now(), now()).run();

  await logAction(env, email, role === "user" ? "Регистрация аккаунта" : `Регистрация (${role})`);
  /* Реферальный код привязываем один раз, здесь. Награда начислится позже,
     когда человек реально воспользуется сервисом. */
  if (b.ref) await attachReferral(env, email, b.ref).catch(() => {});
  const session = await issueSession(env, email);
  const row = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
  return json(env, origin, { ...session, user: publicUser(row) }, 201);
}

export async function login(request, env, origin) {
  const b = await request.json().catch(() => ({}));
  const email = normEmail(b.email);
  const password = String(b.password || "");

  const row = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
  /* Одинаковый ответ на «нет такого» и «неверный пароль» — не даём перебирать,
     какие адреса зарегистрированы. Хэш считаем всегда, чтобы не отличались тайминги. */
  const ok = row
    ? await verifyPassword(password, row.pass_hash)
    : await verifyPassword(password, "100000:AAAAAAAAAAAAAAAAAAAAAA==:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=");
  if (!row || !ok) return fail(env, origin, "Неверный email или пароль", 401);

  /* Роль подтягиваем заново: список владельцев мог измениться,
     а выданная через сайт админка живёт в базе и должна пережить вход. */
  const role = roleFor(env, email, row.role);
  await env.DB.prepare("UPDATE users SET last_login_at = ?, role = ? WHERE email = ?")
    .bind(now(), role, email).run();
  await logAction(env, email, "Вход в аккаунт");

  const session = await issueSession(env, email);
  return json(env, origin, { ...session, user: publicUser({ ...row, role }) });
}

export async function me(request, env, origin, user) {
  const actions = await env.DB.prepare(
    "SELECT text, at FROM actions WHERE email = ? ORDER BY at DESC LIMIT 30"
  ).bind(user.email).all();
  const pays = await env.DB.prepare(
    "SELECT id, amount, plan, source, status, created_at FROM payments WHERE email = ? AND status = 'succeeded' ORDER BY created_at DESC"
  ).bind(user.email).all();
  return json(env, origin, {
    user: publicUser(user),
    actions: actions.results || [],
    payments: pays.results || [],
  });
}

export async function logout(request, env, origin) {
  const raw = bearer(request);
  if (raw) await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(await sha256(raw)).run();
  return json(env, origin, { ok: true });
}

export async function updateProfile(request, env, origin, user) {
  const b = await request.json().catch(() => ({}));
  const name = String(b.name ?? user.name).trim().slice(0, 80);
  const avatar = normalizeAvatar(b.avatar, user.avatar || "");
  if (name.length < 2) return fail(env, origin, "Имя слишком короткое");
  if (avatar === null)
    return fail(env, origin, "Фото не подошло: нужен JPEG, PNG или WebP до 45 КБ после сжатия");
  await env.DB.prepare("UPDATE users SET name = ?, avatar = ? WHERE email = ?")
    .bind(name, avatar, user.email).run();
  await logAction(env, user.email, "Обновлён профиль");
  const row = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(user.email).first();
  return json(env, origin, { user: publicUser(row) });
}

export async function changePassword(request, env, origin, user) {
  const b = await request.json().catch(() => ({}));
  if (!(await verifyPassword(String(b.oldPassword || ""), user.pass_hash)))
    return fail(env, origin, "Текущий пароль неверен", 403);
  const next = String(b.newPassword || "");
  if (next.length < 8) return fail(env, origin, "Новый пароль минимум 8 символов");

  await env.DB.prepare("UPDATE users SET pass_hash = ? WHERE email = ?")
    .bind(await hashPassword(next), user.email).run();
  /* Смена пароля выкидывает все прочие сессии — на случай, если аккаунт увели. */
  const keep = await sha256(bearer(request));
  await env.DB.prepare("DELETE FROM sessions WHERE email = ? AND token != ?").bind(user.email, keep).run();
  await logAction(env, user.email, "Изменён пароль");
  return json(env, origin, { ok: true });
}

export async function deleteAccount(request, env, origin, user) {
  if (user.role === "admin") return fail(env, origin, "Аккаунт администратора нельзя удалить из кабинета", 403);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE email = ?").bind(user.email),
    env.DB.prepare("DELETE FROM usage    WHERE email = ?").bind(user.email),
    env.DB.prepare("DELETE FROM actions  WHERE email = ?").bind(user.email),
    env.DB.prepare("DELETE FROM users    WHERE email = ?").bind(user.email),
  ]);
  return json(env, origin, { ok: true });
}

/* GET /api/auth/sessions — «мои устройства». Сам токен не показываем,
   только когда сессия создана и какая из них текущая. */
export async function listSessions(request, env, origin, user) {
  const current = await sha256(bearer(request));
  const rows = await env.DB.prepare(
    "SELECT token, created_at, expires_at FROM sessions WHERE email = ? ORDER BY created_at DESC"
  ).bind(user.email).all();
  return json(env, origin, {
    sessions: (rows.results || []).map(r => ({
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      current: r.token === current,
    })),
  });
}

/* POST /api/auth/logout-all — выйти на всех устройствах, кроме текущего.
   Нужно, если человек забыл разлогиниться на чужом компьютере. */
export async function logoutEverywhere(request, env, origin, user) {
  const keep = await sha256(bearer(request));
  const r = await env.DB.prepare("DELETE FROM sessions WHERE email = ? AND token != ?")
    .bind(user.email, keep).run();
  await logAction(env, user.email, "Выход на всех остальных устройствах");
  return json(env, origin, { ok: true, closed: r.meta?.changes ?? 0 });
}
