/* ============ ПравоФин — профиль компетенций ============
   5 направлений, статус вместо «очков»: Базовый → Уверенный → Продвинутый → Экспертный */
const COMP = {
  AREAS: {
    tax: "Налоги",
    contracts: "Договорная работа",
    finance: "Финансы",
    accounting: "Бухучёт",
    labor: "Трудовое право",
  },
  LEVELS: [[0, "Базовый"], [30, "Уверенный"], [60, "Продвинутый"], [85, "Экспертный"]],

  key() { const u = PF.user(); return "pf_comp_" + (u ? u.email : "guest"); },
  all() {
    const saved = JSON.parse(localStorage.getItem(this.key()) || "null");
    if (saved) return saved;
    return Object.fromEntries(Object.keys(this.AREAS).map(a => [a, 0]));
  },
  level(v) {
    let name = this.LEVELS[0][1];
    for (const [min, label] of this.LEVELS) if (v >= min) name = label;
    return name;
  },
  index() {
    const a = this.all();
    return Math.round(Object.values(a).reduce((s, v) => s + v, 0) / Object.keys(this.AREAS).length);
  },

  award(area, points) {
    if (!this.AREAS[area]) return 0;
    const a = this.all();
    const before = a[area];
    a[area] = Math.min(100, before + points);
    localStorage.setItem(this.key(), JSON.stringify(a));
    if (a[area] > before) PF.logAction(`Компетенция «${this.AREAS[area]}»: +${a[area] - before}% (итого ${a[area]}%)`);
    return a[area] - before;
  },

  /* Связь контента с направлениями */
  courseArea: { fin: "finance", acc: "accounting", law: "contracts" },
  testArea: { taxes: "tax", law: "contracts", finance: "finance", accounting: "accounting" },
  articleArea(code) {
    if (code.includes("НК")) return "tax";
    if (code.includes("ГК")) return "contracts";
    if (code.includes("ТК")) return "labor";
    if (code.includes("УК")) return "contracts";
    return "finance"; // ФЗ-115 и личные финансы
  },
};
