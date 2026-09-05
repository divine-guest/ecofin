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
   Это снимает главный барьер: человеку не надо знать, что вписывать.

   Поля отбора:
     who   — кому подходит: ip, ooo, self (самозанятый), person (физлицо);
     mode  — при каком режиме: usn, patent, npd, osno, ausn.
             Отсутствует — значит режим не важен;
     staff — только если есть наёмные работники.

   Даты — единые сроки ЕНП: уведомление 25-го, платёж 28-го. Числа
   намеренно записаны без года: год подставляется при добавлении, и
   список не протухает первого января. */
export const CALENDAR_PRESETS = [
  { id: "usn-q1", title: "Аванс по УСН за I квартал", due: "04-28", repeat: "yearly", who: ["ip", "ooo"], mode: ["usn"] },
  { id: "usn-q2", title: "Аванс по УСН за полугодие", due: "07-28", repeat: "yearly", who: ["ip", "ooo"], mode: ["usn"] },
  { id: "usn-q3", title: "Аванс по УСН за 9 месяцев", due: "10-28", repeat: "yearly", who: ["ip", "ooo"], mode: ["usn"] },
  { id: "usn-year-ip", title: "Декларация и итоговый платёж УСН (ИП)", due: "04-25", repeat: "yearly", who: ["ip"], mode: ["usn"] },
  { id: "usn-year-ooo", title: "Декларация и итоговый платёж УСН (ООО)", due: "03-25", repeat: "yearly", who: ["ooo"], mode: ["usn"] },
  { id: "vznosy", title: "Фиксированные страховые взносы ИП за себя", due: "12-28", repeat: "yearly", who: ["ip"] },
  { id: "vznosy-1", title: "1% с дохода свыше 300 000 ₽", due: "07-01", repeat: "yearly", who: ["ip"] },
  { id: "npd", title: "Налог на профдоход за прошлый месяц", due: "28", repeat: "monthly", who: ["self"], mode: ["npd"] },
  { id: "ndfl-6", title: "Расчёт 6-НДФЛ за квартал", due: "04-25", repeat: "quarterly", who: ["ip", "ooo"], staff: true },
  { id: "declaration-3ndfl", title: "Декларация 3-НДФЛ", due: "04-30", repeat: "yearly", who: ["person"] },

  /* --- Работники: то, что забывают чаще всего ---

     Отчётность за людей идёт своим ритмом и не зависит от режима:
     персонифицированные сведения каждый месяц, РСВ и ЕФС-1 — раз в
     квартал. Штраф за каждый несданный отчёт отдельный, и набегает
     он тихо. */
  { id: "persons", title: "Персонифицированные сведения о физлицах", due: "25", repeat: "monthly", who: ["ip", "ooo"], staff: true },
  { id: "rsv", title: "РСВ — расчёт по страховым взносам за квартал", due: "01-25", repeat: "quarterly", who: ["ip", "ooo"], staff: true },
  { id: "efs1", title: "ЕФС-1: взносы на травматизм за квартал", due: "01-25", repeat: "quarterly", who: ["ip", "ooo"], staff: true },
  { id: "vznosy-staff", title: "Страховые взносы за работников", due: "28", repeat: "monthly", who: ["ip", "ooo"], staff: true },
  { id: "ndfl-pay", title: "НДФЛ с выплат работникам", due: "28", repeat: "monthly", who: ["ip", "ooo"], staff: true },
  { id: "enp-notice", title: "Уведомление по ЕНП об исчисленных суммах", due: "25", repeat: "monthly", who: ["ip", "ooo"], staff: true },

  /* Зарплата и аванс — не налог, а обязанность по ТК ст. 136: платить
     не реже чем каждые полмесяца. За просрочку идут проценты по
     ст. 236 ТК, и считаются они автоматически, без заявления. */
  { id: "salary-adv", title: "Аванс работникам (первая половина месяца)", due: "25", repeat: "monthly", who: ["ip", "ooo"], staff: true },
  { id: "salary", title: "Зарплата за прошлый месяц", due: "10", repeat: "monthly", who: ["ip", "ooo"], staff: true },

  /* --- Общий режим --- */
  { id: "nds-decl", title: "Декларация по НДС за квартал", due: "01-25", repeat: "quarterly", who: ["ip", "ooo"], mode: ["osno"] },
  { id: "nds-pay", title: "Платёж по НДС (треть квартальной суммы)", due: "28", repeat: "monthly", who: ["ip", "ooo"], mode: ["osno"] },
  { id: "profit", title: "Налог на прибыль: аванс за месяц", due: "28", repeat: "monthly", who: ["ooo"], mode: ["osno"] },
  { id: "ndfl-ip-osno", title: "Аванс по НДФЛ за себя (ИП на общем режиме)", due: "04-28", repeat: "quarterly", who: ["ip"], mode: ["osno"] },

  /* --- Патент ---

     Годовой патент оплачивают в два срока: треть в первые 90 дней и
     остальное до конца года. Патент до полугода — одним платежом до
     конца срока. Даты ставим по годовому: он у большинства. */
  { id: "psn-1", title: "Патент: первая треть стоимости", due: "03-31", repeat: "yearly", who: ["ip"], mode: ["patent"] },
  { id: "psn-2", title: "Патент: остаток стоимости", due: "12-28", repeat: "yearly", who: ["ip"], mode: ["patent"] },

  /* --- АУСН --- */
  { id: "ausn", title: "Налог по АУСН за прошлый месяц", due: "25", repeat: "monthly", who: ["ip", "ooo"], mode: ["ausn"] },

  /* --- Физлицу --- */
  { id: "prop-tax", title: "Налоги на квартиру, машину и землю", due: "12-01", repeat: "yearly", who: ["person", "ip", "self"] },
  { id: "vychet", title: "Подать на налоговый вычет за прошлый год", due: "02-01", repeat: "yearly", who: ["person", "ip", "self"] },

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
    due: "05", repeat: "monthly", who: ["ip", "ooo", "self"], sphere: ["trade"] },
  { id: "mp-fines", title: "Оспорить штрафы и удержания в личном кабинете площадки",
    due: "10", repeat: "monthly", who: ["ip", "ooo", "self"], sphere: ["trade"]  },
  { id: "mp-stock", title: "Проверить остатки и заявки на поставку",
    due: "01", repeat: "monthly", who: ["ip", "ooo", "self"], sphere: ["trade"]  },
  { id: "mp-cards", title: "Пересмотреть карточки: цены, фото, характеристики",
    due: "15", repeat: "monthly", who: ["ip", "ooo", "self"], sphere: ["trade"]  },
  { id: "mp-terms", title: "Посмотреть, что изменилось в оферте площадки",
    due: "20", repeat: "monthly", who: ["ip", "ooo", "self"], sphere: ["trade"]  },
  { id: "mp-mark", title: "Маркировка «Честный знак»: остатки и выбытие",
    due: "25", repeat: "monthly", who: ["ip", "ooo"], sphere: ["trade"]  },
];

