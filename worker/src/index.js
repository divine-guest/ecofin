/* ЭкоФин — единая точка входа API.
   Все проверки прав и лимитов живут здесь и в модулях, а не в браузере:
   клиент может врать о своём плане сколько угодно — это ни на что не влияет. */
import { json, fail, corsHeaders, allowedOrigins, isSameOrigin, now } from "./lib.js";
import * as auth from "./auth.js";
import * as ai from "./ai.js";
import * as admin from "./admin.js";
import * as billing from "./billing.js";
import { checkLimits, checkOnly, sweep as sweepLimits } from "./ratelimit.js";
import * as referral from "./referral.js";
import * as reminders from "./reminders.js";
import * as aijobs from "./aijobs.js";
import * as qa from "./qa.js";
import * as saved from "./saved.js";
import * as progress from "./progress.js";
import * as summary from "./summary.js";
import { runDigest } from "./digest.js";
import * as points from "./points.js";
import * as courses from "./courses.js";
import * as telegram from "./telegram.js";
import * as book from "./book.js";
import * as registry from "./registry.js";
import * as clients from "./clients.js";
import * as requisites from "./requisites.js";

/* Маршруты: [метод, путь, обработчик, доступ] */
const ROUTES = [
  ["POST", "/api/auth/register", auth.register, "public"],
  ["POST", "/api/auth/login", auth.login, "public"],
  ["POST", "/api/auth/owner-recover", auth.ownerRecover, "public"],
  ["POST", "/api/auth/logout", auth.logout, "public"],
  ["GET", "/api/auth/me", auth.me, "user"],
  ["POST", "/api/auth/profile", auth.updateProfile, "user"],
  ["POST", "/api/auth/password", auth.changePassword, "user"],
  ["POST", "/api/auth/delete", auth.deleteAccount, "user"],
  ["GET", "/api/auth/sessions", auth.listSessions, "user"],
  ["POST", "/api/auth/logout-all", auth.logoutEverywhere, "user"],

  ["POST", "/api/ai", ai.handleAI, "user"],
  ["POST", "/api/analyze", ai.handleAnalyze, "user"],
  /* Распознать фото в текст — чтобы файл принимал любой инструмент,
     а не только разбор договора. */
  ["POST", "/api/ocr", ai.handleOcr, "user"],
  ["GET", "/api/quota", ai.handleQuota, "user"],
  ["GET", "/api/referral", referral.status, "user"],
  ["GET", "/api/points", points.status, "user"],
  ["GET", "/api/courses/lesson", courses.lesson, "user"],
  ["GET", "/api/themes", auth.listThemes, "user"],
  ["POST", "/api/themes", auth.setTheme, "user"],

  ["GET", "/api/reminders", reminders.list, "user"],
  ["POST", "/api/reminders", reminders.create, "user"],
  ["POST", "/api/reminders/update", reminders.update, "user"],
  ["POST", "/api/reminders/delete", reminders.remove, "user"],
  ["POST", "/api/reminders/preset", reminders.addPreset, "user"],
  /* Фоновые задачи ИИ: вопрос переживает переход на другую страницу. */
  /* Публичная лента: читают все, предлагают вошедшие, решает владелец. */
  /* Кабинет: сохранённые расчёты и история вопросов. */
  ["POST", "/api/digest", auth.setDigest, "user"],
  ["GET", "/api/saved", saved.list, "user"],
  ["POST", "/api/saved", saved.save, "user"],
  ["POST", "/api/saved/delete", saved.remove, "user"],
  ["GET", "/api/ai/history", saved.aiHistory, "user"],
  ["GET", "/api/notes", saved.notes, "user"],
  ["POST", "/api/notes", saved.saveNotes, "user"],
  ["GET", "/api/summary", summary.summary, "user"],
  ["GET", "/api/competencies", saved.comp, "user"],
  ["GET", "/api/progress", progress.getAll, "user"],
  ["POST", "/api/progress", progress.put, "user"],
  ["POST", "/api/progress/clear", progress.clear, "user"],
  ["POST", "/api/competencies", saved.saveComp, "user"],

  /* «Моё дело»: учёт выручки и трат. Всё под входом — это личные деньги. */
  ["GET", "/api/book", book.list, "user"],
  ["POST", "/api/book/op", book.addOp, "user"],
  ["POST", "/api/book/op/delete", book.removeOp, "user"],
  ["POST", "/api/book/profile", book.saveProfile, "user"],
  /* Чек с фотографии — сразу разобранными полями, а не текстом. */
  ["POST", "/api/book/scan", book.scanReceipt, "user"],
  ["GET", "/api/book/export", book.exportBook, "user"],

  /* Государственные реестры. Статус самозанятого — открытый сервис ФНС;
     выписка из ЕГРЮЛ работает, только если подключён платный ключ. */
  /* Несколько дел в одном кабинете: бухгалтеру и тем, у кого ИП и ООО. */
  ["GET", "/api/clients", clients.list, "user"],
  ["POST", "/api/clients", clients.save, "user"],
  ["POST", "/api/clients/delete", clients.remove, "user"],

  /* Реквизиты и контрагенты: один раз ввёл — работает во всех документах.

     Открыто всем тарифам намеренно. Это не отдельная возможность, за
     которую платят, а то, что делает пользуемой библиотеку документов:
     закрыть подстановку реквизитов — значит оставить бесплатному тарифу
     пятьдесят бумаг, которые каждый раз заполняются с нуля. */
  ["GET", "/api/requisites", requisites.getRequisites, "user"],
  ["POST", "/api/requisites", requisites.saveRequisites, "user"],
  ["GET", "/api/counterparties", requisites.listCounterparties, "user"],
  ["POST", "/api/counterparties", requisites.saveCounterparty, "user"],
  ["POST", "/api/counterparties/delete", requisites.removeCounterparty, "user"],
  ["POST", "/api/counterparties/touch", requisites.touchCounterparty, "user"],
  ["GET",  "/api/orgs", requisites.listOrgs, "user"],
  ["POST", "/api/orgs", requisites.saveOrg, "user"],
  ["POST", "/api/orgs/active", requisites.setActiveOrg, "user"],
  ["POST", "/api/orgs/archive", requisites.archiveOrg, "user"],
  ["POST", "/api/docnumber", requisites.nextNumber, "user"],

  ["POST", "/api/registry/npd", registry.npdStatus, "user"],
  ["POST", "/api/registry/company", registry.companyInfo, "user"],

  ["GET", "/api/qa", qa.list, "public"],
  ["GET", "/api/qa/one", qa.one, "public"],
  ["POST", "/api/qa/offer", qa.offer, "user"],
  ["POST", "/api/qa/useful", qa.useful, "user"],
  ["GET", "/api/admin/qa", qa.pending, "admin"],
  ["POST", "/api/admin/qa", qa.decide, "admin"],

  ["POST", "/api/ai/ask", aijobs.ask, "user"],
  ["GET", "/api/ai/job", aijobs.status, "user"],
  ["GET", "/api/ai/jobs", aijobs.list, "user"],

  ["GET", "/api/notifications", reminders.listNotifications, "user"],
  ["POST", "/api/notifications/read", reminders.markRead, "user"],
  ["POST", "/api/notifications/clear", reminders.clearNotifications, "user"],

  ["GET", "/api/telegram/status", telegram.status, "user"],
  ["POST", "/api/telegram/link", telegram.requestLink, "user"],
  ["POST", "/api/telegram/unlink", telegram.unlink, "user"],
  ["POST", "/api/telegram/webhook", telegram.webhook, "webhook"],

  ["POST", "/api/billing/create", billing.createPayment, "user"],
  ["POST", "/api/billing/check", billing.check, "user"],
  ["POST", "/api/billing/promo", billing.promo, "user"],
  /* Пробный «Про»: три дня без карты, один раз на аккаунт. */
  ["POST", "/api/billing/trial", billing.trial, "user"],
  ["GET", "/api/billing/trial", billing.trialStatus, "user"],
  ["GET", "/api/billing/subscription", billing.subscription, "user"],
  ["POST", "/api/billing/autorenew", billing.setAutoRenew, "user"],
  ["POST", "/api/billing/webhook", billing.webhook, "webhook"],

  ["GET", "/api/admin/users", admin.listUsers, "admin"],
  ["GET", "/api/admin/user", admin.userCard, "admin"],
  ["GET", "/api/admin/stats", admin.stats, "admin"],
  ["GET", "/api/admin/payments", admin.payments, "admin"],
  ["POST", "/api/admin/grant", admin.grant, "admin"],
  ["POST", "/api/admin/revoke", admin.revoke, "admin"],
  ["POST", "/api/admin/reset-trial", admin.resetTrial, "admin"],
  ["POST", "/api/admin/delete-user", admin.removeUser, "admin"],
  ["POST", "/api/admin/reset-password", admin.resetPassword, "admin"],
  ["POST", "/api/admin/run-reminders", admin.runRemindersNow, "admin"],
  ["POST", "/api/admin/points", points.adminAdjust, "admin"],
  ["POST", "/api/admin/set-role", admin.setRole, "owner"],
];

