/* ЭкоФин — Telegram-бот: привязка аккаунта, напоминания, вопросы к ИИ.

   Бот здесь не игрушка, а второй вход в сервис. В России его открывают чаще,
   чем почту, поэтому именно он делает напоминания по-настоящему работающими. */
import { json, fail, now, isPro, normEmail } from "./lib.js";
import { logAction } from "./auth.js";
import { notify, localDay, addDays, nextDue } from "./reminders.js";
import { aiQuota, spendAI, toolQuota, analyzeQuota } from "./quota.js";
import { PLANS, planOf, tierOf } from "./plans.js";
import { balanceOf } from "./points.js";
import { codeFor } from "./referral.js";

const TG = "https://api.telegram.org/bot";
const LINK_TTL = 15 * 60 * 1000;

export const configured = env => Boolean(env.TELEGRAM_BOT_TOKEN);

async function call(env, method, payload) {
  if (!configured(env)) return null;
  try {
    const r = await fetch(`${TG}${env.TELEGRAM_BOT_TOKEN}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
    const data = await r.json();
    if (!data.ok) console.error("telegram", method, JSON.stringify(data).slice(0, 300));
    return data;
  } catch (e) {
    console.error("telegram fetch", e.message);
    return null;
  }
}

export function send(env, chatId, text, extra = {}) {
  return call(env, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...extra,
  });
}

/* Экранирование для parse_mode: HTML — иначе название напоминания
   с угловой скобкой сломает сообщение целиком. */
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/* ---------- Привязка аккаунта ---------- */

/* POST /api/telegram/link — кабинет просит одноразовый код. */
export async function requestLink(request, env, origin, user) {
  if (!configured(env)) return fail(env, origin, "Бот пока не подключён", 503);

  await env.DB.prepare("DELETE FROM tg_link_codes WHERE email = ? OR expires_at < ?")
    .bind(user.email, now()).run();

  /* Короткий код: его вводят руками на телефоне. Похожие символы исключены. */
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const code = [...bytes].map(n => abc[n % abc.length]).join("");

  await env.DB.prepare("INSERT INTO tg_link_codes (code, email, expires_at) VALUES (?, ?, ?)")
    .bind(code, user.email, now() + LINK_TTL).run();

  return json(env, origin, {
    code,
    bot: env.TELEGRAM_BOT_USERNAME || "PravofinAI_bot",
    deepLink: `https://t.me/${env.TELEGRAM_BOT_USERNAME || "PravofinAI_bot"}?start=${code}`,
    expiresIn: Math.round(LINK_TTL / 60000),
  });
}

export async function unlink(request, env, origin, user) {
  await env.DB.prepare("UPDATE users SET tg_chat_id = NULL, tg_username = NULL, tg_linked_at = NULL WHERE email = ?")
    .bind(user.email).run();
  /* Напоминания не удаляем, а переводим на сайт: человек не должен их терять. */
  await env.DB.prepare("UPDATE reminders SET channel = 'site' WHERE email = ?").bind(user.email).run();
  await logAction(env, user.email, "Telegram отключён");
  return json(env, origin, { ok: true });
}

export async function status(request, env, origin, user) {
  return json(env, origin, {
    enabled: configured(env),
    linked: Boolean(user.tg_chat_id),
    username: user.tg_username || null,
    linkedAt: user.tg_linked_at || null,
    bot: env.TELEGRAM_BOT_USERNAME || "PravofinAI_bot",
  });
}

/* ---------- Вебхук ---------- */


/* Короткие советы: повод открыть бота, когда сроков нет.
   Меняются раз в сутки и одинаковы у всех — списка на месяц хватает,
   чтобы не повторяться слишком быстро. */
