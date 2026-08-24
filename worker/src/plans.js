/* ПравоФин — тарифы и права доступа.

   Что изменилось против одного тарифа за 490 ₽ и почему.

   1. Появился вход за 290 ₽. Прыжок с нуля сразу до 490 велик для
      самозанятого: люди уходят не потому что дорого, а потому что не с чего
      начать. Рядом с 290 цена 690 за старший тариф выглядит выбором, а не
      препятствием — и большинство берёт средний, а не уходит.

   2. Калькуляторы стали бесплатными и безлимитными. Именно они приведут
      людей из поиска. Если человек с запроса «как рассчитать больничный»
      упирается в регистрацию, он уходит, и страница проседает в выдаче.
      Запирать приманку — терять трафик, из которого и берутся платящие.

   3. Годовая скидка выросла с 17% до трети. Годовая оплата выгодна обеим
      сторонам: человек платит меньше за месяц, сервис получает деньги
      сразу и не теряет клиента весь год.

   4. Безлимиты честные, но с предохранителем: 300 обращений в сутки —
      это в разы больше любого живого сценария и при этом отсекает
      автоматический слив ключа.                                        */

export const PLANS = {
  free: {
    id: "free",
    title: "Старт",
    price: { month: 0, year: 0 },
    tagline: "Познакомиться с сервисом",
    limits: {
      aiPerDay: 3,          // вопросов консультанту в сутки
      toolUses: 1,          // пробных запусков ИИ-инструментов, всего
      analyzePerMonth: 0,   // разборы документов — только за счёт пробного запуска
      reminders: 3,
    },
    features: { telegram: false, courses: false, theming: false, priority: false },
    perks: [
      "Все калькуляторы без ограничений",
      "3 вопроса ИИ-консультанту в день",
      "3 напоминания о сроках",
      "База знаний и шаблоны документов",
    ],
  },

  basic: {
    id: "basic",
    title: "Базовый",
    price: { month: 290, year: 2490 },
    tagline: "Для самозанятых и небольших ИП",
    limits: { aiPerDay: 300, toolUses: null, analyzePerMonth: 20, reminders: null },
    features: { telegram: true, courses: false, theming: false, priority: false },
    perks: [
      "ИИ-консультант без дневного лимита",
      "20 разборов документов в месяц",
      "Напоминания без ограничений",
      "Доставка напоминаний в Telegram",
    ],
  },

  pro: {
    id: "pro",
    title: "Про",
    price: { month: 690, year: 5490 },
    tagline: "Для ИП с оборотом и компаний",
    limits: { aiPerDay: 300, toolUses: null, analyzePerMonth: null, reminders: null },
    features: { telegram: true, courses: true, theming: true, priority: true },
    perks: [
      "Всё из Базового без ограничений",
      "Разбор документов и фотографий без лимита",
      "Все курсы и сертификаты",
      "Оформление сайта под себя",
      "Приоритетная очередь к ИИ",
    ],
  },
};

/* Тариф «Бухгалтер» пока обслуживаем вручную: несколько клиентов в одном
   кабинете ещё не сделаны, и продавать то, чего нет, нельзя. Показываем
   как «по запросу» — это заодно честный способ проверить спрос. */
export const ENTERPRISE = {
  title: "Бухгалтер",
  price: "от 2 490 ₽/мес",
  tagline: "Ведёте несколько клиентов",
  perks: [
    "До 50 клиентов в одном кабинете",
    "Общий календарь сроков по всем",
    "Выгрузки и отчёты",
  ],
  contact: true,
};

export const PERIOD_DAYS = { month: 30, year: 365 };

/* Скидка годовой оплаты — считаем, а не пишем руками: цифра в интерфейсе
   не сможет разойтись с настоящей ценой. */
export function yearlyDiscount(planId) {
  const p = PLANS[planId];
  if (!p || !p.price.month) return 0;
  return Math.round((1 - p.price.year / (p.price.month * 12)) * 100);
}

/* Действующий тариф пользователя. Админ и владелец получают старший
   по роли, без оплаты. Истёкшая подписка возвращает на «Старт». */
export function tierOf(row) {
  if (!row) return "free";
  if (row.role === "admin" || row.role === "owner") return "pro";
  const t = row.plan;
  if (t !== "basic" && t !== "pro") return "free";
  if (row.pro_until && row.pro_until <= Date.now()) return "free";
  return t;
}

export const planOf = row => PLANS[tierOf(row)] || PLANS.free;

/* Есть ли у человека платная подписка. Оставлено под старым смыслом,
   чтобы не переписывать все проверки разом. */
export const isPaid = row => tierOf(row) !== "free";

export function limitOf(row, name) {
  return planOf(row).limits[name];
}

export function hasFeature(row, name) {
  return Boolean(planOf(row).features[name]);
}

/* Публичный список тарифов для страницы цен и окна оплаты. */
export function publicPlans() {
  return {
    plans: Object.values(PLANS).map(p => ({
      id: p.id,
      title: p.title,
      tagline: p.tagline,
      price: p.price,
      yearDiscount: yearlyDiscount(p.id),
      perks: p.perks,
      limits: p.limits,
      features: p.features,
    })),
    enterprise: ENTERPRISE,
  };
}
