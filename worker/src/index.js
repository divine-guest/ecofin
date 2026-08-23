/* ПравоФин — единая точка входа API.
   Все проверки прав и лимитов живут здесь и в модулях, а не в браузере:
   клиент может врать о своём плане сколько угодно — это ни на что не влияет. */
import { json, fail, corsHeaders, allowedOrigins, now } from "./lib.js";
import * as auth from "./auth.js";
import * as ai from "./ai.js";
import * as admin from "./admin.js";
import * as billing from "./billing.js";

/* Маршруты: [метод, путь, обработчик, доступ] */
const ROUTES = [
  ["POST", "/api/auth/register", auth.register, "public"],
  ["POST", "/api/auth/login", auth.login, "public"],
  ["POST", "/api/auth/logout", auth.logout, "public"],
  ["GET", "/api/auth/me", auth.me, "user"],
  ["POST", "/api/auth/profile", auth.updateProfile, "user"],
  ["POST", "/api/auth/password", auth.changePassword, "user"],
  ["POST", "/api/auth/delete", auth.deleteAccount, "user"],

  ["POST", "/api/ai", ai.handleAI, "user"],
  ["POST", "/api/analyze", ai.handleAnalyze, "user"],
  ["GET", "/api/quota", ai.handleQuota, "user"],

  ["POST", "/api/billing/create", billing.createPayment, "user"],
  ["POST", "/api/billing/check", billing.check, "user"],
  ["POST", "/api/billing/promo", billing.promo, "user"],
  ["POST", "/api/billing/webhook", billing.webhook, "webhook"],

  ["GET", "/api/admin/users", admin.listUsers, "admin"],
  ["GET", "/api/admin/user", admin.userCard, "admin"],
  ["GET", "/api/admin/stats", admin.stats, "admin"],
  ["GET", "/api/admin/payments", admin.payments, "admin"],
  ["POST", "/api/admin/grant", admin.grant, "admin"],
  ["POST", "/api/admin/revoke", admin.revoke, "admin"],
  ["POST", "/api/admin/reset-trial", admin.resetTrial, "admin"],
  ["POST", "/api/admin/delete-user", admin.removeUser, "admin"],
  ["POST", "/api/admin/set-role", admin.setRole, "owner"],
];

/* Раз в сотню запросов подчищаем протухшие сессии — отдельный крон ради этого
   держать не стоит, а таблица иначе растёт вечно. */
async function maybeSweep(env, ctx) {
  if (Math.random() > 0.01) return;
  ctx.waitUntil(env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now()).run().catch(() => {}));
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers: corsHeaders(env, origin) });

    if (path === "/api/health" || path === "/") {
      return json(env, origin, {
        ok: true,
        service: "pravofin-api",
        model: env.AI_MODEL || "deepseek-chat",
        aiKey: Boolean(env.AI_API_KEY),
        db: Boolean(env.DB),
        billing: Boolean(env.YOOKASSA_SHOP_ID && env.YOOKASSA_SECRET_KEY),
        owners: auth.ownerEmails(env).length,
        admins: auth.adminEmails(env).length,
      });
    }

    if (path === "/api/billing/plans") return billing.plans(env, origin);

    const route = ROUTES.find(([m, p]) => p === path && m === request.method);
    if (!route) return fail(env, origin, "Метод не найден", 404);
    const [, , handler, access] = route;

    /* Вебхук приходит от ЮKassa, без Origin и без токена — его пропускаем сюда,
       но внутри он всё равно перепроверяет платёж запросом к API ЮKassa. */
    if (access === "webhook") {
      if (!env.DB) return fail(env, origin, "База не подключена", 500);
      return handler(request, env, origin);
    }

    /* Браузерные запросы: чужому домену отказываем до всякой работы. */
    if (origin && !allowedOrigins(env).includes(origin))
      return fail(env, origin, "Origin не разрешён", 403);

    if (!env.DB) return fail(env, origin, "База не подключена: добавьте binding DB", 500);

    if (access === "public") return handler(request, env, origin);

    const user = await auth.currentUser(request, env);
    if (!user) return fail(env, origin, "Требуется вход", 401);

    if (access === "admin" && user.role !== "admin" && user.role !== "owner")
      return fail(env, origin, "Недостаточно прав", 403);
    if (access === "owner" && user.role !== "owner")
      return fail(env, origin, "Действие доступно только владельцу сервиса", 403);

    await maybeSweep(env, ctx);
    return handler(request, env, origin, user);
  },
};