export const TIPS = [
  "Взносы ИП за себя начисляются, даже если дохода не было совсем. Нулевой год — не повод не платить.",
  "На УСН «Доходы» без работников взносы уменьшают налог полностью — вплоть до нуля. С работниками — не более чем наполовину.",
  "Не пишите «в том числе НДС» в счёте, если вы на УСН без НДС: этот НДС придётся заплатить в бюджет.",
  "Проверяйте статус самозанятого перед каждой оплатой и берите чек. Без чека расход не подтверждён.",
  "Нельзя два года после увольнения оформлять бывшего работника как самозанятого на те же работы — это прямое основание для доначислений.",
  "Отпускные выплачивают не позднее чем за три дня до отпуска. Нарушение — повод перенести отпуск по заявлению.",
  "Патент считается не от выручки, а от потенциального дохода, который установил регион. Проверить свою цифру: patent.nalog.ru",
  "Требование из налоговой нельзя игнорировать: письменное пояснение с расчётом часто снимает вопрос без последствий.",
  "Неустойка выше 10–15% суммы долга обычно снижается судом по ст. 333 ГК РФ.",
  "Закрыли ИП — не забудьте декларацию и взносы. Штрафы придут уже физлицу.",
  "Больничный за первые три дня платит работодатель, дальше — СФР. Пособие облагается НДФЛ.",
  "По искам о защите прав потребителей до 1 млн ₽ госпошлина не платится.",
  "Договор с самозанятым переквалифицируют в трудовой, если оплата фиксированная и ежемесячная. Платите за результат по акту.",
  "Документы храните минимум четыре года: налоговая может проверить и после закрытия бизнеса.",
  "Сверяйте расчётный счёт контрагента с выпиской ЕГРЮЛ перед первой оплатой — реквизиты в письме могут быть подменены.",
];

const HELP = `Я помогу не пропустить сроки и отвечу на вопросы по финансам, налогам и праву.

<b>Сроки</b>
/sroki — ближайшие напоминания
/dobavit — добавить напоминание

<b>Подписка</b>
/podpiska — что у вас сейчас и до какого числа
/kupit — оформить или продлить
/promo КОД — активировать промокод

<b>Профиль</b>
/profil — тариф, лимиты, баллы
/bally — баланс и как его пополнить
/pozvat — позвать друга и получить баллы
/imya Новое Имя — сменить имя

<b>Прочее</b>
/svodka — что у вас на этой неделе
/sovet — короткий совет по делу
/stop — отключить уведомления
/help — эта справка

Или просто напишите вопрос — отвечу как консультант на сайте.`;

export async function webhook(request, env, origin) {
  /* Telegram шлёт секрет в заголовке — иначе вебхук может дёрнуть кто угодно. */
  if (env.TELEGRAM_WEBHOOK_SECRET &&
      request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.TELEGRAM_WEBHOOK_SECRET) {
    return json(env, origin, { ok: true });   // молча игнорируем чужие запросы
  }

  const update = await request.json().catch(() => ({}));
  const msg = update.message || update.edited_message;
  if (!msg || !msg.chat) return json(env, origin, { ok: true });

  const chatId = String(msg.chat.id);
  const text = String(msg.text || "").trim();
  const username = msg.from?.username || "";

  try {
    await handle(env, chatId, text, username);
  } catch (e) {
    console.error("tg handle", e.message);
    await send(env, chatId, "Что-то пошло не так. Попробуйте ещё раз чуть позже.");
  }
  return json(env, origin, { ok: true });
}

async function userByChat(env, chatId) {
  return env.DB.prepare("SELECT * FROM users WHERE tg_chat_id = ?").bind(chatId).first();
}