/* Раз в сотню запросов подчищаем протухшие сессии — отдельный крон ради этого
   держать не стоит, а таблица иначе растёт вечно. */
async function maybeSweep(env, ctx) {
  if (Math.random() > 0.01) return;
  ctx.waitUntil(env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now()).run().catch(() => {}));
  ctx.waitUntil(sweepLimits(env).catch(() => {}));
}

/* Какие публичные действия ограничиваем по частоте и по какому признаку.
   Без этого пароль перебирается без помех, а боты штампуют аккаунты
   и тратят бесплатные обращения к ИИ — то есть деньги владельца. */
const THROTTLED = {
  "/api/auth/login": "login",
  "/api/auth/register": "register",
  "/api/billing/promo": "promo",
  "/api/billing/trial": "promo",
  "/api/admin/reset-password": "reset",
  /* Аварийный ключ владельца. Без ограничения он подбирался со скоростью
     сотен попыток в секунду — а успех означает полный захват сервиса. */
  "/api/auth/owner-recover": "recover",
};

async function throttle(request, env, origin, path) {
  const action = THROTTLED[path];
  if (!action) return null;

  /* Ключ второго уровня достаём из тела, не ломая его для обработчика. */
  let key = "";
  if (action === "login" || action === "register" || action === "promo" || action === "recover") {
    const clone = request.clone();
    const body = await clone.json().catch(() => ({}));
    key = String(body.email || body.code || "").trim().toLowerCase().slice(0, 120);
  }

  /* Для входа только смотрим счётчик: списывать будет сам обработчик,
     и только если пароль не подошёл. */
  const retryAfter = action === "login"
    ? await checkOnly(env, request, action, key)
    : await checkLimits(env, request, action, key);
  if (retryAfter === null) return null;

  const minutes = Math.ceil(retryAfter / 60);
  const message = action === "login"
    ? `Слишком много попыток входа. Попробуйте через ${minutes} мин. Забыли пароль — напишите в поддержку`
    : action === "register"
      ? `С этого адреса уже создано много аккаунтов. Попробуйте через ${minutes} мин.`
      : action === "recover"
        ? `Слишком много попыток восстановления. Следующая через ${minutes} мин.`
        : `Слишком много попыток. Попробуйте через ${minutes} мин.`;

  const res = fail(env, origin, message, 429);
  res.headers.set("Retry-After", String(retryAfter));
  return res;
}

