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

  /* Подтягиваем с сервера и сливаем с локальным: значения только
     растут, поэтому порядок прихода данных не важен. */
  async pull() {
    if (typeof API === "undefined" || !PF.user()) return;
    try {
      const d = await API.competencies.get();
      const local = this.all();
      const merged = {};
      for (const a of Object.keys(this.AREAS)) {
        merged[a] = Math.max(Number(local[a]) || 0, Number(d.areas[a]) || 0);
      }
      localStorage.setItem(this.key(), JSON.stringify(merged));
      /* Если локально было больше — вернём это на сервер. */
      if (Object.keys(merged).some(a => merged[a] > (Number(d.areas[a]) || 0))) {
        API.competencies.sync(merged).catch(() => {});
      }
      return merged;
    } catch {}
  },

  /* Отправляем не сразу: за одно занятие начислений бывает несколько,
     и слать запрос на каждое — расточительно. */
  push() {
    if (typeof API === "undefined" || !PF.user()) return;
    clearTimeout(this._t);
    this._t = setTimeout(() => API.competencies.sync(this.all()).catch(() => {}), 1500);
  },

  award(area, points) {
    if (!this.AREAS[area]) return 0;
    const a = this.all();
    const before = a[area];
    a[area] = Math.min(100, before + points);
    localStorage.setItem(this.key(), JSON.stringify(a));
    if (a[area] > before) {
      PF.logAction(`Компетенция «${this.AREAS[area]}»: +${a[area] - before}% (итого ${a[area]}%)`);
      this.push();
    }
    return a[area] - before;
  },

  /* Связь контента с направлениями */
  courseArea: { fin: "finance", acc: "accounting", law: "contracts" },
  /* Ключи должны совпадать с TESTS в knowledge.js: после появления
     тестов «Работники» и «Бизнес» они не начисляли ничего, потому что
     их здесь просто не было. */
  testArea: {
    taxes: "tax", law: "contracts", labour: "labor",
    finance: "finance", business: "accounting",
  },
  /* У статьи теперь есть своя область — она точнее, чем догадка по
     коду нормы. Код остаётся запасным вариантом. */
  articleArea(code, area) {
    const byArea = {
      "Налоги": "tax", "Договоры": "contracts", "Работники": "labor",
      "Деньги": "finance", "Бизнес": "accounting",
    };
    if (area && byArea[area]) return byArea[area];
    if (code.includes("НК")) return "tax";
    if (code.includes("ГК") || code.includes("ЗоЗПП")) return "contracts";
    if (code.includes("ТК")) return "labor";
    if (code.includes("УК")) return "accounting";
    return "finance";
  },
};
