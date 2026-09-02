/* ============ ЭкоФин — ставки, лимиты и базы ============

   ВСЕ числа, которые меняет законодатель, живут только здесь.
   Меняется норма — правится одна строка, а не пять калькуляторов.

   ⚠️ ОБЯЗАТЕЛЬНО сверяйте значения перед началом каждого года:
   НК РФ ст. 430 (взносы), ст. 224 (НДФЛ), ст. 346.12–346.13 (УСН),
   постановление Правительства о предельных базах (больничные).
   Источники: nalog.gov.ru, sfr.gov.ru, КонсультантПлюс.                */

const RATES = {
  /* Дата, на которую значения ниже были сверены с первоисточником.
     Показывается пользователю рядом с результатами расчётов. */
  checkedOn: "2026-08-23",
  year: 2026,

  /* --- Страховые взносы ИП «за себя», НК РФ ст. 430 --- */
  ipContributions: {
    fixed: 57390,          // фиксированная часть за полный год
    extraRate: 0.01,       // 1% с дохода сверх порога
    extraThreshold: 300000,
    extraCap: 321818,      // потолок переменной части
  },

  /* --- НПД (самозанятость), 422-ФЗ --- */
  npd: {
    limit: 2400000,        // лимит дохода в год
    ratePersons: 0.04,     // с доходов от физлиц
    rateCompanies: 0.06,   // с доходов от юрлиц и ИП
  },

  /* --- УСН, гл. 26.2 НК РФ --- */
  usn: {
    incomeRate: 0.06,      // «Доходы»
    profitRate: 0.15,      // «Доходы минус расходы»
    minTaxRate: 0.01,      // минимальный налог на «Доходы минус расходы»
    limit: 450000000,      // предел для применения УСН
    vatThreshold: 60000000,// с этого дохода на УСН появляется НДС
  },


  /* --- Патент (ПСН), гл. 26.5 НК РФ ---
     Налог считается от потенциально возможного дохода, который
     устанавливает регион, а не от фактической выручки. Единой цифры
     нет — её берут из закона субъекта. */
  psn: {
    rate: 0.06,
    incomeLimit: 60000000,   // лимит фактического дохода
    workersLimit: 15,
  },

  /* --- АУСН, 17-ФЗ ---
     Взносы за себя и обычные взносы за работников не платятся: вместо
     них фиксированный взнос на травматизм. Режим действует не во всех
     регионах — проверять по своему. */
  ausn: {
    incomeRate: 0.08,
    profitRate: 0.20,
    minTaxRate: 0.03,
    incomeLimit: 60000000,
    workersLimit: 5,
    injuryFixed: 2750,       // фиксированный взнос на травматизм за год
  },

  /* --- ЕСХН, гл. 26.1 НК РФ ---
     Только для сельхозпроизводителей: не менее 70% дохода от
     сельхоздеятельности. */
  eshn: {
    rate: 0.06,
    vatExemptUpTo: 60000000, // до этого дохода можно не платить НДС
  },

  /* --- ОСНО --- */
  osno: {
    profitTaxRate: 0.25,     // налог на прибыль организаций с 2025 г.
    proDeduction: 0.20,      // профвычет ИП без подтверждённых расходов
  },

  /* --- НДФЛ с трудовых доходов: пятиступенчатая шкала с 2025 г. --- */
  ndflScale: [
    { upTo: 2400000, rate: 0.13 },
    { upTo: 5000000, rate: 0.15 },
    { upTo: 20000000, rate: 0.18 },
    { upTo: 50000000, rate: 0.20 },
    { upTo: Infinity, rate: 0.22 },
  ],

  /* --- НДФЛ с дивидендов: отдельная двухступенчатая шкала --- */
  dividendScale: [
    { upTo: 2400000, rate: 0.13 },
    { upTo: Infinity, rate: 0.15 },
  ],

  /* --- Больничные: предельные базы двух предшествующих лет --- */
  sickLeave: {
    baseYears: [2024, 2025],
    bases: [2225000, 2759000],
    days: 730,
    minWageMonth: 27093,   // МРОТ: нижняя граница пособия
  },

  /* --- Вычеты по НДФЛ --- */
  deductions: {
    socialLimit: 150000,   // социальный вычет, годовой лимит
    educationChild: 110000,
    propertyBuy: 2000000,
    propertyMortgage: 3000000,
  },

  vatRate: 0.20,

  /* --- Взносы работодателя за сотрудника, НК РФ ст. 425, 427 ---
     Единый тариф применяется к выплатам нарастающим итогом: до
     предельной базы — полная ставка, сверх неё — пониженная.
     Малый и средний бизнес платит по льготной схеме: с части
     в пределах МРОТ — полный тариф, со всего, что выше, — 15%. */
  payrollContrib: {
    base: 2759000,        // предельная база текущего года
    rate: 0.30,           // единый тариф до базы
    rateOverBase: 0.151,  // сверх базы
    smallRateOverMrot: 0.15, // МСП: с превышения МРОТ
    injuryMin: 0.002,     // травматизм: I класс риска
    injuryMax: 0.085,     // травматизм: XXXII класс риска
  },

  /* --- Стандартные вычеты на детей, НК РФ ст. 218 ---
     Применяются ежемесячно, пока доход с начала года не превысит предел. */
  childDeduction: {
    first: 1400,
    second: 2800,
    thirdPlus: 6000,
    disabledChild: 12000,   // родителю или усыновителю
    incomeLimit: 450000,    // предел дохода нарастающим итогом
  },

  /* --- НДС: ставки, гл. 21 НК РФ ---
     5% и 7% — пониженные ставки для УСН при доходе выше порога
     освобождения; при них нельзя принимать входной НДС к вычету. */
  vatRates: [
    { value: 0.20, label: "20% — основная" },
    { value: 0.10, label: "10% — продукты, детские товары, лекарства, книги" },
    { value: 0.07, label: "7% — УСН, доход свыше 250 млн" },
    { value: 0.05, label: "5% — УСН, доход от 60 до 250 млн" },
    { value: 0, label: "0% — экспорт и международные перевозки" },
  ],

  /* --- Госпошлина в суд общей юрисдикции по имущественным искам,
     НК РФ ст. 333.19 (редакция с 09.09.2024) ---
     Ступени: до какой цены иска, фиксированная часть, процент
     с суммы сверх нижней границы ступени. */
  courtFee: {
    steps: [
      { upTo: 100000,    base: 4000,   rate: 0,      from: 0 },
      { upTo: 300000,    base: 4000,   rate: 0.03,   from: 100000 },
      { upTo: 500000,    base: 10000,  rate: 0.025,  from: 300000 },
      { upTo: 1000000,   base: 15000,  rate: 0.02,   from: 500000 },
      { upTo: 3000000,   base: 25000,  rate: 0.01,   from: 1000000 },
      { upTo: 8000000,   base: 45000,  rate: 0.007,  from: 3000000 },
      { upTo: 24000000,  base: 80000,  rate: 0.0035, from: 8000000 },
      { upTo: 50000000,  base: 136000, rate: 0.003,  from: 24000000 },
      { upTo: 100000000, base: 214000, rate: 0.002,  from: 50000000 },
      { upTo: Infinity,  base: 314000, rate: 0.0015, from: 100000000 },
    ],
    cap: 900000,          // выше этой суммы пошлина не растёт
    nonProperty: 3000,    // неимущественный иск, физлицо
    nonPropertyOrg: 20000, // неимущественный иск, организация
  },

  /* Среднемесячное число календарных дней — ТК РФ ст. 139.
     Используется и в отпускных, и в компенсации при увольнении. */
  avgMonthDays: 29.3,


  /* ---------- Производные величины и расчёты ---------- */

  /* Взносы ИП за себя при заданном годовом доходе. */
  contributions(income) {
    const c = this.ipContributions;
    const extra = Math.min(c.extraCap, Math.max(0, income - c.extraThreshold) * c.extraRate);
    return c.fixed + extra;
  },

  /* Налог по прогрессивной шкале: ступени применяются к части дохода,
     а не ко всей сумме — это самая частая ошибка в таких калькуляторах. */
  progressive(amount, scale) {
    let tax = 0, prev = 0;
    for (const step of scale) {
      if (amount <= prev) break;
      tax += (Math.min(amount, step.upTo) - prev) * step.rate;
      prev = step.upTo;
    }
    return tax;
  },

  ndfl(amount) { return this.progressive(amount, this.ndflScale); },

  /* Сравнение систем налогообложения.
     Возвращает список: название, сумма к уплате за год, пояснение и
     доступность. Взносы включены в итог у всех режимов, где они есть, —
     иначе сравнение было бы нечестным.

     who: "ip" | "ooo" | "self"   psnPotential — потенциальный доход по патенту */
  compareRegimes({ income = 0, expenses = 0, workers = 0, who = "ip",
                   psnPotential = 0, agro = false } = {}) {
    const out = [];
    const contrib = this.contributions(income);
    const isIp = who === "ip" || who === "self";
    /* Без работников взносы гасят налог полностью, с работниками — вдвое. */
    const deductible = workers > 0 ? contrib / 2 : contrib;

    const add = (id, name, total, note, why) =>
      out.push({ id, name, total, note, available: total !== null, why });

    /* НПД — только физлицо или ИП без работников. */
    if (who !== "ooo") {
      const ok = workers === 0 && income <= this.npd.limit;
      add("npd", "НПД (самозанятость)",
        ok ? income * this.npd.rateCompanies : null,
        `${this.npd.rateCompanies * 100}% с юрлиц, 4% с физлиц. Взносов нет, отчётности нет`,
        ok ? "" : (workers > 0 ? "нельзя нанимать работников"
                               : `доход выше ${(this.npd.limit / 1e6).toFixed(1)} млн ₽`));
    }

    /* УСН «Доходы». */
    add("usn6", "УСН «Доходы» 6%",
      Math.max(0, income * this.usn.incomeRate - (isIp ? deductible : 0)) + (isIp ? contrib : 0),
      isIp ? `налог минус взносы ${workers > 0 ? "(до 50%)" : "(полностью)"} + сами взносы ${Math.round(contrib).toLocaleString("ru-RU")} ₽`
           : "6% с выручки", "");

    /* УСН «Доходы минус расходы» — с минимальным налогом 1%. */
    const usn15 = Math.max((income - expenses) * this.usn.profitRate,
                           income * this.usn.minTaxRate) + (isIp ? contrib : 0);
    add("usn15", "УСН «Доходы − расходы» 15%", usn15,
      `не меньше 1% с дохода${isIp ? " + взносы" : ""}`, "");

    /* Патент — считается от потенциального дохода региона. */
    if (isIp) {
      const ok = income <= this.psn.incomeLimit && workers <= this.psn.workersLimit && psnPotential > 0;
      add("psn", "Патент (ПСН)",
        ok ? psnPotential * this.psn.rate + contrib : null,
        `6% от потенциального дохода региона${psnPotential ? "" : " — введите его"} + взносы`,
        income > this.psn.incomeLimit ? `доход выше ${this.psn.incomeLimit / 1e6} млн ₽`
          : workers > this.psn.workersLimit ? `больше ${this.psn.workersLimit} работников`
          : psnPotential > 0 ? "" : "нужен потенциальный доход из закона региона");
    }

    /* АУСН — без взносов, но с ограничениями и не во всех регионах. */
    const ausnOk = income <= this.ausn.incomeLimit && workers <= this.ausn.workersLimit;
    const ausnIncome = income * this.ausn.incomeRate + this.ausn.injuryFixed;
    const ausnProfit = Math.max((income - expenses) * this.ausn.profitRate,
                                income * this.ausn.minTaxRate) + this.ausn.injuryFixed;
    add("ausn", "АУСН 8%", ausnOk ? ausnIncome : null,
      "страховых взносов нет, отчётности почти нет. Не во всех регионах",
      ausnOk ? "" : (income > this.ausn.incomeLimit ? "доход выше 60 млн ₽"
                                                    : `больше ${this.ausn.workersLimit} работников`));
    add("ausnProfit", "АУСН 20% с прибыли", ausnOk ? ausnProfit : null,
      "не меньше 3% с дохода, взносов нет", ausnOk ? "" : "те же ограничения");

    /* ЕСХН — только сельхозпроизводителям. */
    if (agro) {
      add("eshn", "ЕСХН 6%",
        Math.max(0, income - expenses) * this.eshn.rate + (isIp ? contrib : 0),
        `6% с прибыли${isIp ? " + взносы" : ""}. НДС можно не платить при доходе до ${this.eshn.vatExemptUpTo / 1e6} млн ₽`, "");
    }

    /* ОСНО — считаем без НДС: он перекладывается на покупателя.
       Зато прямо предупреждаем, что он появляется. */
    if (who === "ooo") {
      add("osno", "ОСНО (налог на прибыль)",
        Math.max(0, income - expenses) * this.osno.profitTaxRate,
        `${this.osno.profitTaxRate * 100}% с прибыли, сверху НДС 20%`, "");
    } else {
      const base = expenses > 0 ? Math.max(0, income - expenses)
                                : income * (1 - this.osno.proDeduction);
      add("osno", "ОСНО (НДФЛ)", this.ndfl(base) + contrib,
        expenses > 0 ? "НДФЛ с прибыли + взносы, сверху НДС 20%"
                     : `НДФЛ с дохода за вычетом ${this.osno.proDeduction * 100}% профвычета + взносы, сверху НДС 20%`, "");
    }

    return out;
  },


  /* Взносы работодателя за год с указанной годовой зарплаты.
     small — малое или среднее предприятие (льготный тариф). */
  employerContrib(yearSalary, { small = true, injury = 0.002, mrotMonth = 27093 } = {}) {
    const c = this.payrollContrib;
    if (small) {
      /* Льгота считается помесячно: полный тариф с МРОТ, 15% с остального. */
      const perMonth = yearSalary / 12;
      const atFull = Math.min(perMonth, mrotMonth);
      const above = Math.max(0, perMonth - mrotMonth);
      return (atFull * c.rate + above * c.smallRateOverMrot) * 12 + yearSalary * injury;
    }
    const upToBase = Math.min(yearSalary, c.base);
    const overBase = Math.max(0, yearSalary - c.base);
    return upToBase * c.rate + overBase * c.rateOverBase + yearSalary * injury;
  },

  /* Госпошлина по цене иска. */
  courtFeeFor(claim) {
    if (!(claim > 0)) return 0;
    const step = this.courtFee.steps.find(x => claim <= x.upTo);
    const fee = step.base + (claim - step.from) * step.rate;
    return Math.min(this.courtFee.cap, Math.round(fee));
  },

  /* Взносы ИП за себя за неполный год: фиксированная часть считается
     пропорционально дням, переменная — от фактического дохода. */
  contributionsPartial(income, days, yearDays = 365) {
    const c = this.ipContributions;
    const fixed = c.fixed * Math.min(1, Math.max(0, days) / yearDays);
    const extra = Math.min(c.extraCap, Math.max(0, income - c.extraThreshold) * c.extraRate);
    return { fixed, extra, total: fixed + extra };
  },

  dividendTax(amount) { return this.progressive(amount, this.dividendScale); },

  /* Максимальное дневное пособие по больничному. */
  maxSickDaily() {
    const s = this.sickLeave;
    return s.bases.reduce((a, b) => a + b, 0) / s.days;
  },

  /* --- Ключевая ставка Банка России ---

     Особый случай среди всех чисел этого файла: она меняется несколько
     раз в год, а от неё зависят пени по налогам (ст. 75 НК), проценты
     за пользование чужими деньгами (ст. 395 ГК) и компенсация за
     задержку зарплаты (ст. 236 ТК) — то есть суммы в исках и в спорах
     с налоговой.

     Поэтому она НЕ зашита намертво: значение ниже — только подстановка
     по умолчанию, а в каждом калькуляторе поле со ставкой человек может
     поправить, и рядом стоит ссылка на cbr.ru. Выдуманная ставка в
     правовом расчёте хуже, чем спрошенная. */
  keyRate: {
    percent: 16,               // % годовых на дату сверки
    source: "https://cbr.ru/hd_base/KeyRate/",
  },

  /* Пени по налогам, ст. 75 НК РФ.
     Физлица и ИП — всегда 1/300 ставки. Организации: первые 30 дней
     1/300, дальше 1/150 — вдвое дороже, и об этом обычно не знают. */
  taxPenalty({ sum = 0, days = 0, rate = null, org = false } = {}) {
    const r = (rate ?? this.keyRate.percent) / 100;
    if (!org || days <= 30) return sum * r / 300 * days;
    return sum * r / 300 * 30 + sum * r / 150 * (days - 30);
  },

  /* Проценты за пользование чужими деньгами, ст. 395 ГК РФ:
     ключевая ставка за каждый день просрочки. */
  gkInterest({ sum = 0, days = 0, rate = null, daysInYear = 365 } = {}) {
    const r = (rate ?? this.keyRate.percent) / 100;
    return sum * r * days / daysInYear;
  },

  /* Компенсация за задержку зарплаты, ст. 236 ТК РФ: не ниже 1/150
     ставки за каждый день, включая день выплаты. Работодатель обязан
     заплатить её сам, без заявления работника. */
  wageDelay({ sum = 0, days = 0, rate = null } = {}) {
    const r = (rate ?? this.keyRate.percent) / 100;
    return sum * r / 150 * days;
  },

  /* Компенсация за неиспользованный отпуск, ст. 127 ТК РФ.
     Средний дневной заработок — по ст. 139: выплаты за 12 месяцев
     делятся на 12 и на среднемесячное число дней. */
  vacationComp({ yearPay = 0, days = 0 } = {}) {
    const daily = yearPay / 12 / this.avgMonthDays;
    return { daily, total: daily * days };
  },

  /* Сколько дней отпуска накопилось: 2,33 дня за отработанный месяц
     при стандартных 28 днях в году, минус уже отгулянные. */
  vacationDaysEarned({ months = 0, perYear = 28, used = 0 } = {}) {
    return Math.max(0, Math.round((perYear / 12) * months * 100) / 100 - used);
  },

  /* НДС на упрощёнке с 2025 года. Выбор между пониженной ставкой без
     вычетов и обычной с вычетами — не очевиден: пониженная выгодна,
     когда входного НДС мало. */
  usnVat({ income = 0, inputVat = 0 } = {}) {
    if (income <= this.usn.vatThreshold) {
      return { exempt: true, threshold: this.usn.vatThreshold };
    }
    const reduced = income > 250000000 ? 0.07 : 0.05;
    return {
      exempt: false,
      reducedRate: reduced,
      reduced: income * reduced,             // без права на вычеты
      general: Math.max(0, income * this.vatRate - inputVat),
      generalRate: this.vatRate,
    };
  },

  /* Аннуитетный платёж по кредиту: одинаковая сумма каждый месяц. */
  annuity({ sum = 0, ratePercent = 0, months = 0 } = {}) {
    if (!sum || !months) return { payment: 0, total: 0, overpay: 0 };
    const m = ratePercent / 100 / 12;
    const payment = m === 0 ? sum / months
      : sum * m * Math.pow(1 + m, months) / (Math.pow(1 + m, months) - 1);
    const total = payment * months;
    return { payment, total, overpay: total - sum };
  },

  /* Подпись «данные актуальны на …» для вывода под расчётами. */
  disclaimer() {
    const d = new Date(this.checkedOn).toLocaleDateString("ru-RU");
    return `Ставки и лимиты сверены на ${d}. Нормы меняются — перед подачей отчётности ` +
           `проверьте актуальную редакцию (сайт ФНС, КонсультантПлюс).`;
  },
};