export default {
  /* Крон: раз в час проверяем, кому пора напомнить. Час, а не сутки, —
     потому что пользователи в разных часовых поясах, и «утро» у каждого своё. */
  async scheduled(event, env, ctx) {
    if (!env.DB) return;
    ctx.waitUntil(telegram.runReminders(env).catch(e => console.error("cron", e.message)));
    /* Сводка недели: сама решает, у кого сейчас утро понедельника. */
    ctx.waitUntil(runDigest(env, telegram.send).catch(e => console.error("digest", e.message)));
    /* Автопродление подписок. Сама себя выключает, пока эквайринг
       не подключён, — на пустых ключах не делает ни одного запроса. */
    ctx.waitUntil(billing.runRenewals(env).catch(e => console.error("renew", e.message)));
  },

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
        telegram: Boolean(env.TELEGRAM_BOT_TOKEN),
        owners: auth.ownerEmails(env).length,
        admins: auth.adminEmails(env).length,
      });
    }

    if (path === "/api/billing/plans") return billing.plans(env, origin);
    if (path === "/api/reminders/presets") return reminders.presets(env, origin);
    /* Публичный: приглашённый видит, кто его позвал, ещё до регистрации. */
    if (path === "/api/referral/check") {
      if (!env.DB) return fail(env, origin, "База не подключена", 500);
      /* Код выводится из почты, поэтому перебором можно проверять, кто
         зарегистрирован. Лимит делает такой перебор бессмысленным. */
      const wait = await checkLimits(env, request, "promo", "");
      if (wait !== null) return fail(env, origin, "Слишком много запросов", 429);
      return referral.preview(request, env, origin);
    }

    const route = ROUTES.find(([m, p]) => p === path && m === request.method);
    if (!route) return fail(env, origin, "Метод не найден", 404);
    const [, , handler, access] = route;

    /* Вебхук приходит от ЮKassa, без Origin и без токена — его пропускаем сюда,
       но внутри он всё равно перепроверяет платёж запросом к API ЮKassa. */
    if (access === "webhook") {
      if (!env.DB) return fail(env, origin, "База не подключена", 500);
      return handler(request, env, origin);
    }

    /* Браузерные запросы: чужому домену отказываем до всякой работы.
       Свой же адрес разрешён всегда — сайт обращается сам к себе. */
    if (origin && !allowedOrigins(env).includes(origin) && !isSameOrigin(request, origin))
      return fail(env, origin, "Origin не разрешён", 403);

    if (!env.DB) return fail(env, origin, "База не подключена: добавьте binding DB", 500);

    const throttled = await throttle(request, env, origin, path);
    if (throttled) return throttled;

    if (access === "public") return handler(request, env, origin, null, ctx);

    const user = await auth.currentUser(request, env);
    if (!user) return fail(env, origin, "Требуется вход", 401);

    if (access === "admin" && user.role !== "admin" && user.role !== "owner")
      return fail(env, origin, "Недостаточно прав", 403);
    if (access === "owner" && user.role !== "owner")
      return fail(env, origin, "Действие доступно только владельцу сервиса", 403);

    await maybeSweep(env, ctx);
    /* ctx нужен обработчикам, которые доделывают работу после ответа
       браузеру: так фоновая задача ИИ переживает уход со страницы. */
    return handler(request, env, origin, user, ctx);
  },
};
