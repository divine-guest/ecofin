/* ============ Прогресс: серия, курсы, практикум, траты ============

   Зачем это появилось. На странице входа написано: «войдите теми же
   почтой и паролем с телефона — подписка, документы и прогресс будут
   на месте». Для подписки и расчётов это было правдой, а для
   «Копилки», уроков курсов, результатов практикума и дневника трат —
   нет: они жили в памяти браузера.

   Последствие видно сразу: человек копил серию дней на телефоне,
   зашёл с компьютера — серия ноль. Серия дней и есть тот самый
   ежедневный крючок, ради которого сюда возвращаются, и он рвался
   при первом же переходе на другое устройство.

   Устройство простое: одна таблица «ключ → данные» на человека.
   Отдельные таблицы под каждый вид прогресса были бы честнее, но
   стоили бы пяти миграций и пяти наборов запросов там, где смысл
   один — «сохранить состояние и отдать обратно».

   Слияние делает КЛИЕНТ, а не сервер, и делает его так, чтобы данные
   только прибавлялись: отметки дней объединяются, пройденные уроки
   объединяются, лучший результат берётся больший. При таком правиле
   порядок прихода данных не важен, и одновременная работа с двух
   устройств ничего не затирает.                                     */

import { json, fail, now } from "./lib.js";

/* Что разрешено хранить. Белый список, а не «любой ключ»: иначе
   таблица со временем превратится в свалку чужих экспериментов. */
const KEYS = {
  habits:   30 * 1024,   // отметки «Копилки» по дням
  courses:  20 * 1024,   // пройденные уроки по курсам
  scores:   10 * 1024,   // лучшие результаты практикума
  read:     30 * 1024,   // прочитанные статьи базы знаний
  expenses: 200 * 1024,  // дневник трат — самый объёмный
  prefs:    20 * 1024,   // ответы онбординга и настройки отображения
};

/* GET /api/progress — всё сразу: кабинет открывается один раз,
   и шесть отдельных запросов на старте были бы шестью задержками. */
export async function getAll(request, env, origin, user) {
  const rows = await env.DB.prepare(
    "SELECT key, data, updated_at FROM progress WHERE email = ?"
  ).bind(user.email).all();

  const out = {};
  for (const r of rows.results || []) {
    if (!(r.key in KEYS)) continue;
    try { out[r.key] = { data: JSON.parse(r.data), updatedAt: r.updated_at }; }
    catch { /* повреждённую запись просто не отдаём */ }
  }
  return json(env, origin, { items: out });
}

/* POST /api/progress {key, data} — сохранить одно состояние. */
export async function put(request, env, origin, user) {
  const b = await request.json().catch(() => ({}));
  const key = String(b.key || "");
  if (!(key in KEYS)) return fail(env, origin, "Неизвестный вид прогресса");

  const text = JSON.stringify(b.data === undefined ? null : b.data);
  if (text.length > KEYS[key]) {
    return fail(env, origin, "Слишком много данных для сохранения", 413);
  }

  await env.DB.prepare(
    `INSERT INTO progress (email, key, data, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(email, key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`
  ).bind(user.email, key, text, now()).run();

  return json(env, origin, { ok: true, updatedAt: now() });
}

/* POST /api/progress/clear {key} — забыть один вид прогресса.
   Нужен для настроек: «сбросить дневник трат» без удаления аккаунта. */
export async function clear(request, env, origin, user) {
  const b = await request.json().catch(() => ({}));
  const key = String(b.key || "");
  if (!(key in KEYS)) return fail(env, origin, "Неизвестный вид прогресса");
  await env.DB.prepare("DELETE FROM progress WHERE email = ? AND key = ?")
    .bind(user.email, key).run();
  return json(env, origin, { ok: true });
}
