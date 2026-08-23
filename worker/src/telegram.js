/* ПравоФин — Telegram-бот: привязка аккаунта, напоминания, вопросы к ИИ.

   Бот здесь не игрушка, а второй вход в сервис. В России его открывают чаще,
   чем почту, поэтому именно он делает напоминания по-настоящему работающими. */
import { json, fail, now, isPro, normEmail } from "./lib.js";
import { logAction } from "./auth.js";
import { notify, localDay, addDays, nextDue } from "./reminders.js";
import { aiQuota, spendAI } from "./quota.js";

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

const HELP = `Я помогу не пропустить сроки и отвечу на вопросы по праву, налогам и финансам.

<b>Команды</b>
/start — привязать аккаунт
/sroki — ближайшие напоминания
/dobavit — добавить напоминание
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
        : `Здравствуйте! Это бот сервиса <b>ПравоФин</b>.\n\nЧтобы получать напоминания о сроках, привяжите аккаунт: зайдите в личный кабинет на сайте, откройте «Настройки → Уведомления» и нажмите «Подключить Telegram».\n\n${HELP}`);
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