export function presets(env, origin) {
  return json(env, origin, { presets: CALENDAR_PRESETS });
}

/* ---------- Личный налоговый календарь ----------

   Отбор сроков под конкретного человека. Общий список из тридцати
   позиций бесполезен: половина из них про чужой режим, и разбираться,
   какие мои, человек не станет — он закроет вкладку.

   Три признака решают всё: кто вы, на каком режиме и есть ли
   работники. Больше вопросов задавать нельзя — мастер, который
   спрашивает пять раз, не проходят до конца.                       */

const WHO = ["ip", "ooo", "self", "person"];
const MODES = ["usn", "patent", "npd", "osno", "ausn", "none"];

export function pickPresets({ who, mode, staff, sphere }) {
  return CALENDAR_PRESETS.filter(p => {
    if (p.who && !p.who.includes(who)) return false;
    if (p.mode && !p.mode.includes(mode)) return false;
    if (p.staff && !staff) return false;
    /* Ритм маркетплейса подходит только тем, кто там торгует. Без
       этого отбора шесть чужих сроков попадали каждому, и личный
       календарь переставал быть личным — а именно в этом вся его
       ценность. Сферу спрашивать отдельно не нужно: она уже есть
       в ответах знакомства. */
    if (p.sphere && !p.sphere.includes(sphere)) return false;
    return true;
  });
}

/* Ближайшая настоящая дата для шаблона. Год не хранится в самом
   шаблоне намеренно: иначе список пришлось бы править каждый январь,
   и однажды это забыли бы сделать. */