async function handle(env, chatId, text, username) {
  /* /start CODE — привязка */
  if (text.startsWith("/start")) {
    const code = text.split(/\s+/)[1]?.trim().toUpperCase();
    if (!code) {
      const existing = await userByChat(env, chatId);
      return send(env, chatId, existing
        ? `С возвращением, ${esc(existing.name)}! Аккаунт уже привязан.\n\n${HELP}`
        : `Здравствуйте! Это бот сервиса <b>ЭкоФин</b>.\n\nЧтобы получать напоминания о сроках, привяжите аккаунт: зайдите в личный кабинет на сайте, откройте «Настройки → Уведомления» и нажмите «Подключить Telegram».\n\n${HELP}`);
    }

    const row = await env.DB.prepare("SELECT email, expires_at FROM tg_link_codes WHERE code = ?")
      .bind(code).first();
    if (!row || row.expires_at < now()) {
      return send(env, chatId, "Код не найден или истёк. Получите новый в кабинете на сайте — он действует 15 минут.");
    }

    /* Один Telegram — один аккаунт: иначе напоминания смешаются. */
    await env.DB.prepare("UPDATE users SET tg_chat_id = NULL WHERE tg_chat_id = ?").bind(chatId).run();
    await env.DB.prepare("UPDATE users SET tg_chat_id = ?, tg_username = ?, tg_linked_at = ? WHERE email = ?")
      .bind(chatId, username, now(), row.email).run();
    await env.DB.prepare("DELETE FROM tg_link_codes WHERE code = ?").bind(code).run();
    await logAction(env, row.email, "Подключён Telegram");

    const u = await env.DB.prepare("SELECT name FROM users WHERE email = ?").bind(row.email).first();
    return send(env, chatId,
      `Готово, ${esc(u?.name || "")}! Аккаунт привязан.\n\nТеперь я напомню о сроках заранее — по умолчанию за 3 дня, за день и в сам день.\n\n${HELP}`);
  }

  const user = await userByChat(env, chatId);
  if (!user) {
    return send(env, chatId, "Сначала привяжите аккаунт: в кабинете на сайте «Настройки → Уведомления» → «Подключить Telegram».");
  }

  if (text === "/help") return send(env, chatId, HELP);

  if (text === "/stop") {
    await env.DB.prepare("UPDATE users SET tg_chat_id = NULL WHERE email = ?").bind(user.email).run();
    await env.DB.prepare("UPDATE reminders SET channel = 'site' WHERE email = ?").bind(user.email).run();
    return send(env, chatId, "Отключил. Напоминания останутся в кабинете на сайте. Вернуться можно в любой момент — снова привяжите аккаунт.");
  }


  /* ---------- Подписка ---------- */

  if (text === "/podpiska" || text === "/подписка") {
    const plan = planOf(user);
    const tier = tierOf(user);
    if (tier === "free") {
      return send(env, chatId,
        `Сейчас у вас тариф <b>${esc(plan.title)}</b> — бесплатный.\n\n` +
        `Что он даёт: ${plan.limits.aiPerDay} вопроса в день, ` +
        `${plan.limits.toolUses} пробный запуск инструментов, ${plan.limits.reminders} напоминания.\n\n` +
        `Оформить платный: /kupit`);
    }
    const left = user.pro_until
      ? Math.ceil((user.pro_until - now()) / 86400000) : null;
    return send(env, chatId,
      `Ваш тариф: <b>${esc(plan.title)}</b>\n` +
      (left !== null
        ? `Действует до ${new Date(user.pro_until).toLocaleDateString("ru-RU")} — осталось ${left} дн.\n\n`
        : "Бессрочно.\n\n") +
      (left !== null && left <= 7
        ? "Подписка скоро закончится. Продлить: /kupit\n"
        : "Продлить заранее: /kupit\n") +
      `Сменить тариф — там же.`);
  }

  if (text === "/kupit" || text === "/купить") {
    const site = env.SITE_URL || "";
    const rows = ["basic", "pro"].map(id => {
      const pl = PLANS[id];
      const save = Math.round((1 - pl.price.year / (pl.price.month * 12)) * 100);
      return `<b>${esc(pl.title)}</b> — ${pl.price.month} ₽ в месяц или ${pl.price.year} ₽ за год (выгода ${save}%)\n` +
             `   ${esc(pl.tagline || "")}`;
    }).join("\n\n");

    const bal = await balanceOf(env, user.email);
    const points = bal > 0
      ? `\n\nНа балансе ${bal} баллов — ими можно закрыть до половины цены.`
      : "";

    return send(env, chatId,
      `<b>Тарифы</b>\n\n${rows}${points}\n\n` +
      `Оформить: ${site}/dashboard.html?pay=1\n` +
      `Оплата открывается сразу, входить заново не нужно.`);
  }

  if (text.startsWith("/promo") || text.startsWith("/промо")) {
    const code = text.replace(/^\/\S+\s*/, "").trim().toUpperCase();
    if (!code) return send(env, chatId, "Формат: <code>/promo КОД</code>");

    const codes = String(env.PROMO_CODES || "").split(",").map(x => x.trim()).filter(Boolean);
    const found = codes.map(c => c.split(":")).find(([n]) => n.toUpperCase() === code);
    if (!found) return send(env, chatId, "Такого промокода нет. Проверьте написание.");

    const already = await env.DB.prepare(
      "SELECT id FROM payments WHERE email = ? AND source = 'promo' AND plan = ?"
    ).bind(user.email, code).first();
    if (already) return send(env, chatId, "Этот промокод вы уже использовали.");

    const days = Math.max(1, Number(found[1]) || 0);
    const until = Math.max(user.pro_until || 0, now()) + days * 86400000;
    await env.DB.prepare("UPDATE users SET plan = 'pro', pro_until = ? WHERE email = ?")
      .bind(until, user.email).run();
    await env.DB.prepare(
      `INSERT INTO payments (id, email, amount, plan, source, status, created_at, completed_at)
       VALUES (?, ?, 0, ?, 'promo', 'succeeded', ?, ?)`
    ).bind(`promo-${now()}-${user.email}`, user.email, code, now(), now()).run();
    await logAction(env, user.email, `Промокод ${code} из Telegram: +${days} дн.`);

    return send(env, chatId,
      `Готово! Тариф «Про» на ${days} дн.\n` +
      `Действует до ${new Date(until).toLocaleDateString("ru-RU")}.`);
  }

  /* ---------- Профиль ---------- */

  if (text === "/profil" || text === "/профиль") {
    const plan = planOf(user);
    const ai = await aiQuota(env, user);
    const tool = await toolQuota(env, user);
    const an = await analyzeQuota(env, user);
    const bal = await balanceOf(env, user.email);
    const lim = v => (v.limit === null ? "без ограничений" : `${v.left} из ${v.limit}`);

    return send(env, chatId,
      `<b>${esc(user.name)}</b>\n${esc(user.email)}\n\n` +
      `Тариф: <b>${esc(plan.title)}</b>` +
      (user.pro_until ? ` до ${new Date(user.pro_until).toLocaleDateString("ru-RU")}` : "") + "\n" +
      `Баллы: ${bal}\n\n` +
      `<b>Осталось сегодня</b>\n` +
      `Вопросов ИИ: ${lim(ai)}\n` +
      `Запусков инструментов: ${lim(tool)}\n` +
      `Разборов документов в месяц: ${lim(an)}\n\n` +
      `Сменить имя: <code>/imya Иван Петров</code>\n` +
      `Всё остальное — в кабинете: ${env.SITE_URL || ""}/dashboard.html`);
  }

  if (text === "/bally" || text === "/баллы") {
    const bal = await balanceOf(env, user.email);
    return send(env, chatId,
      `На балансе: <b>${bal}</b> баллов\n\n` +
      `1 балл = 1 ₽ скидки. Оплатить баллами можно до половины стоимости подписки.\n\n` +
      `Как получить:\n` +
      `• 150 — другу за регистрацию по вашей ссылке\n` +
      `• 150 — вам, когда друг начнёт пользоваться\n` +
      `• 500 — вам, когда друг впервые оплатит\n\n` +
      `Ваша ссылка: /pozvat`);
  }

  if (text === "/pozvat" || text === "/позвать") {
    const code = codeFor(user.email);
    const link = `${env.SITE_URL || ""}/auth.html?ref=${code}`;
    return send(env, chatId,
      `Ваша пригласительная ссылка:\n${link}\n\n` +
      `Другу — 150 баллов сразу при регистрации. Вам — 150, когда он начнёт пользоваться, ` +
      `и ещё 500, когда впервые оплатит.\n\n` +
      `Баллы тратятся внутри сервиса и не сгорают.`);
  }

  if (text.startsWith("/imya") || text.startsWith("/имя")) {
    const name = text.replace(/^\/\S+\s*/, "").trim().slice(0, 80);
    if (name.length < 2) return send(env, chatId, "Формат: <code>/imya Иван Петров</code>");
    await env.DB.prepare("UPDATE users SET name = ? WHERE email = ?").bind(name, user.email).run();
    await logAction(env, user.email, "Имя изменено из Telegram");
    return send(env, chatId, `Готово. Теперь вас зовут <b>${esc(name)}</b>.`);
  }

  /* ---------- Совет ---------- */

  if (text === "/svodka" || text === "/сводка") {
    const { previewDigest } = await import("./digest.js");
    const d = await previewDigest(env, user);
    return send(env, chatId, d
      ? d.text
      : "На этой неделе ничего срочного. Сводка приходит по понедельникам утром — " +
        "отключить можно командой /svodka_off");
  }

  if (text === "/svodka_off" || text === "/сводка_выкл") {
    await env.DB.prepare("UPDATE users SET digest_off = 1 WHERE email = ?").bind(user.email).run();
    return send(env, chatId, "Сводка недели отключена. Вернуть: /svodka_on");
  }

  if (text === "/svodka_on" || text === "/сводка_вкл") {
    await env.DB.prepare("UPDATE users SET digest_off = 0 WHERE email = ?").bind(user.email).run();
    return send(env, chatId, "Сводка недели включена. Приходит по понедельникам утром.");
  }

  if (text === "/sovet" || text === "/совет") {
    const tip = TIPS[Math.floor(Date.now() / 86400000) % TIPS.length];
    return send(env, chatId, `<b>Совет дня</b>\n\n${tip}`);
  }

  if (text === "/sroki" || text === "/срок" || text === "/сроки") {
    const rows = await env.DB.prepare(
      "SELECT title, due, repeat_rule FROM reminders WHERE email = ? AND active = 1 ORDER BY due ASC LIMIT 10"
    ).bind(user.email).all();
    const items = rows.results || [];
    if (!items.length) return send(env, chatId, "Напоминаний пока нет. Добавьте их в кабинете или командой /dobavit");

    const today = localDay(user.tz_offset ?? 3);
    const lines = items.map(r => {
      const left = Math.round((Date.parse(r.due) - Date.parse(today)) / 86400000);
      const when = left < 0 ? "просрочено" : left === 0 ? "<b>сегодня</b>" : `через ${left} дн.`;
      return `• ${esc(r.title)} — ${r.due.split("-").reverse().join(".")} (${when})`;
    });
    return send(env, chatId, "<b>Ближайшие сроки</b>\n\n" + lines.join("\n"));
  }

  if (text.startsWith("/dobavit") || text.startsWith("/добавить")) {
    const rest = text.replace(/^\/\S+\s*/, "").trim();
    const m = rest.match(/^(\d{2})[.\-/](\d{2})[.\-/](\d{4})\s+(.+)$/);
    if (!m) {
      return send(env, chatId, "Формат: <code>/dobavit 28.04.2026 Аванс по УСН</code>\n\nИли добавьте напоминание в кабинете — там есть готовые налоговые сроки.");
    }
    const [, dd, mm, yyyy, title] = m;
    const due = `${yyyy}-${mm}-${dd}`;
    if (Number.isNaN(Date.parse(due))) return send(env, chatId, "Не понял дату. Формат: 28.04.2026");

    const cnt = await env.DB.prepare("SELECT COUNT(*) AS n FROM reminders WHERE email = ? AND active = 1")
      .bind(user.email).first();
    if (!isPro(user) && (cnt?.n || 0) >= 3) {
      return send(env, chatId, "На бесплатном тарифе доступно 3 напоминания. С Pro — сколько угодно и с доставкой сюда, в Telegram.");
    }

    await env.DB.prepare(
      `INSERT INTO reminders (email, title, due, repeat_rule, notify_days, channel, source, created_at)
       VALUES (?, ?, ?, 'once', '3,1,0', ?, 'user', ?)`
    ).bind(user.email, title.slice(0, 140), due, isPro(user) ? "both" : "site", now()).run();

    return send(env, chatId, `Запомнил: <b>${esc(title)}</b> — ${dd}.${mm}.${yyyy}\n\nНапомню за 3 дня, за день и в сам день.`);
  }

  /* Обычное сообщение — вопрос консультанту, с теми же лимитами, что на сайте. */
  if (text.startsWith("/")) return send(env, chatId, "Не знаю такой команды.\n\n" + HELP);
  if (text.length < 3) return send(env, chatId, "Напишите вопрос подробнее.");

  if (!env.AI_API_KEY) return send(env, chatId, "Консультант временно недоступен.");

  const spent = await spendAI(env, user);
  if (!spent) {
    const q = await aiQuota(env, user);
    return send(env, chatId,
      `Дневной лимит вопросов исчерпан (${q.limit} в сутки). Он обновится завтра.\n\nС подпиской Pro лимита нет — оформить можно в кабинете на сайте.`);
  }

  await send(env, chatId, "Думаю…");
  const { DEFAULT_SYSTEM } = await import("./ai.js");
  try {
    const r = await fetch((env.AI_BASE_URL || "https://api.aitunnel.ru/v1") + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + env.AI_API_KEY },
      body: JSON.stringify({
        model: env.AI_MODEL || "deepseek-chat",
        messages: [
          { role: "system", content: DEFAULT_SYSTEM + "\n\nОтвечаешь в мессенджере: до 1200 знаков, без таблиц и markdown-разметки." },
          { role: "user", content: text },
        ],
        max_tokens: 900,
      }),
      signal: AbortSignal.timeout(55000),
    });
    const data = await r.json();
    const answer = data?.choices?.[0]?.message?.content;
    if (!answer) throw new Error("empty");
    await send(env, chatId, esc(answer).slice(0, 4000));
  } catch {
    await send(env, chatId, "ИИ сейчас не отвечает. Попробуйте через минуту.");
  }
}

