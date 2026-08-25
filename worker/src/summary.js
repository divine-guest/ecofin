/* ============ Итоги и достижения ============

   Человек не помнит, что сделал за полгода, и потому не чувствует, за
   что платит. Сводка показывает это его же цифрами — и заодно
   отвечает на вопрос «стоит ли продлевать», не уговаривая.

   Всё считается по фактическим записям. Единственная оценочная
   величина — сколько стоила бы та же работа у специалиста; она прямо
   помечена как оценка, а ставки вынесены в константы, чтобы их можно
   было поправить одним движением.                                    */

import { json } from "./lib.js";
import { codeFor } from "./referral.js";

/* Средние рыночные ставки. Намеренно взяты по нижней границе: лучше
   недооценить, чем потом объяснять, откуда взялась красивая цифра. */
const PRICE = {
  question: 700,    // короткая устная консультация
  analyze: 2500,    // проверка договора юристом
  document: 1500,   // составление типового документа
  calc: 500,        // расчёт у бухгалтера
};

/* Достижения привязаны к действиям, а не к времени: «зашёл 7 дней
   подряд» ничего не говорит о пользе. */
const BADGES = [
  { id: "first_q", title: "Первый вопрос", need: 1, of: "questions",
    text: "Задали первый вопрос консультанту" },
  { id: "q10", title: "Разговорились", need: 10, of: "questions",
    text: "10 вопросов консультанту" },
  { id: "q50", title: "Постоянный клиент", need: 50, of: "questions",
    text: "50 вопросов консультанту" },
  { id: "first_doc", title: "Первый разбор", need: 1, of: "analyzed",
    text: "Разобрали первый документ" },
  { id: "doc10", title: "Читает между строк", need: 10, of: "analyzed",
    text: "10 разобранных документов" },
  { id: "first_calc", title: "Посчитано", need: 1, of: "savedCalcs",
    text: "Сохранили первый расчёт" },
  { id: "calc5", title: "Всё под рукой", need: 5, of: "savedCalcs",
    text: "5 сохранённых расчётов" },
  { id: "first_rem", title: "Не забуду", need: 1, of: "reminders",
    text: "Поставили первое напоминание о сроке" },
  { id: "rem5", title: "Под контролем", need: 5, of: "reminders",
    text: "5 напоминаний о сроках" },
  { id: "kept", title: "Ни одного пропуска", need: 3, of: "remindersSent",
    text: "Три раза сервис напомнил о сроке вовремя" },
  { id: "shared", title: "Поделился", need: 1, of: "published",
    text: "Ваш разбор опубликован в общей ленте" },
  { id: "invited", title: "Привёл друга", need: 1, of: "invited",
    text: "По вашей ссылке кто-то зарегистрировался" },
];

/* GET /api/summary — сводка и достижения. */
export async function summary(request, env, origin, user) {
  const one = async (sql, ...bind) =>
    Number((await env.DB.prepare(sql).bind(...bind).first())?.n || 0);

  const questions = await one(
    "SELECT COUNT(*) AS n FROM ai_jobs WHERE email = ? AND kind = 'chat' AND status = 'done'", user.email);
  const toolRuns = await one(
    "SELECT COUNT(*) AS n FROM ai_jobs WHERE email = ? AND kind = 'tool' AND status = 'done'", user.email);
  const analyzed = await one(
    "SELECT COALESCE(SUM(n), 0) AS n FROM usage WHERE email = ? AND kind = 'analyze'", user.email);
  const savedCalcs = await one(
    "SELECT COUNT(*) AS n FROM saved_calcs WHERE email = ?", user.email);
  const reminders = await one(
    "SELECT COUNT(*) AS n FROM reminders WHERE email = ?", user.email);
  /* У reminder_sent нет колонки email — только ссылка на напоминание,
     поэтому считаем через связь. */
  const remindersSent = await one(
    `SELECT COUNT(*) AS n FROM reminder_sent s
       JOIN reminders r ON r.id = s.reminder_id
      WHERE r.email = ?`, user.email);
  const published = await one(
    "SELECT COUNT(*) AS n FROM public_qa WHERE email = ? AND status = 'published'", user.email);
  /* Колонка называется referred_by — хранит код пригласившего,
     а не его почту, поэтому считаем по коду. */
  const myCode = codeFor(user.email);
  const invited = await one(
    "SELECT COUNT(*) AS n FROM users WHERE referred_by = ?", myCode);
  const actions = await one(
    "SELECT COUNT(*) AS n FROM actions WHERE email = ?", user.email);

  const days = user.created_at
    ? Math.max(1, Math.round((Date.now() - user.created_at) / 86400000)) : 1;

  /* Оценка, а не факт: так и подписано на экране. */
  const saved = questions * PRICE.question
    + analyzed * PRICE.analyze
    + toolRuns * PRICE.document
    + savedCalcs * PRICE.calc;

  const stats = { questions, toolRuns, analyzed, savedCalcs, reminders,
                  remindersSent, published, invited, actions, days };

  const badges = BADGES.map(b => {
    const have = Number(stats[b.of] || 0);
    return {
      id: b.id, title: b.title, text: b.text,
      done: have >= b.need,
      have: Math.min(have, b.need), need: b.need,
    };
  });

  return json(env, origin, {
    stats, saved, prices: PRICE,
    badges,
    earned: badges.filter(b => b.done).length,
    total: badges.length,
  });
}