export function dueFor(preset, today) {
  const year = Number(today.slice(0, 4));
  if (preset.repeat === "monthly") {
    const day = String(preset.due).padStart(2, "0");
    let due = `${today.slice(0, 7)}-${day}`;
    if (due < today) due = nextDue(due, "monthly");
    return due;
  }
  let due = `${year}-${preset.due}`;
  if (due < today) {
    /* Квартальные шаблоны записаны датой первого квартала — для них
       правильнее сдвинуть на квартал вперёд, а не на год. */
    due = preset.repeat === "quarterly" ? nextDue(due, "quarterly") : `${year + 1}-${preset.due}`;
    while (due < today) due = nextDue(due, preset.repeat);
  }
  return due;
}

/* GET /api/reminders/plan?who=ip&mode=usn&staff=1 — что получится,
   до того как что-то создавать. Показать список ДО добавления важно:
   человек должен видеть, на что соглашается. */
export function planPreview(request, env, origin, user) {
  const u = new URL(request.url);
  const who = WHO.includes(u.searchParams.get("who")) ? u.searchParams.get("who") : "ip";
  const mode = MODES.includes(u.searchParams.get("mode")) ? u.searchParams.get("mode") : "usn";
  const staff = u.searchParams.get("staff") === "1";
  const sphere = String(u.searchParams.get("sphere") || "");
  const today = localDay(user.tz_offset ?? 3);

  const items = pickPresets({ who, mode, staff, sphere })
    .map(p => ({ id: p.id, title: p.title, due: dueFor(p, today), repeat: p.repeat }))
    .sort((a, b) => a.due.localeCompare(b.due));

  return json(env, origin, { items, free: isPro(user) ? null : FREE_REMINDERS });
}

/* POST /api/reminders/plan {who, mode, staff} — заполнить календарь.

   Повторный вызов не плодит дубликаты: у каждого шаблона есть id, и
   он пишется в source. Человек, сменивший режим, нажмёт кнопку снова —
   и это должно работать, а не устраивать свалку.                   */
export async function planApply(request, env, origin, user) {
  const b = await request.json().catch(() => ({}));
  const who = WHO.includes(b.who) ? b.who : "ip";
  const mode = MODES.includes(b.mode) ? b.mode : "usn";
  const staff = Boolean(b.staff);
  const sphere = String(b.sphere || "");
  const today = localDay(user.tz_offset ?? 3);

  const rows = await env.DB.prepare(
    "SELECT source FROM reminders WHERE email = ? AND active = 1"
  ).bind(user.email).all();
  const have = new Set((rows.results || []).map(r => r.source));
  const count = (rows.results || []).length;

  const wanted = pickPresets({ who, mode, staff, sphere })
    .filter(p => !have.has("plan:" + p.id))
    .map(p => ({ ...p, dueDate: dueFor(p, today) }))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  /* Лимит бесплатного тарифа не обходим — но и не отказываем целиком:
     ставим сколько влезает, начиная с ближайших. Отказ «у вас лимит»
     вместо трёх поставленных сроков — это потеря и пользы, и повода
     когда-нибудь заплатить. */
  const room = isPro(user)
    ? MAX_REMINDERS - count
    : Math.max(0, Math.min(FREE_REMINDERS, MAX_REMINDERS) - count);
  const take = wanted.slice(0, Math.max(0, room));

  const channel = isPro(user) && user.tg_chat_id ? "both" : "site";
  const ts = now();
  for (const p of take) {
    await env.DB.prepare(
      `INSERT INTO reminders (email, title, due, repeat_rule, notify_days, channel, note, source, created_at)
       VALUES (?, ?, ?, ?, '3,1,0', ?, '', ?, ?)`
    ).bind(user.email, p.title, p.dueDate, p.repeat, channel, "plan:" + p.id, ts).run();
  }

  if (take.length) await logAction(env, user.email, `Заполнен налоговый календарь: ${take.length} сроков`);

  return json(env, origin, {
    added: take.length,
    skipped: wanted.length - take.length,
    already: pickPresets({ who, mode, staff, sphere }).length - wanted.length,
    limited: !isPro(user) && wanted.length > take.length,
  });
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
