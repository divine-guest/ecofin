/* ЭкоФин — серверный учёт лимитов. Клиент ни на что здесь не влияет. */
import { CFG, mskDay, isPro, now } from "./lib.js";
import { limitOf, tierOf } from "./plans.js";

async function bump(env, email, kind, day) {
  await env.DB.prepare(
    `INSERT INTO usage (email, day, kind, n) VALUES (?, ?, ?, 1)
     ON CONFLICT(email, day, kind) DO UPDATE SET n = n + 1`
  ).bind(email, day, kind).run();
}

async function used(env, email, kind, day) {
  const r = await env.DB.prepare("SELECT n FROM usage WHERE email = ? AND day = ? AND kind = ?")
    .bind(email, day, kind).first();
  return r ? r.n : 0;
}

/* Сколько сообщений ИИ-консультанту осталось сегодня. */
export async function aiQuota(env, user) {
  const day = mskDay();
  const limit = limitOf(user, "aiPerDay");
  const spent = await used(env, user.email, "ai", day);
  return { limit, spent, left: Math.max(0, limit - spent), pro: isPro(user), tier: tierOf(user) };
}

/* Разборы документов на Базовом считаются за календарный месяц:
   «20 в месяц» понятнее и щедрее, чем дробление по дням. */
export async function analyzeQuota(env, user) {
  const limit = limitOf(user, "analyzePerMonth");
  if (limit === null) return { limit: null, left: null, unlimited: true };
  const month = mskDay().slice(0, 7);
  const r = await env.DB.prepare(
    "SELECT COALESCE(SUM(n), 0) AS n FROM usage WHERE email = ? AND kind = 'analyze' AND day LIKE ?"
  ).bind(user.email, month + "%").first();
  const spent = r ? r.n : 0;
  return { limit, spent, left: Math.max(0, limit - spent), unlimited: false };
}

export async function spendAnalyze(env, user) {
  const q = await analyzeQuota(env, user);
  if (!q.unlimited && q.left <= 0) return null;
  await bump(env, user.email, "analyze", mskDay());
  return q;
}

/* Пробные запуски ИИ-инструментов и калькуляторов: счётчик на весь срок жизни
   аккаунта, а не на день — иначе «пробная функция» превращается в безлимит. */
export function toolQuota(user) {
  const limit = limitOf(user, "toolUses");
  if (limit === null) return { limit: Infinity, spent: user.tool_uses || 0, left: Infinity, pro: true };
  const spent = user.tool_uses || 0;
  return { limit, spent, left: Math.max(0, limit - spent), pro: false };
}

/* Списывает одно обращение к ИИ. Возвращает null, если лимит исчерпан. */
export async function spendAI(env, user) {
  const q = await aiQuota(env, user);
  if (q.left <= 0) return null;
  await bump(env, user.email, "ai", mskDay());
  return { ...q, left: q.left - 1, spent: q.spent + 1 };
}

/* Списывает один запуск инструмента/калькулятора. */
export async function spendTool(env, user) {
  const q = toolQuota(user);
  if (q.left <= 0) return null;
  if (!q.pro) {
    await env.DB.prepare("UPDATE users SET tool_uses = tool_uses + 1 WHERE email = ?").bind(user.email).run();
  }
  await bump(env, user.email, "tool", mskDay());
  return { ...q, left: q.left === Infinity ? Infinity : q.left - 1, spent: q.spent + 1 };
}

/* ---------- Возврат списанного ----------

   Лимит списывается ДО обращения к провайдеру: иначе человек мог бы
   запускать разбор параллельно в десяти вкладках и уложиться в один
   пробный запуск. Но если провайдер не ответил, получается несправедливо:
   ответа нет, а попытка сгорела. У бесплатного тарифа она вообще одна —
   и первое знакомство с сервисом заканчивается словами «пробный запуск
   израсходован» после того, как он ничего не показал.

   Поэтому при сбое возвращаем списанное обратно. Ниже нуля не уходим:
   счётчик мог обнулиться сменой суток между списанием и возвратом. */

async function unbump(env, email, kind, day) {
  await env.DB.prepare(
    "UPDATE usage SET n = MAX(0, n - 1) WHERE email = ? AND day = ? AND kind = ?"
  ).bind(email, day, kind).run().catch(() => {});
}

export async function refundAI(env, user) {
  await unbump(env, user.email, "ai", mskDay());
}

export async function refundAnalyze(env, user) {
  await unbump(env, user.email, "analyze", mskDay());
}

export async function refundTool(env, user) {
  await unbump(env, user.email, "tool", mskDay());
  /* Пробные запуски считаются за всю жизнь аккаунта, отдельным полем. */
  await env.DB.prepare(
    "UPDATE users SET tool_uses = MAX(0, tool_uses - 1) WHERE email = ?"
  ).bind(user.email).run().catch(() => {});
}

/* Подписка: продлеваем от текущей даты окончания, если она ещё не прошла. */
export function extendUntil(current, days) {
  const base = current && current > now() ? current : now();
  return base + days * 86400000;
}
