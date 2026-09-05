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


  /* --- НДФЛ с продажи имущества, НК РФ ст. 217.1 и 220 ---

     Главное здесь не ставка, а срок владения: выдержал минимальный срок —
     налога нет вообще и декларацию подавать не нужно. Именно на этом
     теряют деньги чаще всего: продают за месяц до истечения срока.

     Ставка отдельная от зарплатной: для доходов от продажи имущества
     действует двухступенчатая шкала, а не пятиступенчатая. */
  propertySale: {
    minYearsCommon: 5,      // недвижимость по общему правилу
    minYearsSpecial: 3,     // наследство, дар от близкого родственника,
                            // приватизация, рента, единственное жильё
    minYearsOther: 3,       // автомобиль и иное имущество
    deductionRealty: 1000000,   // вычет вместо расходов, недвижимость
    deductionOther: 250000,     // вычет вместо расходов, иное имущество
    /* Шкала совпадает с дивидендной по значениям, но задана отдельно:
       законодатель меняет их независимо, и общая константа однажды
       увела бы один расчёт вслед за другим. */
    scale: [
      { upTo: 2400000, rate: 0.13 },
      { upTo: Infinity, rate: 0.15 },
    ],
  },

  /* --- Пособия по материнству, ФЗ-255 ---

     Считаются из того же среднего заработка за два года и тех же
     предельных баз, что и больничный: отдельных чисел не заводим,
     иначе они разойдутся при следующей индексации. */
  maternity: {
    daysNormal: 140,        // обычные роды: 70 до + 70 после
    daysComplicated: 156,   // осложнённые роды
    daysMultiple: 194,      // многоплодная беременность
    careShare: 0.40,        // пособие по уходу до 1,5 лет — доля заработка
    careMonthDays: 30.4,    // среднее число дней в месяце для пересчёта
  },

  /* --- Алименты, СК РФ ст. 81 и 83 ---

     Доли считаются от дохода ПОСЛЕ удержания НДФЛ — это прямо сказано
     в постановлении Правительства № 841, и это самая частая ошибка
     в самостоятельных расчётах: люди берут четверть от оклада. */
  alimony: {
    shares: { 1: 0.25, 2: 1 / 3, 3: 0.5 },   // на 1, 2, 3 и более детей
    maxWithholding: 0.70,   // предел удержания по алиментам, ФЗ-229 ст. 99
  },

  /* --- Исковая давность, ГК РФ ст. 196, 200, 202, 203 --- */
  limitation: {
    generalYears: 3,        // общий срок
    absoluteYears: 10,      // предельный, от самого нарушения
    claimPauseDays: 180,    // приостановка на досудебный порядок, не более
  },

  /* --- НДФЛ с процентов по вкладам, НК РФ ст. 214.2 ---

     Облагается не весь доход, а только превышение над необлагаемым
     минимумом. Минимум считается как миллион рублей, умноженный на
     максимальную ключевую ставку на первое число месяца в течение года —
     то есть меняется каждый год вместе со ставкой. */
  deposits: {
    base: 1000000,
    scale: [
      { upTo: 2400000, rate: 0.13 },
      { upTo: Infinity, rate: 0.15 },
    ],
  },

  /* --- Штрафы налоговой, НК РФ ст. 119 и 122 ---

     Два самых частых штрафа, и их постоянно путают: за НЕСДАННУЮ
     декларацию и за НЕУПЛАЧЕННЫЙ налог. Их могут назначить оба сразу —
     это разные нарушения.

     За непредставление декларации (ст. 119): 5% от неуплаченной по ней
     суммы за каждый полный и неполный месяц просрочки. Но не больше 30%
     и не меньше 1000 рублей — даже когда налог нулевой.

     За неуплату (ст. 122): 20% от неуплаченной суммы, а если докажут
     умысел — 40%.

     Смягчающие обстоятельства снижают штраф не менее чем вдвое
     (ст. 112 и 114), нижнего предела закон не ставит. */
  fines: {
    lateReturn: {
      ratePerMonth: 0.05,
      maxShare: 0.30,
      minRub: 1000,
      article: "ст. 119 НК РФ",
    },
    unpaidTax: {
      rate: 0.20,
      rateIntentional: 0.40,
      article: "ст. 122 НК РФ",
    },
    mitigationDivisor: 2,   // «не менее чем в два раза», ст. 114 п. 3
  },

  /* --- Выходное пособие при сокращении, ТК РФ ст. 178 ---

     Платят не один раз, а до трёх: пособие при увольнении, затем за
     второй месяц, если человек не устроился, и за третий — по решению
     службы занятости. Люди обычно знают только про первое. */
  severance: {
    months: 1,              // пособие при увольнении
    extraMonths: 2,         // ещё до двух месяцев на время поиска работы
    article: "ст. 178 ТК РФ",
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
  employerContrib(yearSalary, { small = true, injury = 0.002, mrotMonth = null, months = 12 } = {}) {
    const c = this.payrollContrib;
    /* МРОТ берём из sickLeave: он там уже есть, и второе место для одного
       и того же числа однажды разойдётся с первым. */
    const mrot = mrotMonth ?? this.sickLeave.minWageMonth;
    const m = Math.max(1, months);
    if (small) {
      /* Льгота считается помесячно: полный тариф с МРОТ, 15% с остального.
         Делим на фактическое число месяцев, а не всегда на двенадцать, —
         иначе при работе полгода месячная выплата занижается вдвое
         и льгота считается не от той суммы. */
      const perMonth = yearSalary / m;
      const atFull = Math.min(perMonth, mrot);
      const above = Math.max(0, perMonth - mrot);
      return (atFull * c.rate + above * c.smallRateOverMrot) * m + yearSalary * injury;
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

  /* --- Взносы за работника: полная картина ---

     Само правило считает employerContrib — он тут единственный, и
     дублировать его здесь нельзя: два расчёта одного и того же тарифа
     рано или поздно разойдутся, а разойдутся они молча.

     Эта обёртка добавляет то, чего нет в одном числе: разбивку на единый
     тариф и травматизм, НДФЛ, сумму на руки и полную стоимость работника.
     Последняя и есть главное: предприниматель держит в голове «зарплата
     восемьдесят», а платит почти сто десять. */
  payroll({ monthly = 0, months = 12, small = true, injuryRate = null } = {}) {
    const p = this.payrollContrib;
    const injury = injuryRate ?? p.injuryMin;
    const total = monthly * months;

    /* Единый тариф отдельно от травматизма: тот же расчёт с нулевой
       ставкой травматизма и даёт чистый единый тариф. */
    const main = this.employerContrib(total, { small, injury: 0, months });
    const injurySum = total * injury;
    const ndfl = this.ndfl(total);

    return {
      total,
      main,
      injury: injurySum,
      all: main + injurySum,
      overBase: Math.max(0, total - p.base),
      /* Во что обходится работник. НДФЛ сюда не входит — он удерживается
         ИЗ зарплаты, а не платится сверх неё. */
      cost: total + main + injurySum,
      ndfl,
      onHand: total - ndfl,
    };
  },

  /* --- НДФЛ с продажи имущества ---

     Первое, что проверяем, — срок владения. Если он выдержан, дальше
     считать нечего: налога нет и декларацию подавать не нужно.  */
  propertyTax({ price = 0, bought = 0, years = 0, realty = true,
                special = false, useCosts = false } = {}) {
    const p = this.propertySale;
    const need = realty ? (special ? p.minYearsSpecial : p.minYearsCommon) : p.minYearsOther;
    if (years >= need) return { free: true, need, tax: 0 };

    const deduction = realty ? p.deductionRealty : p.deductionOther;
    /* Два способа уменьшить доход, выбрать можно только один.
       Считаем оба и подсказываем выгодный — вручную люди почти всегда
       берут вычет, хотя расходы часто больше. */
    const byDeduction = Math.max(0, price - deduction);
    const byCosts = Math.max(0, price - bought);
    const base = useCosts ? byCosts : Math.min(byDeduction, byCosts);

    return {
      free: false, need, deduction,
      byDeduction, byCosts,
      better: byCosts < byDeduction ? "costs" : "deduction",
      base,
      tax: this.progressive(base, p.scale),
    };
  },

  /* --- Пособия по материнству ---

     Средний дневной заработок ограничен сверху предельными базами
     и снизу МРОТ. Оба предела обязательны: без верхнего пособие
     завышается втрое, без нижнего — занижается у тех, кто работал
     мало или неофициально. */
  maternityPay({ pay1 = 0, pay2 = 0, days = 140, excluded = 0 } = {}) {
    const s = this.sickLeave, m = this.maternity;
    const capped = Math.min(pay1, s.bases[0]) + Math.min(pay2, s.bases[1]);
    /* Из знаменателя вычитаются дни болезней и прошлых декретов —
       иначе пособие занижается за то, что человек болел. */
    const divisor = Math.max(1, s.days - excluded);
    const daily = capped / divisor;

    const maxDaily = (s.bases[0] + s.bases[1]) / s.days;
    const minDaily = s.minWageMonth * 24 / s.days;
    const used = Math.min(Math.max(daily, minDaily), maxDaily);

    /* Упёрлись в потолок — это про ИСХОДНЫЙ заработок, а не про
       посчитанный. Сравнивать было не с чем: заработок обрезается
       предельными базами строкой выше, и после обрезки он никогда не
       окажется больше потолка. Признак всегда молчал, и человек с
       зарплатой втрое выше базы не понимал, почему пособие такое. */
    const overBase = pay1 > s.bases[0] || pay2 > s.bases[1];

    const care = used * m.careMonthDays * m.careShare;
    return {
      daily: used, atMax: overBase, atMin: daily < minDaily,
      maxDaily, minDaily,
      birth: used * days,          // пособие по беременности и родам
      careMonthly: care,           // по уходу до 1,5 лет, в месяц
      careMax: maxDaily * m.careMonthDays * m.careShare,
    };
  },

  /* --- Алименты, СК РФ ст. 81 ---
     Доля берётся от дохода после НДФЛ. */
  alimonyPay({ income = 0, kids = 1, alreadyNet = false } = {}) {
    const a = this.alimony;
    const net = alreadyNet ? income : income - this.ndfl(income * 12) / 12;
    const share = a.shares[Math.min(3, Math.max(1, kids))];
    const sum = net * share;
    const cap = net * a.maxWithholding;
    return {
      net, share, sum: Math.min(sum, cap),
      capped: sum > cap, cap,
    };
  },

  /* --- Исковая давность, ГК РФ ст. 196 и 200 ---
     Считаем от дня, когда человек узнал о нарушении, а не от самого
     нарушения: это разные даты, и путаница в них стоит иска. */
  limitationEnds({ knownAt = null, brokenAt = null, claimDays = 0 } = {}) {
    const L = this.limitation;
    const day = 86400000;
    const known = knownAt ? new Date(knownAt) : null;
    if (!known || Number.isNaN(known.getTime())) return null;

    const pause = Math.min(claimDays, L.claimPauseDays) * day;
    const ends = new Date(known.getTime() + L.generalYears * 365.25 * day + pause);

    /* Предельный срок: сколько бы ни тянулось «узнал позже»,
       через десять лет от нарушения защиты нет. */
    let absolute = null;
    if (brokenAt) {
      const b = new Date(brokenAt);
      if (!Number.isNaN(b.getTime())) absolute = new Date(b.getTime() + L.absoluteYears * 365.25 * day);
    }
    const real = absolute && absolute < ends ? absolute : ends;
    return {
      ends, absolute, real,
      cutByAbsolute: Boolean(absolute && absolute < ends),
      daysLeft: Math.ceil((real - Date.now()) / day),
    };
  },

  /* --- НДФЛ с процентов по вкладам, НК РФ ст. 214.2 --- */
  depositTax({ interest = 0, maxKeyRate = null } = {}) {
    const d = this.deposits;
    const rate = (maxKeyRate ?? this.keyRate.percent) / 100;
    const free = d.base * rate;
    const base = Math.max(0, interest - free);
    return { free, base, tax: this.progressive(base, d.scale) };
  },

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
  /* Взносы ИП за неполный год — НК РФ ст. 430 п. 5.

     Самая частая ошибка тех, кто открылся или закрылся в середине года:
     платят полную годовую сумму, потому что нигде не написано иначе.
     Закон считает иначе: за полные месяцы — пропорционально, за неполный
     месяц — пропорционально календарным дням в нём.

     Дни считаем включительно с обоих концов: день регистрации входит
     в срок (ст. 430 п. 5 прямо говорит «начиная с календарного месяца
     начала деятельности»), день прекращения — тоже.                  */
  ipContributionsFor({ from = null, to = null, year = null } = {}) {
    const y = year || this.year;
    const start = from ? new Date(from) : new Date(y, 0, 1);
    const end = to ? new Date(to) : new Date(y, 11, 31);

    /* Обрезаем период границами года: взносы считаются за календарный
       год, и деятельность, начатая в прошлом декабре, к этому году
       добавляет ровно ноль. */
    const yStart = new Date(y, 0, 1), yEnd = new Date(y, 11, 31);
    const s = start < yStart ? yStart : start;
    const e = end > yEnd ? yEnd : end;
    if (e < s) return { fixed: 0, months: 0, days: 0, full: this.ipContributions.fixed };

    const fixedYear = this.ipContributions.fixed;
    const monthPart = fixedYear / 12;

    let sum = 0, fullMonths = 0, extraDays = 0;
    for (let m = 0; m < 12; m++) {
      const mStart = new Date(y, m, 1);
      const mEnd = new Date(y, m + 1, 0);
      if (mEnd < s || mStart > e) continue;

      const covFrom = mStart < s ? s : mStart;
      const covTo = mEnd > e ? e : mEnd;
      const daysInMonth = mEnd.getDate();
      const covered = Math.round((covTo - covFrom) / 86400000) + 1;

      if (covered >= daysInMonth) { sum += monthPart; fullMonths++; }
      else { sum += monthPart * covered / daysInMonth; extraDays += covered; }
    }

    return {
      fixed: Math.round(sum),
      full: fixedYear,
      months: fullMonths,
      days: extraDays,
      saved: Math.round(fixedYear - sum),
    };
  },

  /* Штрафы налоговой — НК РФ ст. 119 и 122.

     Считаем оба сразу и показываем оба: их назначают вместе, а человек
     обычно знает про один и удивляется второму.

     Месяцы просрочки — полные И неполные: один день просрочки в новом
     месяце добавляет целые 5%. Это не описка закона, а его буква. */
  taxFines({ unpaid = 0, monthsLate = 0, intentional = false, mitigations = 0 } = {}) {
    const F = this.fines;
    const sum = Math.max(0, unpaid);
    const months = Math.max(0, Math.ceil(monthsLate));

    let lateReturn = sum * F.lateReturn.ratePerMonth * months;
    lateReturn = Math.min(lateReturn, sum * F.lateReturn.maxShare);
    lateReturn = Math.max(lateReturn, F.lateReturn.minRub);

    const unpaidTax = sum * (intentional ? F.unpaidTax.rateIntentional : F.unpaidTax.rate);

    /* Смягчающие снижают не менее чем вдвое за каждое — закон нижнего
       предела не ставит, но обещать больше половины за штуку нельзя:
       решает инспекция или суд. Показываем осторожную оценку. */
    const divisor = Math.pow(F.mitigationDivisor, Math.max(0, Math.min(3, mitigations)));

    return {
      lateReturn: Math.round(lateReturn),
      unpaidTax: Math.round(unpaidTax),
      total: Math.round(lateReturn + unpaidTax),
      withMitigation: Math.round((lateReturn + unpaidTax) / divisor),
      divisor,
      months,
    };
  },

  /* Выходное пособие при сокращении — ТК РФ ст. 178.

     Средний МЕСЯЧНЫЙ заработок, а не оклад: в него входят премии и
     надбавки, поэтому он обычно выше оклада, и люди недополучают,
     считая по окладу.                                                */
  severancePay({ avgMonth = 0, monthsUnemployed = 0 } = {}) {
    const a = Math.max(0, avgMonth);
    const extra = Math.max(0, Math.min(this.severance.extraMonths, Math.ceil(monthsUnemployed)));
    return {
      onDismissal: Math.round(a),
      forSearch: Math.round(a * extra),
      total: Math.round(a * (this.severance.months + extra)),
      extraMonths: extra,
    };
  },

  disclaimer() {
    const d = new Date(this.checkedOn).toLocaleDateString("ru-RU");
    return `Ставки и лимиты сверены на ${d}. Нормы меняются — перед подачей отчётности ` +
           `проверьте актуальную редакцию (сайт ФНС, КонсультантПлюс).`;
  },
};
