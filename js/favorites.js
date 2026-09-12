/* ============ ЭкоФин — избранное ============

   Зачем. Калькуляторов тридцать, инструментов столько же. Человек
   пользуется тремя-четырьмя, но каждый раз ищет их в общем ряду. Звезда
   решает это дешевле любой перестройки разделов: отмеченное встаёт
   первым и собирается в кабинете.

   Где хранится:

   • вошёл — на сервере, через PROGRESS (ключ favorites). Значит,
     отмеченное на телефоне видно и на компьютере;
   • не вошёл — в браузере. Гостю тоже нужно избранное: половина
     посетителей считает налоги, не регистрируясь. При первом входе
     гостевой список переносится в аккаунт (adopt), чтобы отметки
     не пропали в момент, когда человек наконец зарегистрировался.

   Что храним: не просто идентификатор, а заголовок и адрес. Иначе
   кабинету пришлось бы знать про каждую страницу сайта, откуда что
   могло быть отмечено, — и разъезжаться с ними при каждом переименовании.

   Подключается на страницах с вкладками (калькуляторы, инструменты),
   на отдельных страницах калькуляторов и в кабинете.                 */

const FAV = {
  KEY: "favorites",
  GUEST: "pf_fav_guest",
  MAX: 50,

  signed() { return typeof PF !== "undefined" && Boolean(PF.user()); },

  list() {
    if (this.signed() && typeof PROGRESS !== "undefined") {
      const v = PROGRESS.read(this.KEY);
      return v && Array.isArray(v.items) ? v.items : [];
    }
    try { return JSON.parse(localStorage.getItem(this.GUEST) || "[]"); }
    catch { return []; }
  },

  save(items) {
    const cut = items.slice(0, this.MAX);
    if (this.signed() && typeof PROGRESS !== "undefined") PROGRESS.save(this.KEY, { items: cut });
    else localStorage.setItem(this.GUEST, JSON.stringify(cut));
    document.dispatchEvent(new CustomEvent("pf:favorites", { detail: { items: cut } }));
  },

  has(id) { return this.list().some(x => x.id === id); },

  /* Возвращает, добавили или убрали: кнопке нужно перерисоваться. */
  toggle(item) {
    const items = this.list();
    const at = items.findIndex(x => x.id === item.id);
    if (at >= 0) items.splice(at, 1);
    else items.unshift({ ...item, at: Date.now() });
    this.save(items);
    return at < 0;
  },

  /* Перенос гостевых отметок в аккаунт после входа. Делается один раз:
     после переноса гостевой список стирается. */
  adopt() {
    if (!this.signed()) return;
    let guest = [];
    try { guest = JSON.parse(localStorage.getItem(this.GUEST) || "[]"); } catch {}
    if (!guest.length) return;
    const mine = this.list();
    for (const g of guest) if (!mine.some(x => x.id === g.id)) mine.push(g);
    this.save(mine);
    localStorage.removeItem(this.GUEST);
  },

  /* --- Кнопка на панели --- */

  label(on) { return on ? "★ В избранном" : "☆ В избранное"; },

  button(item) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn small secondary no-print fav-star";
    b.dataset.fav = item.id;
    b.textContent = this.label(this.has(item.id));
    b.setAttribute("aria-pressed", String(this.has(item.id)));
    b.addEventListener("click", () => {
      const on = this.toggle(item);
      b.textContent = this.label(on);
      b.setAttribute("aria-pressed", String(on));
      if (typeof toast === "function") {
        toast(on
          ? (this.signed() ? "Добавлено в избранное — оно в кабинете" : "Добавлено в избранное в этом браузере")
          : "Убрано из избранного");
      }
    });
    return b;
  },

  /* --- Разметка страницы --- */

  /* Адрес, по которому это открывается снова. На странице с вкладками —
     якорь на панель, на отдельной странице — она сама. Адрес считаем от
     корня сайта: его потом открывает кабинет, лежащий в другом месте. */
  href(panelId, hasTabs) {
    const page = location.pathname.replace(/^\//, "") || "index.html";
    return hasTabs ? `${page}#${panelId}` : page;
  },

  mount() {
    const panels = [...document.querySelectorAll(".tab-panel")];
    if (!panels.length) return;
    const tabs = [...document.querySelectorAll(".tabs .tab")];
    const hasTabs = tabs.length > 0;

    const pairs = [];
    if (hasTabs) {
      tabs.forEach((tab, i) => {
        /* У калькуляторов вкладка знает свою панель по имени, у
           инструментов — по номеру в data-tool. Порядок кнопок в ряду
           там не совпадает с порядком панелей, поэтому брать панель по
           месту кнопки нельзя: звезда оказалась бы на чужой. */
        const byTool = tab.dataset.tool !== undefined && panels[Number(tab.dataset.tool)];
        const id = tab.dataset.panel || (byTool ? byTool.id : panels[i] && panels[i].id);
        const panel = id && document.getElementById(id);
        if (panel) pairs.push({ tab, panel, id, title: tab.textContent.trim() });
      });
    } else if (panels.length === 1) {
      const h1 = document.querySelector("h1");
      pairs.push({
        tab: null, panel: panels[0], id: panels[0].id,
        title: (h1 ? h1.textContent : document.title).trim(),
      });
    }

    for (const p of pairs) {
      if (p.panel.querySelector(".fav-star")) continue;
      const row = document.createElement("div");
      row.className = "fav-line no-print";
      row.style.cssText = "display:flex;justify-content:flex-end;margin-bottom:10px";
      row.appendChild(this.button({ id: p.id, title: p.title, href: this.href(p.id, hasTabs) }));
      p.panel.insertBefore(row, p.panel.firstChild);
    }

    if (hasTabs) this.reorder(pairs);
  },

  /* Избранное — первым в ряду вкладок. Сам ряд не переписываем, а
     переставляем кнопки: обработчики и активная вкладка остаются. */
  reorder(pairs) {
    const row = document.querySelector(".tabs");
    if (!row) return;
    const fav = this.list().map(x => x.id);
    if (!fav.length) return;
    const rank = p => {
      const i = fav.indexOf(p.id);
      return i < 0 ? 1000 + pairs.indexOf(p) : i;
    };
    [...pairs].sort((a, b) => rank(a) - rank(b))
      .forEach(p => { if (p.tab) row.appendChild(p.tab); });
  },

  /* --- Список в кабинете --- */

  renderList(box) {
    if (!box) return;
    const items = this.list();
    box.innerHTML = items.length
      ? `<div style="display:flex;gap:8px;flex-wrap:wrap">${
          items.map(x => `<a class="btn small secondary" href="${
            typeof PF !== "undefined" ? PF.href(x.href) : x.href
          }">${(typeof escapeHtml === "function" ? escapeHtml(x.title) : x.title)}</a>`).join("")
        }</div>`
      : `<p class="hint">Пока пусто. Отметьте звёздочкой калькулятор или инструмент —
         он появится здесь и встанет первым в общем ряду.</p>`;
  },
};

/* Гостевые отметки переносим, как только сервер подтвердил, кто мы. */
document.addEventListener("pf:ready", () => FAV.adopt());
