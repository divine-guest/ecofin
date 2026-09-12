/* ЭкоФин — регистрация, вход, сессии, профиль. */
import {
  CFG, json, fail, hashPassword, verifyPassword, newSessionToken, sha256,
  bearer, now, normEmail, validEmail, ruEmail, publicUser, normalizeAvatar,
} from "./lib.js";
import { attachReferral } from "./referral.js";
import { penalize, forgive } from "./ratelimit.js";
import { mailReady, sendMail } from "./mail.js";

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
  if (!row) return null;
  /* Роль пересчитывается на каждом запросе, а не берётся из базы.
     Иначе роль, однажды записанная в строку пользователя, действовала бы
     сама по себе: убрать почту из OWNER_EMAILS было бы недостаточно,
     чтобы отобрать права. Источник истины — окружение. */
  row.role = roleFor(env, row.email, row.role);
  return row;
}

async function issueSession(env, email) {
  const raw = newSessionToken();
  const expires = now() + CFG.SESSION_DAYS * 86400000;
  await env.DB.prepare("INSERT INTO sessions (token, email, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256(raw), email, now(), expires).run();
  return { token: raw, expiresAt: expires };
}

/* Отметка о согласии хранится строкой, а не числом миллисекунд, как
   остальные времена в базе. Причина простая: это доказательство, и
   его читают люди — в выгрузке, в переписке, при проверке. Секунды
   достаточно: точнее момент согласия никого не интересует. */
const consentStamp = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

export async function register(request, env, origin) {
  const b = await request.json().catch(() => ({}));
  const email = normEmail(b.email);
  const name = String(b.name || "").trim().slice(0, 80);
  const password = String(b.password || "");

  if (name.length < 2) return fail(env, origin, "Укажите имя (минимум 2 символа)");
  if (!validEmail(email)) return fail(env, origin, "Некорректный email");
  /* Только российская почта: письма сервиса не должны уходить за
     границу. Подробности — у ruEmail в lib.js. */
  if (!ruEmail(email))
    return fail(env, origin, "Нужна российская почта: mail.ru, Яндекс, Рамблер, VK или ваш домен в зоне .ru. " +
      "Письма сервиса не должны уходить за границу. Если у вас корпоративная почта на другом домене — напишите нам, заведём аккаунт вручную");
  if (password.length < 8) return fail(env, origin, "Пароль минимум 8 символов");

  /* Согласие на обработку данных проверяем здесь, а не только в форме.
     Галочка в браузере ничего не доказывает: её можно не ставить, если
     обратиться к API напрямую, — и до сих пор регистрация в этом случае
     проходила. Доказывать получение согласия обязан оператор (часть 1
     статьи 9 152-ФЗ), поэтому отметку сохраняем вместе с редакцией
     политики, на которую человек соглашался. */
  if (b.consent !== true)
    return fail(env, origin, "Без согласия на обработку персональных данных регистрация невозможна");

  const exists = await env.DB.prepare("SELECT email FROM users WHERE email = ?").bind(email).first();
  if (exists) return fail(env, origin, "Аккаунт с таким email уже зарегистрирован", 409);

  const role = roleFor(env, email);
  await env.DB.prepare(
    `INSERT INTO users (email, name, pass_hash, role, plan, pro_until, created_at, last_login_at,
                        consent_at, consent_doc)
     VALUES (?, ?, ?, ?, 'free', NULL, ?, ?, ?, ?)`
  ).bind(email, name, await hashPassword(password), role, now(), now(),
         consentStamp(), CFG.POLICY_VERSION).run();

  await logAction(env, email, role === "user" ? "Регистрация аккаунта" : `Регистрация (${role})`);
  /* Отдельной строкой в журнале — чтобы согласие было видно и там, где
     человек смотрит свою историю действий, а не только в служебном поле. */
  await logAction(env, email, `Согласие на обработку персональных данных (редакция политики от ${CFG.POLICY_VERSION})`);
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
  if (!row || !ok) {
    /* Промах — вот теперь списываем попытку. */
    await penalize(env, request, "login", email);
    return fail(env, origin, "Неверный email или пароль", 401);
  }
  /* Вошёл — счётчик обнуляем: прошлые опечатки больше не висят над человеком. */
  await forgive(env, request, "login", email);

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
  /* scope-ok: токен и есть удостоверение — знающий его владеет сессией.
     Проверка почты ничего не добавила бы. */
  if (raw) await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(await sha256(raw)).run();
  return json(env, origin, { ok: true });
}

/* Набор оформлений. Зелёный и морская волна остаются основой сервиса,
   остальные — вариации в той же логике: один акцент, два оттенка градиента.
   Свободный выбор цвета намеренно не даём: половина подобранных вручную
   пар оказывается нечитаемой в одной из тем. */
/* Список тем держим и на сервере: он решает, что вообще можно сохранить.
   Сами цвета живут на клиенте (js/themes.js) — серверу они не нужны,
   ему достаточно знать перечень допустимых значений. */
export const THEME_IDS = [
  "", "default", "graphite", "ocean", "forest", "sand",
  "indigo", "plum", "clay", "steel", "moss",
];

/* GET /api/themes — что выбрано и открыт ли выбор. */
export async function listThemes(request, env, origin, user) {
  const { hasFeature } = await import("./plans.js");
  return json(env, origin, {
    allowed: hasFeature(user, "theming"),
    current: user.theme_accent || "",
    ids: THEME_IDS,
  });
}

/* POST /api/themes {id} — возможность тарифа «Про». */
/* POST /api/digest {off} — включить или выключить сводку недели.
   Отдельной ручкой, а не внутри профиля: человек ищет её там, где
   отключают уведомления, а не там, где меняют имя. */
export async function setDigest(request, env, origin, user) {
  const b = await request.json().catch(() => ({}));
  const off = b.off ? 1 : 0;
  await env.DB.prepare("UPDATE users SET digest_off = ? WHERE email = ?")
    .bind(off, user.email).run();
  await logAction(env, user.email, off ? "Сводка недели отключена" : "Сводка недели включена");
  return json(env, origin, { off: Boolean(off) });
}

export async function setTheme(request, env, origin, user) {
  const { hasFeature } = await import("./plans.js");
  const b = await request.json().catch(() => ({}));
  const id = String(b.id || "");

  if (!THEME_IDS.includes(id)) return fail(env, origin, "Такой темы нет", 404);
  /* Вернуться к оформлению сервиса можно всегда — иначе человек,
     у которого закончилась подписка, застрял бы с чужим цветом. */
  if (id !== "" && id !== "default" && !hasFeature(user, "theming")) {
    return json(env, origin, {
      error: "Свои темы оформления входят в тариф «Про»",
      paywall: true, kind: "theming",
    }, 402);
  }

  await env.DB.prepare("UPDATE users SET theme_accent = ? WHERE email = ?").bind(id, user.email).run();
  return json(env, origin, { current: id });
}

export async function updateProfile(request, env, origin, user) {
  const b = await request.json().catch(() => ({}));
  const name = String(b.name ?? user.name).trim().slice(0, 80);
  const avatar = normalizeAvatar(b.avatar, user.avatar || "");
  if (name.length < 2) return fail(env, origin, "Имя слишком короткое");
  if (avatar === null)
    return fail(env, origin, "Фото не подошло: нужен JPEG, PNG или WebP до 45 КБ после сжатия");

  /* Профиль: ответы знакомства и мастера календаря. Принимаем только
     известные поля с известными значениями — это данные из браузера, и
     класть их в базу как есть нельзя. Отсутствующее поле не стирает
     сохранённое: мастер календаря шлёт свои три ключа и не должен
     затирать ответы про сферу и цель. */
  const ALLOWED = {
    status: ["self", "ip", "ooo", "person", "start"],
    sphere: ["services", "trade", "it", "build", "other"],
    goal: ["tax", "docs", "money", "learn"],
    who: ["ip", "ooo", "self", "person"],
    mode: ["usn", "patent", "npd", "osno", "ausn", "none"],
  };
  let profile = user.profile ? (() => { try { return JSON.parse(user.profile); } catch { return {}; } })() : {};
  if (profile === null || typeof profile !== "object") profile = {};
  if (b.profile && typeof b.profile === "object") {
    for (const [k, list] of Object.entries(ALLOWED)) {
      if (list.includes(b.profile[k])) profile[k] = b.profile[k];
    }
    if (typeof b.profile.staff === "boolean") profile.staff = b.profile.staff;
  }
  const profileText = Object.keys(profile).length ? JSON.stringify(profile) : "";

  await env.DB.prepare("UPDATE users SET name = ?, avatar = ?, profile = ? WHERE email = ?")
    .bind(name, avatar, profileText, user.email).run();
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

/* POST /api/auth/delete — удаление аккаунта.

   Раньше отсюда исчезали четыре таблицы из пятнадцати. Всё остальное —
   напоминания, уведомления, заметки, сохранённые расчёты, история
   вопросов к ИИ, привязка к Telegram, операции с баллами — оставалось
   в базе навсегда, вместе с почтой человека.

   Это не мелочь. 152-ФЗ (ст. 14) даёт человеку право потребовать
   удаления своих данных, а сервис оформляется на ИП с уведомлением
   в РКН — то есть отвечает за это по закону. Кнопка «удалить аккаунт»,
   которая удаляет четверть данных, хуже отсутствующей: она обещает то,
   чего не делает.

   Два исключения, и оба намеренные:

   payments — записи об оплатах остаются, но обезличиваются. Первичные
   документы по расчётам организация обязана хранить пять лет (ФЗ-402,
   ст. 29), и выручка в отчётности не должна проседать задним числом от
   того, что кто-то удалил аккаунт. Сумма и дата — не персональные данные,
   как только от них отвязана личность.

   public_qa — опубликованные ответы остаются в ленте, тоже без почты:
   человек соглашался на публикацию, и лента — общее знание, а не его
   личная страница. Неопубликованные (ожидающие и отклонённые) удаляются
   целиком: их никто не видел и согласия на них никто не давал.

   ВАЖНО при добавлении нового раздела: таблицу с полем email надо
   вписать сюда сразу. Забыть легко — список ниже длинный и на глаз
   выглядит полным. Ровно это и случилось с book_ops: раздел появился,
   в удаление не попал, и поймала это только проверка в
   tests/profile_test.mjs, которая заводит тот же адрес заново и смотрит,
   не прицепились ли к нему прежние данные. Не убирайте её.             */
export async function deleteAccount(request, env, origin, user) {
  if (user.role === "admin" || user.role === "owner")
    return fail(env, origin,
      "Аккаунт с правами администратора нельзя удалить из кабинета — сначала снимите права", 403);

  const e = user.email;
  const P = sql => env.DB.prepare(sql).bind(e);

  /* Отметки об отправленных напоминаниях связаны не почтой, а номером
     напоминания, поэтому чистим их ДО самих напоминаний: после удаления
     подзапрос уже ничего не найдёт, и строки остались бы висеть. */
  await env.DB.prepare(
    "DELETE FROM reminder_sent WHERE reminder_id IN (SELECT id FROM reminders WHERE email = ?)"
  ).bind(e).run().catch(() => {});

  await env.DB.batch([
    P("DELETE FROM sessions      WHERE email = ?"),
    P("DELETE FROM usage         WHERE email = ?"),
    P("DELETE FROM actions       WHERE email = ?"),
    P("DELETE FROM reminders     WHERE email = ?"),
    P("DELETE FROM notifications WHERE email = ?"),
    P("DELETE FROM ai_jobs       WHERE email = ?"),
    P("DELETE FROM point_ops     WHERE email = ?"),
    P("DELETE FROM progress      WHERE email = ?"),
    P("DELETE FROM saved_calcs   WHERE email = ?"),
    P("DELETE FROM tg_link_codes WHERE email = ?"),
    P("DELETE FROM qa_useful     WHERE email = ?"),
    P("DELETE FROM book_ops      WHERE email = ?"),
    /* Документы удаляются вместе с аккаунтом: в них лежат тексты
       договоров и счетов с данными контрагентов. Оставить их после
       отзыва согласия — прямое нарушение ст. 21 152-ФЗ. */
    P("DELETE FROM documents     WHERE email = ?"),
    P("DELETE FROM counterparties WHERE email = ?"),
    P("DELETE FROM doc_numbers   WHERE email = ?"),
    P("DELETE FROM doc_numbers2  WHERE email = ?"),
    P("DELETE FROM my_orgs       WHERE email = ?"),
    env.DB.prepare("DELETE FROM clients WHERE owner = ?").bind(e),
    P("DELETE FROM public_qa     WHERE email = ? AND status != 'published'"),

    /* Обезличиваем то, что обязаны сохранить. */
    env.DB.prepare("UPDATE public_qa SET email = 'удалён' WHERE email = ?").bind(e),
    env.DB.prepare("UPDATE payments  SET email = 'удалён' WHERE email = ?").bind(e),

    /* Приглашённые этим человеком не должны остаться со ссылкой
       в никуда: иначе подсчёт приглашений будет считать пустоту. */
    env.DB.prepare("UPDATE users SET referred_by = NULL WHERE referred_by = ?").bind(e),

    P("DELETE FROM users WHERE email = ?"),
  ]);
  return json(env, origin, { ok: true });
}

/* GET /api/auth/export — все данные человека одним файлом.

   Статья 14 152-ФЗ даёт субъекту право получить сведения об обработке
   своих данных, и политика сервиса обещает «экспорт всех ваших данных
   одним файлом». До сих пор кнопка выгружала только то, что лежало в
   браузере: профиль, отметки копилки, курсы. Всё, что хранит сервер —
   учёт доходов, документы, сроки, контрагенты, история вопросов, — в
   файл не попадало, то есть обещание не выполнялось.

   Собираем на сервере, потому что только он знает всё. Пароль и токены
   не отдаём: их хэши бесполезны субъекту и опасны в файле, который
   человек перешлёт себе на почту.                                   */

/* POST /api/auth/consent — подтверждение согласия задним числом
   не бывает, поэтому здесь ставится честное «сейчас».

   Эта ручка нужна только тем, у кого отметки нет. Повторно нажать
   нельзя: если согласие уже записано, дата остаётся прежней. Иначе
   получилось бы, что при каждом входе оно «обновляется», и первая —
   настоящая — дата теряется. */
export async function confirmConsent(request, env, origin, user) {
  const b = await request.json().catch(() => ({}));
  if (b.consent !== true)
    return fail(env, origin, "Без согласия на обработку персональных данных продолжить нельзя");

  const row = await env.DB.prepare("SELECT consent_at FROM users WHERE email = ?")
    .bind(user.email).first();
  if (row && row.consent_at)
    return json(env, origin, { ok: true, consentAt: row.consent_at, already: true });

  const at = consentStamp();
  await env.DB.prepare("UPDATE users SET consent_at = ?, consent_doc = ? WHERE email = ?")
    .bind(at, CFG.POLICY_VERSION, user.email).run();
  await logAction(env, user.email,
    `Согласие на обработку персональных данных (редакция политики от ${CFG.POLICY_VERSION})`);

  return json(env, origin, { ok: true, consentAt: at });
}

export async function exportAll(request, env, origin, user) {
  const q = async (sql, ...args) => {
    try {
      const r = await env.DB.prepare(sql).bind(...args).all();
      return r.results || [];
    } catch {
      /* Таблица могла не появиться на старой базе — пустой раздел
         честнее, чем отказ отдать вообще всё. */
      return [];
    }
  };
  const e = user.email;

  const money = rows => rows.map(r => ({ ...r, amount: r.amount / 100 }));

  const data = {
    exported: new Date().toISOString(),
    about: "Все данные вашей учётной записи в ЭкоФине. " +
           "Пароль не включён: он хранится только в виде необратимого преобразования.",

    profile: {
      email: user.email,
      name: user.name,
      createdAt: user.created_at,
      lastLoginAt: user.last_login_at,
      plan: user.plan,
      proUntil: user.pro_until,
      points: user.points,
      profile: user.profile ? JSON.parse(user.profile || "{}") : null,
      business: { form: user.biz_form || "", regime: user.biz_regime || "", workers: user.biz_workers || 0 },
      telegram: user.tg_username || null,
      /* Согласие тоже относится к данным человека: он вправе видеть,
         когда и под какой редакцией политики оно было дано. */
      consent: user.consent_at
        ? { at: user.consent_at, policyVersion: user.consent_doc }
        : null,
    },

    documents: money(await q(
      "SELECT id, kind, title, number, doc_date, party, amount, status, content, created_at" +
      " FROM documents WHERE email = ? ORDER BY created_at", e)),

    book: money(await q(
      "SELECT id, day, kind, amount, category, party, note, payer, client_id" +
      " FROM book_ops WHERE email = ? ORDER BY day", e)),

    reminders: await q(
      "SELECT id, title, due, repeat_rule, notify_days, channel, note FROM reminders WHERE email = ?", e),

    counterparties: await q("SELECT * FROM counterparties WHERE email = ?", e),
    organisations: await q("SELECT * FROM my_orgs WHERE email = ?", e),
    clients: await q("SELECT * FROM clients WHERE owner = ?", e),

    savedCalcs: await q("SELECT * FROM saved_calcs WHERE email = ?", e),
    aiHistory: await q(
      "SELECT id, title, created_at, answer FROM ai_jobs WHERE email = ? ORDER BY created_at", e),
    notes: { text: user.notes || "", updatedAt: user.notes_at || 0 },
    progress: await q("SELECT key, data, updated_at FROM progress WHERE email = ?", e),
    points: await q("SELECT * FROM point_ops WHERE email = ?", e),
    payments: await q(
      "SELECT id, amount, status, created_at, plan FROM payments WHERE email = ?", e),
    actions: await q(
      "SELECT text, created_at FROM actions WHERE email = ? ORDER BY created_at DESC LIMIT 500", e),
  };

  return json(env, origin, data);
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

/* POST /api/auth/owner-recover {email, secret, newPassword}

   Зачем. Пароль пользователю сбрасывает администратор. Но если забыл пароль
   сам владелец — сбрасывать некому, и сервис остаётся без хозяина навсегда.
   Это аварийный ключ: работает только для адресов из OWNER_EMAILS и только
   при совпадении секрета RECOVERY_SECRET, который лежит в настройках воркера
   и известен лишь тому, кто может делать деплой. */
export async function ownerRecover(request, env, origin) {
  if (!env.RECOVERY_SECRET)
    return fail(env, origin, "Аварийное восстановление не настроено", 503);

  const b = await request.json().catch(() => ({}));
  const email = normEmail(b.email);
  const secret = String(b.secret || "");
  const next = String(b.newPassword || "");

  /* Сравнение постоянного времени: секрет нельзя подбирать по таймингам. */
  const given = await sha256(secret);
  const want = await sha256(env.RECOVERY_SECRET);
  if (given !== want) return fail(env, origin, "Неверный ключ восстановления", 403);
  /* Ключ верный — значит это владелец. Счётчик попыток обнуляем, чтобы
     опечатка в новом пароле не съела оставшиеся попытки: человек и так
     заперт снаружи, добивать его лимитом незачем. */
  await forgive(env, request, "recover", email).catch(() => {});

  if (!ownerEmails(env).includes(email))
    return fail(env, origin, "Этот адрес не значится владельцем сервиса", 403);
  if (next.length < 8) return fail(env, origin, "Пароль минимум 8 символов");

  const row = await env.DB.prepare("SELECT email FROM users WHERE email = ?").bind(email).first();
  if (!row) return fail(env, origin, "Аккаунт ещё не создан — просто зарегистрируйтесь", 404);

  await env.DB.batch([
    env.DB.prepare("UPDATE users SET pass_hash = ?, role = 'owner' WHERE email = ?")
      .bind(await hashPassword(next), email),
    env.DB.prepare("DELETE FROM sessions WHERE email = ?").bind(email),
    /* Заодно снимаем блокировку входа, иначе новый пароль тоже не пустит. */
    env.DB.prepare("DELETE FROM ratelimit WHERE bucket LIKE ?").bind(`login:key:${email}`),
  ]);
  await logAction(env, email, "Аварийное восстановление доступа владельца");
  return json(env, origin, { ok: true });
}

/* ============ Смена забытого пароля по коду из письма ============

   Пароль хранится необратимым хэшем: «напомнить» его нельзя, можно
   только заменить. Раньше замену делал администратор руками, и человек
   ждал ответа. Теперь — код из письма, но оговорки здесь важнее самой
   возможности.

   • Нет ключа почтового провайдера — нет и сброса. Форма «пришлём код»,
     после которой ничего не приходит, хуже отсутствующей: человек ждёт
     письмо вместо того, чтобы написать нам.
   • Ответ на запрос одинаковый и для существующего адреса, и для любого
     другого. Иначе форма превращается в проверку «есть ли у этого
     человека аккаунт в ЭкоФине», а это сведения о нём, которые мы
     раздавать не вправе.
   • Код шестизначный, живёт 15 минут, попыток пять. Шесть цифр
     перебираются за минуты, и только счётчик попыток отличает
     восстановление от подарка чужому аккаунту.
   • Верный код — это вход: выдаём сессию сразу, а все прежние закрываем.
     Пароль меняют и тогда, когда аккаунт увели, и чужие сессии должны
     умереть в тот же момент.                                          */

const RESET_TTL_MS = 15 * 60 * 1000;
const RESET_MAX_TRIES = 5;

/* Только цифры: код диктуют по телефону и набирают на мобильной
   клавиатуре. Буквы дали бы несколько бит стойкости и на порядок
   больше опечаток. */
function newResetCode() {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1000000;
  return String(n).padStart(6, "0");
}
const codeHash = (email, code) => sha256(`reset:${email}:${code}`);

/* Умеет ли сервис отправлять письма. Страница входа спрашивает это
   перед тем, как показать форму. */
export async function resetState(request, env, origin) {
  return json(env, origin, { mail: mailReady(env) });
}

export async function resetRequest(request, env, origin) {
  const b = await request.json().catch(() => ({}));
  const email = normEmail(b.email);
  if (!validEmail(email)) return fail(env, origin, "Неверный адрес почты");
  if (!mailReady(env)) return json(env, origin, { sent: false, mail: false });

  const row = await env.DB.prepare("SELECT email, name FROM users WHERE email = ?")
    .bind(email).first();

  if (row) {
    const code = newResetCode();
    /* Одна строка на адрес: новый запрос затирает прежний код. Иначе
       три нажатия «прислать код» дают три рабочих кода — три двери. */
    await env.DB.prepare(
      `INSERT INTO password_resets (email, code_hash, expires, tries, created)
       VALUES (?, ?, ?, 0, ?)
       ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash,
         expires = excluded.expires, tries = 0, created = excluded.created`
    ).bind(email, await codeHash(email, code), now() + RESET_TTL_MS, now()).run();

    const site = env.SITE_URL || "https://ecofin26.ru";
    const sent = await sendMail(env, {
      to: email,
      subject: `Код для смены пароля: ${code}`,
      text: [
        `Здравствуйте${row.name ? ", " + row.name : ""}.`,
        "",
        `Код для смены пароля в ЭкоФине: ${code}`,
        "Он действует 15 минут и вводится на странице входа.",
        "",
        "Если пароль меняете не вы — просто удалите это письмо. Без кода",
        "в аккаунт никто не войдёт, менять ничего не нужно.",
        "",
        "Мы никогда не спрашиваем пароль, коды из писем и данные карты",
        "ни в переписке, ни по телефону.",
        "",
        `${site}/recovery.html`,
      ].join("\n"),
    });

    if (!sent.ok) {
      /* Код без письма бесполезен и только занимает место: убираем,
         чтобы следующая попытка началась с чистого листа. */
      await env.DB.prepare("DELETE FROM password_resets WHERE email = ?")
        .bind(email).run().catch(() => {});
      return fail(env, origin, "Письмо не удалось отправить. Попробуйте позже или напишите нам", 502);
    }
    await logAction(env, email, "Запрошен код для смены пароля");
  }

  /* Ответ одинаковый независимо от того, есть такой аккаунт или нет. */
  return json(env, origin, { sent: true, mail: true });
}

export async function resetConfirm(request, env, origin) {
  const b = await request.json().catch(() => ({}));
  const email = normEmail(b.email);
  const code = String(b.code || "").replace(/\D/g, "");
  const next = String(b.newPassword || "");
  if (!validEmail(email)) return fail(env, origin, "Неверный адрес почты");
  if (next.length < 8) return fail(env, origin, "Пароль минимум 8 символов");

  const row = await env.DB.prepare("SELECT * FROM password_resets WHERE email = ?")
    .bind(email).first();
  if (!row) return fail(env, origin, "Код не запрашивали или он уже использован");

  if (row.expires < now()) {
    await env.DB.prepare("DELETE FROM password_resets WHERE email = ?").bind(email).run();
    return fail(env, origin, "Код устарел — запросите новый");
  }
  if (row.tries >= RESET_MAX_TRIES) {
    await env.DB.prepare("DELETE FROM password_resets WHERE email = ?").bind(email).run();
    return fail(env, origin, "Слишком много попыток — запросите новый код");
  }
  if ((await codeHash(email, code)) !== row.code_hash) {
    await env.DB.prepare("UPDATE password_resets SET tries = tries + 1 WHERE email = ?")
      .bind(email).run();
    const left = RESET_MAX_TRIES - row.tries - 1;
    return fail(env, origin, `Неверный код. Осталось попыток: ${left}`);
  }

  const user = await env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
  if (!user) return fail(env, origin, "Аккаунт не найден", 404);

  await env.DB.batch([
    env.DB.prepare("UPDATE users SET pass_hash = ? WHERE email = ?")
      .bind(await hashPassword(next), email),
    env.DB.prepare("DELETE FROM sessions WHERE email = ?").bind(email),
    env.DB.prepare("DELETE FROM password_resets WHERE email = ?").bind(email),
    /* Снимаем блокировку входа: иначе новый пароль тоже не пустит. */
    env.DB.prepare("DELETE FROM ratelimit WHERE bucket LIKE ?").bind(`login:key:${email}`),
  ]);
  await logAction(env, email, "Пароль изменён по коду из письма");

  const role = roleFor(env, email, user.role);
  const session = await issueSession(env, email);
  return json(env, origin, { ...session, user: publicUser({ ...user, role }) });
}
