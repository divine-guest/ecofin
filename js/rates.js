/* ============ ПравоФин — ставки, лимиты и базы ============

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
  dividendTax(amount) { return this.progressive(amount, this.dividendScale); },

  /* Максимальное дневное пособие по больничному. */
  maxSickDaily() {
    const s = this.sickLeave;
    return s.bases.reduce((a, b) => a + b, 0) / s.days;
  },

  /* Подпись «данные актуальны на …» для вывода под расчётами. */
  disclaimer() {
    const d = new Date(this.checkedOn).toLocaleDateString("ru-RU");
    return `Ставки и лимиты сверены на ${d}. Нормы меняются — перед подачей отчётности ` +
           `проверьте актуальную редакцию (сайт ФНС, КонсультантПлюс).`;
  },
};
