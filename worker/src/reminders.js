/* ЭкоФин — напоминания и лента уведомлений.

   Смысл функции для бизнеса: ИП боится пропустить налоговый срок и получить
   блокировку счёта. Напоминание об этом — то, ради чего возвращаются сами,
   и то, от чего не отписываются. Поэтому канал Telegram отдан платному тарифу,
   а лента на сайте доступна всем. */
import { json, fail, now, isPro } from "./lib.js";
import { logAction } from "./auth.js";

/* Бесплатно — три напоминания и только лента на сайте.
   Три, а не одно: с одним функция не чувствуется и не удерживает. */
export const FREE_REMINDERS = 3;
export const MAX_REMINDERS = 100;
const REPEATS = ["once", "monthly", "quarterly", "yearly"];
const CHANNELS = ["site", "telegram", "both"];

const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

/* Дата в часовом поясе пользователя. Без этого «за 3 дня» во Владивостоке
   и в Калининграде срабатывало бы в разные сутки. */
export function localDay(tzOffset = 3, ts = Date.now()) {
  return new Date(ts + tzOffset * 3600000).toISOString().slice(0, 10);
}

export function addDays(day, n) {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/* Следующая дата повторяющегося напоминания. Если 31-го числа в месяце нет,
   переносим на последний день — иначе «31 января ежемесячно» уехало бы на март. */
export function nextDue(due, rule) {
  if (rule === "once") return null;
  const d = new Date(due + "T00:00:00Z");
  const day = d.getUTCDate();
  const add = rule === "monthly" ? 1 : rule === "quarterly" ? 3 : 12;
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + add, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

function parseNotifyDays(raw) {
  const list = String(raw || "3,1,0")
    .split(",")
    .map(n => Math.min(60, Math.max(0, parseInt(n, 10))))
    .filter(n => Number.isInteger(n));
  return [...new Set(list)].sort((a, b) => b - a).slice(0, 5).join(",") || "0";
}

/* ---------- Напоминания пользователя ---------- */

export async function list(request, env, origin, user) {
  const rows = await env.DB.prepare(
    "SELECT * FROM reminders WHERE email = ? AND active = 1 ORDER BY due ASC"
  ).bind(user.email).all();

  const today = localDay(user.tz_offset ?? 3);
  const items = (rows.results || []).map(r => ({
    id: r.id,
    title: r.title,
    due: r.due,
    repeat: r.repeat_rule,
    notifyDays: r.notify_days.split(",").map(Number),
    channel: r.channel,
    note: r.note || "",
    source: r.source,
    daysLeft: Math.round((Date.parse(r.due) - Date.parse(today)) / 86400000),
  }));

  return json(env, origin, {
    reminders: items,
    limit: isPro(user) ? null : FREE_REMINDERS,
    used: items.length,
    telegram: Boolean(user.tg_chat_id),
    pro: isPro(user),
  });
}

export async function create(request, env, origin, user) {
  const b = await request.json().catch(() => ({}));
  const title = String(b.title || "").trim().slice(0, 140);
  const due = String(b.due || "").trim();
  const repeat = REPEATS.includes(b.repeat) ? b.repeat : "once";
  const channel = CHANNELS.includes(b.channel) ? b.channel : "site";
  const note = String(b.note || "").trim().slice(0, 500);

  if (title.length < 2) return fail(env, origin, "Напишите, о чём напомнить");
  if (!isDate(due)) return fail(env, origin, "Укажите дату в формате ГГГГ-ММ-ДД");

  const countRow = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM reminders WHERE email = ? AND active = 1"
  ).bind(user.email).first();
  const count = countRow?.n || 0;

  if (count >= MAX_REMINDERS) return fail(env, origin, `Больше ${MAX_REMINDERS} напоминаний не поддерживается`);
  if (!isPro(user) && count >= FREE_REMINDERS) {
    return json(env, origin, {
      error: `На бесплатном тарифе доступно ${FREE_REMINDERS} напоминания. С Pro — сколько угодно и с доставкой в Telegram`,
      paywall: true, kind: "reminders",
    }, 402);
  }
  /* Telegram — платный канал: это и есть услуга, за которую платят. */
  const finalChannel = isPro(user) ? channel : "site";
  if (channel !== "site" && !isPro(user)) {
    /* Не отказываем, а мягко понижаем: напоминание всё равно создастся. */
  }

  const res = await env.DB.prepare(
    `INSERT INTO reminders (email, title, due, repeat_rule, notify_days, channel, note, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'user', ?)`
  ).bind(user.email, title, due, repeat, parseNotifyDays(b.notifyDays), finalChannel, note, now()).run();

  await logAction(env, user.email, `Добавлено напоминание: ${title}`);
  return json(env, origin, {
    id: res.meta?.last_row_id,
    downgraded: channel !== finalChannel,
  }, 201);
}

export async function update(request, env, origin, user) {
  const b = await request.json().catch(() => ({}));
  const id = Number(b.id);
  const row = await env.DB.prepare("SELECT * FROM reminders WHERE id = ? AND email = ?")
    .bind(id, user.email).first();
  if (!row) return fail(env, origin, "Напоминание не найдено", 404);

  const title = b.title !== undefined ? String(b.title).trim().slice(0, 140) : row.title;
  const due = b.due !== undefined ? String(b.due).trim() : row.due;
  if (title.length < 2) return fail(env, origin, "Напишите, о чём напомнить");
  if (!isDate(due)) return fail(env, origin, "Укажите дату в формате ГГГГ-ММ-ДД");

  const repeat = REPEATS.includes(b.repeat) ? b.repeat : row.repeat_rule;
  const channel = isPro(user) && CHANNELS.includes(b.channel) ? b.channel : (isPro(user) ? row.channel : "site");
  const note = b.note !== undefined ? String(b.note).trim().slice(0, 500) : row.note;
  const notify = b.notifyDays !== undefined ? parseNotifyDays(b.notifyDays) : row.notify_days;

  await env.DB.prepare(
    "UPDATE reminders SET title = ?, due = ?, repeat_rule = ?, notify_days = ?, channel = ?, note = ? WHERE id = ? AND email = ?"
  ).bind(title, due, repeat, notify, channel, note, id, user.email).run();

  /* Дата поменялась — прошлые отметки об отправке больше не действуют. */
  if (due !== row.due) {
    await env.DB.prepare("DELETE FROM reminder_sent WHERE reminder_id = ?").bind(id).run();
  }
  return json(env, origin, { ok: true });
}

export async function remove(request, env, origin, user) {
  const b = await request.json().catch(() => ({}));
  const id = Number(b.id);
  const res = await env.DB.prepare("DELETE FROM reminders WHERE id = ? AND email = ?")
    .bind(id, user.email).run();
  if (!res.meta?.changes) return fail(env, origin, "Напоминание не найдено", 404);
  await env.DB.prepare("DELETE FROM reminder_sent WHERE reminder_id = ?").bind(id).run();
  return json(env, origin, { ok: true });
}

/* Готовые сроки из налогового календаря — добавляются одной кнопкой.
   Это снимает главный барьер: человеку не надо знать, что вписывать. */
export const CALENDAR_PRESETS = [
  { id: "usn-q1", title: "Аванс по УСН за I квартал", due: "04-28", repeat: "yearly", who: ["ip", "ooo"] },
  { id: "usn-q2", title: "Аванс по УСН за полугодие", due: "07-28", repeat: "yearly", who: ["ip", "ooo"] },
  { id: "usn-q3", title: "Аванс по УСН за 9 месяцев", due: "10-28", repeat: "yearly", who: ["ip", "ooo"] },
  { id: "usn-year-ip", title: "Декларация и итоговый платёж УСН (ИП)", due: "04-25", repeat: "yearly", who: ["ip"] },
  { id: "usn-year-ooo", title: "Декларация и итоговый платёж УСН (ООО)", due: "03-25", repeat: "yearly", who: ["ooo"] },
  { id: "vznosy", title: "Фиксированные страховые взносы ИП за себя", due: "12-28", repeat: "yearly", who: ["ip"] },
  { id: "vznosy-1", title: "1% с дохода свыше 300 000 ₽", due: "07-01", repeat: "yearly", who: ["ip"] },
  { id: "npd", title: "Налог на профдоход за прошлый месяц", due: "28", repeat: "monthly", who: ["self"] },
  { id: "ndfl-6", title: "Расчёт 6-НДФЛ за квартал", due: "04-25", repeat: "quarterly", who: ["ip", "ooo"] },
  { id: "declaration-3ndfl", title: "Декларация 3-НДФЛ", due: "04-30", repeat: "yearly", who: ["person"] },

  /* Сроки продавца на маркетплейсах.

     Это не налоговые даты, а ритм самой площадки, и пропускают их чаще
     всего: отчёт агента приходит раз в неделю, сверять его никто не
     садится, и удержания за штрафы и логистику остаются неоспоренными
     навсегда — срок на возражение в личном кабинете короткий.

     Даты намеренно ежемесячные и еженедельные, а не привязанные к числу
     календаря: у каждой площадки свой цикл, и жёсткое число врало бы.
     Наша задача — вернуть человека к сверке, а не изобразить точность,
     которой у нас нет. */
  { id: "mp-report", title: "Сверить отчёт агента маркетплейса с продажами",
    due: "05", repeat: "monthly", who: ["ip", "ooo", "self"] },
  { id: "mp-fines", title: "Оспорить штрафы и удержания в личном кабинете площадки",
    due: "10", repeat: "monthly", who: ["ip", "ooo", "self"] },
  { id: "mp-stock", title: "Проверить остатки и заявки на поставку",
    due: "01", repeat: "monthly", who: ["ip", "ooo", "self"] },
  { id: "mp-cards", title: "Пересмотреть карточки: цены, фото, характеристики",
    due: "15", repeat: "monthly", who: ["ip", "ooo", "self"] },
  { id: "mp-terms", title: "Посмотреть, что изменилось в оферте площадки",
    due: "20", repeat: "monthly", who: ["ip", "ooo", "self"] },
  { id: "mp-mark", title: "Маркировка «Честный знак»: остатки и выбытие",
    due: "25", repeat: "monthly", who: ["ip", "ooo"] },
];

export function presets(env, origin) {
  return json(env, origin, { presets: CALENDAR_PRESETS });
}

/* POST /api/reminders/preset {id} — превращает шаблон в конкретную дату. */
export async function addPreset(request, env, origin, user) {
  const b = await request.json().catch(() => ({}));
  const p = CALENDAR_PRESETS.find(x => x.id === b.id);
  if (!p) return fail(env, origin, "Шаблон не найден", 404);

  const today = localDay(user.tz_offset ?? 3);
  const year = Number(today.slice(0, 4));
  let due;
  if (p.repeat === "monthly") {
    const dayNum = p.due.padStart(2, "0");
    due = `${today.slice(0, 7)}-${dayNum}`;
    if (due < today) due = nextDue(due, "monthly");
  } else {
    due = `${year}-${p.due}`;
    if (due < today) due = `${year + 1}-${p.due}`;
  }

  const fake = new Request(request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify({
      title: p.title, due, repeat: p.repeat,
      channel: isPro(user) ? "both" : "site",
      note: "Из налогового календаря ЭкоФин",
    }),
  });
  return create(fake, env, origin, user);
}

