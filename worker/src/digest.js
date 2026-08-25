/* ============ Еженедельная сводка ============

   Самый дешёвый способ вернуть человека — не заставлять его вспоминать
   о сервисе, а самому написать в понедельник: вот что у вас на этой
   неделе. Ни одна кнопка внутри сайта так не работает, потому что
   для неё нужно сначала на сайт зайти.

   Правила, чтобы это не стало спамом:
   • раз в неделю, только по понедельникам утром по времени человека;
   • только если есть что сказать — пустых писем не шлём;
   • отключается одной командой и одной галкой в настройках.        */

import { now } from "./lib.js";
import { isPaid } from "./plans.js";

/* Утро понедельника по местному времени. Час выбран так, чтобы письмо
   пришло к началу рабочего дня, а не разбудило ночью. */
const SEND_HOUR = 9;

/* Совет недели — тот же список, что у бота: одна подборка на сервис,
   чтобы не расходиться. */
import { TIPS } from "./telegram.js";

function localNow(tzOffset) {
  return new Date(Date.now() + (tzOffset ?? 3) * 3600000);
}

/* Номер недели от общей точки: нужен, чтобы отметить, что сводка за
   эту неделю уже ушла, и не слать её дважды. */
function weekNumber(d = new Date()) {
  return Math.floor(d.getTime() / (7 * 86400000));
}

/* Собирает сводку для одного человека. Возвращает null, если сказать
   нечего, — это важнее, чем кажется: письмо ни о чём учит игнорировать
   все следующие. */
async function buildFor(env, user) {
  const tz = user.tz_offset ?? 3;
  const today = localNow(tz).toISOString().slice(0, 10);
  const inWeek = new Date(Date.parse(today) + 7 * 86400000).toISOString().slice(0, 10);

  const due = await env.DB.prepare(
    `SELECT title, due FROM reminders
      WHERE email = ? AND active = 1 AND due >= ? AND due <= ?
      ORDER BY due ASC LIMIT 5`
  ).bind(user.email, today, inWeek).all();
  const items = due.results || [];

  /* Подписка на исходе — повод сказать заранее, а не после отключения. */
  const left = user.pro_until
    ? Math.ceil((user.pro_until - now()) / 86400000) : null;
  const expiring = isPaid(user) && left !== null && left <= 7 && left >= 0;

  /* Неистраченный пробный — единственное, что стоит напомнить
     бесплатному пользователю. */
  const trialRow = await env.DB.prepare(
    "SELECT id FROM payments WHERE email = ? AND source = 'trial'"
  ).bind(user.email).first();
  const trialAvailable = !trialRow && !isPaid(user);

  if (!items.length && !expiring && !trialAvailable) return null;

  const lines = [];
  if (items.length) {
    lines.push("<b>На этой неделе</b>");
    for (const r of items) {
      const days = Math.round((Date.parse(r.due) - Date.parse(today)) / 86400000);
      const when = days === 0 ? "сегодня" : days === 1 ? "завтра" : `через ${days} дн.`;
      lines.push(`• ${r.title} — ${r.due.split("-").reverse().join(".")} (${when})`);
    }
    lines.push("");
  }

  if (expiring) {
    lines.push(left === 0
      ? "<b>Подписка заканчивается сегодня.</b> Продлить: /kupit"
      : `<b>Подписка заканчивается через ${left} дн.</b> Продлить заранее: /kupit`);
    lines.push("");
  }

  if (trialAvailable) {
    lines.push("<b>Три дня «Про» бесплатно</b> — карта не нужна, включается в кабинете.");
    lines.push("");
  }

  lines.push("<b>Совет недели</b>");
  lines.push(TIPS[weekNumber() % TIPS.length]);

  return {
    text: lines.join("\n"),
    title: items.length ? `На этой неделе: ${items.length} ${
      items.length === 1 ? "срок" : items.length < 5 ? "срока" : "сроков"}`
      : "Сводка недели",
    body: lines.join("\n").replace(/<\/?b>/g, ""),
  };
}

/* Показать сводку по требованию — из бота или кабинета.
   Отметку об отправке не ставим: это просмотр, а не рассылка. */
export async function previewDigest(env, user) {
  return buildFor(env, user).catch(() => null);
}

/* Рассылка. Вызывается из крона каждый час; сама решает, чей сейчас
   понедельник. */
export async function runDigest(env, send) {
  const week = weekNumber();

  const rows = await env.DB.prepare(
    `SELECT email, name, tg_chat_id, tz_offset, plan, pro_until, role, digest_week
       FROM users WHERE digest_off IS NULL OR digest_off = 0`
  ).all();

  let sent = 0;
  for (const u of rows.results || []) {
    const local = localNow(u.tz_offset);
    /* getUTCDay, потому что local уже сдвинут на часовой пояс человека. */
    if (local.getUTCDay() !== 1 || local.getUTCHours() !== SEND_HOUR) continue;
    if (Number(u.digest_week) === week) continue;   // за эту неделю уже слали

    const d = await buildFor(env, u).catch(() => null);
    /* Отметку ставим в любом случае: иначе пустую сводку будем
       пересобирать каждый час до конца дня. */
    await env.DB.prepare("UPDATE users SET digest_week = ? WHERE email = ?")
      .bind(week, u.email).run().catch(() => {});
    if (!d) continue;

    await env.DB.prepare(
      `INSERT INTO notifications (email, title, body, kind, link, created_at)
       VALUES (?, ?, ?, 'info', 'dashboard.html', ?)`
    ).bind(u.email, d.title, d.body.slice(0, 1000), now()).run().catch(() => {});

    if (u.tg_chat_id && send) {
      await send(env, u.tg_chat_id, d.text).catch(() => {});
    }
    sent++;
  }
  return { sent, week };
}
