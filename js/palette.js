/* ============ Быстрый поиск по всему сервису ============

   Ctrl+K из любого места — и одно поле, которое ищет сразу везде:
   статьи, калькуляторы, инструменты, свои расчёты, свои напоминания,
   свои прошлые вопросы. Раньше, чтобы посчитать пеню, нужно было
   вспомнить, что она в калькуляторах, открыть раздел и найти вкладку.

   Пишется в одном месте и подключается на всех страницах: удобство,
   которое работает только на главной, — не удобство.                */

const PALETTE = {
  open: false,
  items: [],
  filtered: [],
  cursor: 0,

  /* Недавнее показываем, пока не начали печатать: чаще всего человек
     возвращается туда же, где был вчера. */
  recentKey() {
    const u = typeof PF !== "undefined" && PF.user() ? PF.user().email : "guest";
    return "pf_recent_" + u;
  },
  recent() {
    try { return JSON.parse(localStorage.getItem(this.recentKey()) || "[]"); }
    catch { return []; }
  },
  remember(it) {
    const list = this.recent().filter(x => x.href !== it.href);
    list.unshift({ title: it.title, href: it.href, kind: it.kind });
    localStorage.setItem(this.recentKey(), JSON.stringify(list.slice(0, 6)));
  },

  /* ---- Что умеем находить ---- */

  base() {
    const list = [
      { kind: "Раздел", title: "Все возможности сервиса", href: "features.html" },
      { kind: "Раздел", title: "Что делать: разбор ситуаций", href: "situations.html" },
      { kind: "Раздел", title: "Кабинет", href: "dashboard.html" },
      { kind: "Раздел", title: "ИИ-инструменты", href: "tools.html" },
      { kind: "Раздел", title: "Моё дело: учёт выручки и налог", href: "book.html" },
      { kind: "Раздел", title: "Мои клиенты: учёт за нескольких ИП и ООО", href: "clients.html" },
      { kind: "Раздел", title: "Документы: готовые бланки", href: "docs.html" },
      { kind: "Раздел", title: "Калькуляторы", href: "calc.html" },
      { kind: "Раздел", title: "Практикум", href: "games.html" },
      { kind: "Раздел", title: "База знаний", href: "knowledge.html" },
      { kind: "Раздел", title: "Ответы на вопросы", href: "answers.html" },
      { kind: "Раздел", title: "Курсы", href: "courses.html" },
      { kind: "Раздел", title: "Дневник трат", href: "expenses.html" },

      { kind: "Калькулятор", title: "Налоговые режимы: что выгоднее", href: "calc.html", tab: 0 },
      { kind: "Калькулятор", title: "Зарплата на руки и стоимость сотрудника", href: "calc.html", tab: 1 },
      { kind: "Калькулятор", title: "Взносы ИП за себя", href: "calc.html", tab: 2 },
      { kind: "Калькулятор", title: "НДС: выделить или начислить", href: "calc.html", tab: 3 },
      { kind: "Калькулятор", title: "Пеня и неустойка", href: "calc.html", tab: 4 },
      { kind: "Калькулятор", title: "Госпошлина в суд", href: "calc.html", tab: 5 },
      { kind: "Калькулятор", title: "Отпускные", href: "calc.html", tab: 6 },
      { kind: "Калькулятор", title: "Больничные", href: "calc.html", tab: 7 },
      { kind: "Калькулятор", title: "Дивиденды", href: "calc.html", tab: 8 },
      { kind: "Калькулятор", title: "Налоговые вычеты", href: "calc.html", tab: 9 },
      { kind: "Калькулятор", title: "Счёт на оплату", href: "calc.html", tab: 10 },
      { kind: "Календарь", title: "Календарь отчётности", href: "calc.html", tab: 11 },
      { kind: "Калькулятор", title: "Пени по налогам (ст. 75 НК)", href: "calc.html", tab: 12 },
      { kind: "Калькулятор", title: "Проценты за просрочку (ст. 395 ГК)", href: "calc.html", tab: 13 },
      { kind: "Калькулятор", title: "Компенсация за задержку зарплаты (ст. 236 ТК)", href: "calc.html", tab: 14 },
      { kind: "Калькулятор", title: "Расчёт при увольнении и компенсация за отпуск", href: "calc.html", tab: 15 },
      { kind: "Калькулятор", title: "НДС на УСН: 5%, 7% или 20%", href: "calc.html", tab: 16 },
      { kind: "Калькулятор", title: "Кредит: платёж и переплата", href: "calc.html", tab: 17 },
      { kind: "Калькулятор", title: "Сумма прописью для договора", href: "calc.html", tab: 18 },
      { kind: "Калькулятор", title: "Взносы за работников и стоимость найма", href: "calc.html", tab: 19 },
      { kind: "Калькулятор", title: "Налог с продажи квартиры и машины", href: "calc.html", tab: 20 },
      { kind: "Калькулятор", title: "Декретные и пособие по уходу", href: "calc.html", tab: 21 },
      { kind: "Калькулятор", title: "Алименты: сколько платить", href: "calc.html", tab: 22 },
      { kind: "Калькулятор", title: "Налог с процентов по вкладу", href: "calc.html", tab: 23 },
      { kind: "Калькулятор", title: "Срок исковой давности: когда истекает", href: "calc.html", tab: 24 },
      { kind: "Калькулятор", title: "Взносы ИП за неполный год: открылся или закрылся в середине", href: "calc.html", tab: 25 },
      { kind: "Калькулятор", title: "Штрафы налоговой: не сдал декларацию и не заплатил", href: "calc.html", tab: 26 },
      { kind: "Калькулятор", title: "Выходное пособие при сокращении", href: "calc.html", tab: 27 },

      { kind: "Инструмент", title: "Составить документ", href: "tools.html", tab: 0 },
      { kind: "Инструмент", title: "Разобрать договор по файлу или фото", href: "tools.html", tab: 1 },
      { kind: "Инструмент", title: "Ответ на претензию или требование", href: "tools.html", tab: 2 },
      { kind: "Инструмент", title: "Объяснить документ простыми словами", href: "tools.html", tab: 3 },
      { kind: "Инструмент", title: "Проверить контрагента", href: "tools.html", tab: 4 },
      { kind: "Инструмент", title: "Налоговый помощник", href: "tools.html", tab: 5 },
      { kind: "Инструмент", title: "Чек-листы", href: "tools.html", tab: 6 },
      { kind: "Инструмент", title: "Шаблоны без ИИ", href: "tools.html", tab: 7 },
      { kind: "Инструмент", title: "Чем это грозит: оценка последствий", href: "tools.html", tab: 8 },
      { kind: "Инструмент", title: "Объяснение в банк по 115-ФЗ", href: "tools.html", tab: 9 },
      { kind: "Инструмент", title: "Что изменилось в новой редакции договора", href: "tools.html", tab: 10 },
      { kind: "Инструмент", title: "Подбор кодов ОКВЭД", href: "tools.html", tab: 11 },
      { kind: "Инструмент", title: "Аудит карточки товара на маркетплейсе", href: "tools.html", tab: 12 },
      { kind: "Инструмент", title: "Сверка с налоговой: сальдо ЕНС", href: "tools.html", tab: 13 },

      { kind: "Действие", title: "Задать вопрос консультанту", act: "chat" },
      { kind: "Действие", title: "Добавить напоминание о сроке", href: "dashboard.html#tasks" },
      { kind: "Действие", title: "Настройки профиля", act: "settings" },
      { kind: "Действие", title: "Тарифы и подписка", act: "pay" },
      { kind: "Действие", title: "Сменить тему оформления", act: "theme" },
    ];

    /* Документы — тем же способом, что и статьи: перечислять тридцать
       названий руками означает однажды забыть про новый бланк, и он
       перестанет находиться поиском. Список берём из самой библиотеки. */
    if (typeof TEMPLATES !== "undefined") {
      for (const title of Object.keys(TEMPLATES)) {
        list.push({
          kind: "Документ", title,
          note: "заполнить и распечатать",
          href: "docs.html#" + encodeURIComponent(title),
        });
      }
    }

    /* Статьи подхватываем, если база знаний загружена на этой странице. */
    if (typeof ARTICLES !== "undefined") {
      for (const a of ARTICLES) {
        list.push({
          kind: "Статья", title: a.title, note: a.summary || "",
          href: "knowledge.html#a=" + encodeURIComponent(a.title),
        });
      }
    }
    return list;
  },

  /* Личное подгружаем с сервера: свои расчёты, сроки и вопросы человек
     ищет чаще, чем разделы. */
  async personal() {
    if (typeof PF === "undefined" || !PF.user() || typeof API === "undefined") return [];
    const out = [];
    const tasks = [
      API.saved.list().then(d => (d.items || []).forEach(x => out.push({
        kind: "Мой расчёт", title: x.title, note: x.summary,
        href: `calc.html?open=${encodeURIComponent(x.kind)}&saved=${x.id}`,
      }))).catch(() => {}),
      API.reminders.list().then(d => (d.reminders || []).forEach(x => out.push({
        kind: "Мой срок", title: x.title,
        note: x.due ? x.due.split("-").reverse().join(".") : "",
        href: "dashboard.html#tasks",
      }))).catch(() => {}),
      API.aiHistory().then(d => (d.items || []).slice(0, 20).forEach(x => out.push({
        kind: "Мой вопрос", title: x.question,
        href: "dashboard.html#assistant",
      }))).catch(() => {}),
    ];
    await Promise.all(tasks);
    return out;
  },

  /* ---- Открытие и закрытие ---- */

  async show() {
    if (this.open) return;
    this.open = true;

    let bd = document.getElementById("paletteBd");
    if (!bd) {
      bd = document.createElement("div");
      bd.id = "paletteBd";
      bd.className = "palette-bd";
      bd.innerHTML = `
        <div class="palette" role="dialog" aria-label="Быстрый поиск">
          <input type="text" id="paletteInput" autocomplete="off"
                 placeholder="Что нужно? Пеня, отпускные, мой расчёт, договор…">
          <div class="palette-list" id="paletteList"></div>
          <div class="palette-foot">
            <span>↑ ↓ — выбрать</span><span>Enter — открыть</span><span>Esc — закрыть</span>
          </div>
        </div>`;
      document.body.appendChild(bd);
      bd.addEventListener("click", e => { if (e.target === bd) PALETTE.hide(); });
      bd.querySelector("#paletteInput").addEventListener("input", e => PALETTE.search(e.target.value));
      bd.querySelector("#paletteInput").addEventListener("keydown", e => PALETTE.key(e));
    }

    bd.classList.add("open");
    document.body.style.overflow = "hidden";
    const input = document.getElementById("paletteInput");
    input.value = "";
    input.focus();

    this.items = this.base();
    this.search("");
    /* Личное грузим фоном: не задерживаем открытие ради сети. */
    this.personal().then(extra => {
      if (!extra.length) return;
      this.items = this.items.concat(extra);
      if (this.open) this.search(document.getElementById("paletteInput").value);
    });
  },

  hide() {
    this.open = false;
    document.getElementById("paletteBd")?.classList.remove("open");
    document.body.style.overflow = "";
  },

  toggle() { this.open ? this.hide() : this.show(); },

  /* ---- Поиск ---- */

  search(q) {
    const s = q.trim().toLowerCase();
    this.cursor = 0;

    if (!s) {
      const rec = this.recent();
      this.filtered = rec.length
        ? rec.map(r => ({ ...r, note: "недавно" }))
        : this.items.filter(x => x.kind === "Раздел" || x.kind === "Действие").slice(0, 8);
    } else {
      /* Простое ранжирование: совпадение с начала важнее совпадения
         в середине, а раздел важнее статьи при равном совпадении. */
      const weight = { "Действие": 0, "Раздел": 1, "Калькулятор": 2, "Инструмент": 2,
                       "Мой расчёт": 1, "Мой срок": 1, "Мой вопрос": 3, "Статья": 4, "Календарь": 2 };
      this.filtered = this.items
        .map(x => {
          const t = (x.title + " " + (x.note || "")).toLowerCase();
          const i = t.indexOf(s);
          return i < 0 ? null : { ...x, score: i * 10 + (weight[x.kind] ?? 5) };
        })
        .filter(Boolean)
        .sort((a, b) => a.score - b.score)
        .slice(0, 12);
    }
    this.render();
  },

  render() {
    const box = document.getElementById("paletteList");
    if (!box) return;
    if (!this.filtered.length) {
      box.innerHTML = `<div class="palette-empty">Ничего не нашлось.
        Попробуйте другое слово — например «пеня», «отпуск», «контрагент».</div>`;
      return;
    }
    box.innerHTML = this.filtered.map((x, i) => `
      <button class="palette-item ${i === this.cursor ? "on" : ""}" onclick="PALETTE.go(${i})">
        <span class="palette-kind">${escapeHtml(x.kind)}</span>
        <span class="palette-title">${escapeHtml(x.title)}</span>
        ${x.note ? `<span class="palette-note">${escapeHtml(String(x.note).slice(0, 60))}</span>` : ""}
      </button>`).join("");
  },

  key(e) {
    if (e.key === "Escape") { this.hide(); return; }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = this.filtered.length;
      if (!n) return;
      this.cursor = (this.cursor + (e.key === "ArrowDown" ? 1 : -1) + n) % n;
      this.render();
      document.querySelectorAll(".palette-item")[this.cursor]?.scrollIntoView({ block: "nearest" });
      return;
    }
    if (e.key === "Enter") { e.preventDefault(); this.go(this.cursor); }
  },

  go(i) {
    const it = this.filtered[i];
    if (!it) return;
    this.remember(it);
    this.hide();

    if (it.act === "chat") { if (typeof chatToggle === "function") chatToggle(); return; }
    if (it.act === "settings") { if (typeof SETTINGS !== "undefined") SETTINGS.open(); return; }
    if (it.act === "pay") { if (typeof PAY !== "undefined") PAY.open(); return; }
    if (it.act === "theme") { if (typeof toggleTheme === "function") toggleTheme(); return; }

    /* Вкладка внутри страницы: если мы уже здесь — просто переключаем,
       иначе передаём номер через адрес. */
    if (it.tab !== undefined) {
      const here = location.pathname.endsWith(it.href);
      if (here) {
        document.querySelectorAll(".tabs .tab")[it.tab]?.click();
        document.querySelector(".tabs")?.scrollIntoView({ behavior: "smooth" });
        return;
      }
      location.href = PF.href(it.href) + "#tab=" + it.tab;
      return;
    }
    location.href = PF.href(it.href);
  },
};

/* Ctrl+K и Cmd+K. Работает на любой странице, потому что подключается
   ко всем. Внутри полей ввода не перехватываем — кроме самого поиска. */
document.addEventListener("keydown", e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    PALETTE.toggle();
  }
});

/* Открытие вкладки по адресу вида #tab=3 — сюда ведёт быстрый поиск
   с другой страницы. */
window.addEventListener("DOMContentLoaded", () => {
  const m = location.hash.match(/^#tab=(\d+)$/);
  if (!m) return;
  setTimeout(() => {
    /* Ищем по номеру инструмента, а не по месту в ряду. Пока вкладки
       шли одной строкой, место и номер совпадали. После раскладки по
       разделам порядок кнопок изменился — и ссылка вида #tab=12
       открывала бы совсем другой инструмент.

       Запасной путь по месту оставлен для страниц, где вкладки простые
       и номеров у них нет. */
    const n = Number(m[1]);
    const byId = document.querySelector('.tab[data-tool="' + n + '"]');
    (byId || document.querySelectorAll(".tabs .tab")[n])?.click();
    document.querySelector(".tabs")?.scrollIntoView({ behavior: "smooth" });
    history.replaceState(null, "", location.pathname);
  }, 400);
});