/* ---------- Лента уведомлений ---------- */

export async function notify(env, email, { title, body, kind = "reminder", link = null }) {
  await env.DB.prepare(
    "INSERT INTO notifications (email, title, body, kind, link, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(email, title.slice(0, 200), (body || "").slice(0, 1000), kind, link, now()).run();
}

export async function listNotifications(request, env, origin, user) {
  const rows = await env.DB.prepare(
    "SELECT id, title, body, kind, link, created_at, read_at FROM notifications WHERE email = ? ORDER BY created_at DESC LIMIT 50"
  ).bind(user.email).all();
  const unread = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM notifications WHERE email = ? AND read_at IS NULL"
  ).bind(user.email).first();
  return json(env, origin, { notifications: rows.results || [], unread: unread?.n || 0 });
}

export async function markRead(request, env, origin, user) {
  const b = await request.json().catch(() => ({}));
  if (b.id) {
    await env.DB.prepare("UPDATE notifications SET read_at = ? WHERE id = ? AND email = ? AND read_at IS NULL")
      .bind(now(), Number(b.id), user.email).run();
  } else {
    await env.DB.prepare("UPDATE notifications SET read_at = ? WHERE email = ? AND read_at IS NULL")
      .bind(now(), user.email).run();
  }
  return json(env, origin, { ok: true });
}

export async function clearNotifications(request, env, origin, user) {
  await env.DB.prepare("DELETE FROM notifications WHERE email = ?").bind(user.email).run();
  return json(env, origin, { ok: true });
}