/* ---------- Рассылка по расписанию ---------- */

/* Запускается по крону раз в час. Смотрит, кому сегодня пора напомнить,
   пишет в ленту на сайте и, если подключён Telegram и оплачен Pro, шлёт туда. */
export async function runReminders(env) {
  const rows = await env.DB.prepare(
    `SELECT r.*, u.tg_chat_id, u.tz_offset, u.plan, u.pro_until, u.role
       FROM reminders r JOIN users u ON u.email = r.email
      WHERE r.active = 1`
  ).all();

  let sent = 0, rolled = 0;

  for (const r of rows.results || []) {
    const tz = r.tz_offset ?? 3;
    const today = localDay(tz);
    const offsets = r.notify_days.split(",").map(Number).filter(n => Number.isInteger(n));

    for (const off of offsets) {
      /* Дата, в которую надо предупредить: срок минус offset дней. */
      if (addDays(r.due, -off) !== today) continue;

      const already = await env.DB.prepare(
        "SELECT 1 FROM reminder_sent WHERE reminder_id = ? AND due = ? AND offset_days = ?"
      ).bind(r.id, r.due, off).first();
      if (already) continue;

      const when = off === 0 ? "сегодня" : off === 1 ? "завтра" : `через ${off} дн.`;
      const dateRu = r.due.split("-").reverse().join(".");
      const title = `${r.title} — ${when}`;
      const body = `Срок: ${dateRu}.${r.note ? " " + r.note : ""}`;

      await notify(env, r.email, { title, body, kind: "reminder", link: "dashboard.html#reminders" });

      const pro = isPro({ role: r.role, plan: r.plan, pro_until: r.pro_until });
      if (r.tg_chat_id && pro && r.channel !== "site") {
        await send(env, r.tg_chat_id,
          `⏰ <b>${esc(r.title)}</b>\n\nСрок: ${dateRu} — ${when}.${r.note ? "\n" + esc(r.note) : ""}`);
      }

      await env.DB.prepare(
        "INSERT OR IGNORE INTO reminder_sent (reminder_id, due, offset_days, sent_at) VALUES (?, ?, ?, ?)"
      ).bind(r.id, r.due, off, now()).run();
      sent++;
    }

    /* Срок прошёл — либо переносим повторяющееся, либо гасим разовое. */
    if (r.due < localDay(tz)) {
      const next = nextDue(r.due, r.repeat_rule);
      if (next) {
        await env.DB.prepare("UPDATE reminders SET due = ? WHERE id = ?").bind(next, r.id).run();
        rolled++;
      } else if (addDays(r.due, 7) < localDay(tz)) {
        await env.DB.prepare("UPDATE reminders SET active = 0 WHERE id = ?").bind(r.id).run();
      }
    }
  }

  /* Ленту не даём расти бесконечно. */
  await env.DB.prepare("DELETE FROM notifications WHERE created_at < ?")
    .bind(now() - 180 * 86400000).run().catch(() => {});
  await env.DB.prepare("DELETE FROM tg_link_codes WHERE expires_at < ?").bind(now()).run().catch(() => {});

  console.log(`reminders: отправлено ${sent}, перенесено ${rolled}`);
  return { sent, rolled };
}
