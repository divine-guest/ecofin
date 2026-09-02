/* ЭкоФин — общие утилиты воркера: CORS, ответы, крипта, лимиты. */

/* Аватар-картинка хранится прямо в базе как data-URL: файл после сжатия
   до 160 px весит единицы килобайт, ради этого отдельное хранилище не нужно. */
export const MAX_AVATAR_BYTES = 60000;

/* Пустой аватар, короткий emoji или картинка — всё остальное отбрасываем. */
export function normalizeAvatar(value, fallback = "") {
  const v = String(value ?? fallback);
  if (!v) return "";
  if (v.startsWith("data:image/")) {
    const okType = /^data:image\/(jpeg|png|webp);base64,/.test(v);
    if (!okType || v.length > MAX_AVATAR_BYTES) return null;   // null = ошибка
    return v;
  }
  return v.slice(0, 8);   // emoji или буква
}

import { tierOf, planOf, isPaid, hasFeature } from "./plans.js";
export { tierOf, planOf, isPaid, hasFeature };

export const CFG = {
  /* Числа лимитов переехали в plans.js — там они привязаны к тарифу.
     Здесь остались только общие настройки. */
  SESSION_DAYS: 30,
  PBKDF2_ITER: 100000,
};

/* Домены, которым разрешено обращаться к API. Задаётся переменной ALLOWED_ORIGINS
   (через запятую) — чтобы при переезде на домен не пересобирать воркер. */
export function allowedOrigins(env) {
  const raw = env.ALLOWED_ORIGINS || "https://divine-guest.github.io";
  return raw.split(",").map(s => s.trim()).filter(Boolean);
}

/* Запрос со своей же страницы.
 *
 * На своём сервере nginx отдаёт и страницы, и API с одного адреса. Такой
 * запрос никакого разрешения не требует: это сайт обращается сам к себе,
 * и заперать его от самого себя бессмысленно. Сравниваем по имени хоста —
 * так работает и по http, и по https, и после смены адреса или переезда
 * на домен список менять не придётся.
 *
 * Без этого на новом сервере нельзя было войти: страницы открывались,
 * а вход возвращал «Origin не разрешён», потому что в списке значился
 * только адрес GitHub Pages. */
export function isSameOrigin(request, origin) {
  if (!origin) return true;
  let from;
  try { from = new URL(origin).hostname; } catch { return false; }
  if (!from) return false;

  /* Своё имя ищем в трёх местах, потому что до кода оно доходит
     по-разному. За nginx настоящее имя приходит в заголовках, а адрес
     запроса к тому моменту уже внутренний — 127.0.0.1. Сравниваем без
     порта: браузер в Origin порт не пишет, а в заголовке он может быть. */
  const candidates = [
    request.headers.get("X-Forwarded-Host"),
    request.headers.get("Host"),
  ];
  try { candidates.push(new URL(request.url).host); } catch { /* адрес битый */ }

  return candidates.some(h => h && String(h).split(":")[0].trim() === from);
}

export function corsHeaders(env, origin) {
  const list = allowedOrigins(env);
  const allow = list.includes(origin) ? origin : list[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  };
}

export const json = (env, origin, body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders(env, origin) });

export const fail = (env, origin, message, status = 400) =>
  json(env, origin, { error: message }, status);

/* ---------- Пароли: PBKDF2-SHA256, соль на пользователя ---------- */
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await pbkdf2(password, salt, CFG.PBKDF2_ITER);
  return `${CFG.PBKDF2_ITER}:${b64(salt)}:${b64(bits)}`;
}

export async function verifyPassword(password, stored) {
  try {
    const [iterStr, saltB64, hashB64] = String(stored).split(":");
    const bits = await pbkdf2(password, unb64(saltB64), Number(iterStr));
    return timingSafeEqual(new Uint8Array(bits), unb64(hashB64));
  } catch { return false; }
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/* ---------- Сессии ---------- */
/* Клиенту отдаём случайный токен, в базе держим только его SHA-256:
   утечка дампа базы не даёт войти под чужим аккаунтом. */
export function newSessionToken() {
  return b64(crypto.getRandomValues(new Uint8Array(32))).replace(/[+/=]/g, c => ({ "+": "-", "/": "_", "=": "" }[c]));
}

export async function sha256(text) {
  return b64(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

export function bearer(request) {
  const h = request.headers.get("Authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : "";
}

/* ---------- Прочее ---------- */
export const now = () => Date.now();

/* День по московскому времени: сутки лимитов должны совпадать с ощущением пользователя */
export function mskDay(ts = Date.now()) {
  return new Date(ts + 3 * 3600000).toISOString().slice(0, 10);
}

export function normEmail(e) {
  return String(e || "").trim().toLowerCase();
}

export function validEmail(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 254;
}

/* Публичное представление пользователя: пароль и внутренние поля наружу не уходят */
export function publicUser(row) {
  if (!row) return null;
  const pro = isPro(row);
  return {
    email: row.email,
    name: row.name,
    avatar: row.avatar || "",
    role: row.role,
    isAdmin: row.role === "admin" || row.role === "owner",
    isOwner: row.role === "owner",
    tier: tierOf(row),
    planTitle: planOf(row).title,
    digestOff: Boolean(row.digest_off),
    features: planOf(row).features,
    themeAccent: row.theme_accent || "",
    points: row.points || 0,
    plan: tierOf(row),
    proUntil: row.pro_until || null,
    toolUses: row.tool_uses || 0,
    createdAt: row.created_at,
    /* Автопродление. canAutoRenew — есть ли вообще чем списывать:
       у тех, кому подписку выдали вручную или по промокоду, способа
       оплаты нет, и обещать им «отмену» было бы обманом. */
    autoRenew: Boolean(row.auto_method) && row.auto_renew !== 0,
    canAutoRenew: Boolean(row.auto_method),
  };
}

/* Оставлено под прежним смыслом «есть платная подписка», чтобы не
   переписывать разом все проверки. Уровень тарифа смотрят через tierOf. */
export function isPro(row) {
  return isPaid(row);
}
