/* ============ ЭкоФин — общая логика ============ */

/* Кэш пользователя нужен только чтобы шапка и кабинет рисовались без мигания.
   Все запреты живут на сервере: правка кэша в DevTools ничего не открывает. */
const PF = {
  themeKey: "pf_theme",

  /* Путь к корню сайта от текущей страницы.

     Страницы статей лежат в подпапке st/, а шапка и подвал собираются
     кодом с относительными ссылками вида «calc.html». Со страницы в
     подпапке такая ссылка вела бы в st/calc.html, то есть в никуда.
     Поправлять ссылки после отрисовки бесполезно: шапка перерисовывается
     ещё раз, когда сервер подтвердит сессию, и правки пропадают. */
  base: location.pathname.includes("/st/") ? "../" : "",
  href(page) { return /^(https?:|#|mailto:)/.test(page) ? page : this.base + page; },

  user() { return API.cached(); },
  /* «Есть платная подписка» — любой платный тариф, не только старший.
     После появления «Базового» проверка на plan === "pro" молча считала
     платящего человека бесплатным. */
  isPro() { const u = this.user(); return !!u && (u.tier ? u.tier !== "free" : u.plan !== "free"); },
  tier() { const u = this.user(); return u ? (u.tier || u.plan || "free") : "free"; },
  /* Возможности конкретного тарифа: courses, theming, telegram, priority. */
  hasFeature(name) { const u = this.user(); return !!(u && u.features && u.features[name]); },
  isAdmin() { const u = this.user(); return !!u && u.isAdmin; },
  isOwner() { const u = this.user(); return !!u && u.isOwner; },

  /* Остатки лимитов приходят с сервера; до первого ответа — null. */
  quota: null,
  async refreshQuota() {
    if (!this.user()) { this.quota = null; return null; }
    try { this.quota = await API.quota(); } catch { this.quota = null; }
    return this.quota;
  },

  async logout() {
    await API.logout();
    location.href = PF.href("index.html");
  },

  /* Журнал действий ведёт сервер (он же — источник правды для админки).
     Метод оставлен пустым, чтобы страницы, которые его зовут, не падали. */
  logAction() {},
  actions: [],
  history() { return this.actions; },

  /* Результаты практикума и онбординг — вспомогательные данные, живут в браузере.
     Ни на доступ, ни на подписку они не влияют, поэтому серверу не нужны. */
  localKey(name) { const u = this.user(); return `pf_${name}_` + (u ? u.email : "guest"); },
  addScore(game, points) {
    const s = this.scores();
    s[game] = Math.max(s[game] || 0, points);
    localStorage.setItem(this.localKey("scores"), JSON.stringify(s));
    if (typeof PROGRESS !== "undefined") PROGRESS.push("scores");
  },
  scores() { try { return JSON.parse(localStorage.getItem(this.localKey("scores")) || "{}"); } catch { return {}; } },
  getScore(game) { return this.scores()[game] || 0; },
  updateUser(patch) {
    /* Профиль и подписку меняет только сервер. Здесь оседают лишь ответы
       онбординга и прочие настройки отображения. */
    const safe = { ...patch };
    delete safe.plan; delete safe.proUntil; delete safe.isAdmin; delete safe.role; delete safe.pass;
    if (!Object.keys(safe).length) return;
    const cur = this.prefs();
    localStorage.setItem(this.localKey("prefs"), JSON.stringify({ ...cur, ...safe }));
    if (typeof PROGRESS !== "undefined") PROGRESS.push("prefs");
  },
  prefs() { try { return JSON.parse(localStorage.getItem(this.localKey("prefs")) || "{}"); } catch { return {}; } },

  /* Профиль: кто человек, чем занимается, на каком режиме.
     Хранится на сервере, а не в браузере.

     Раньше ответы знакомства уходили в localStorage, а кабинет читал
     пользователя с сервера — то есть не видел их никогда. Блок
     «Рекомендуем для вас» не показался ни одному человеку, и при
     входе с телефона ответы терялись целиком.

     Дописываем поверх сохранённого, а не заменяем: мастер календаря
     присылает свои три поля и не должен стирать ответы про сферу. */
  async saveProfile(patch) {
    const cur = (this.user() && this.user().profile) || {};
    const next = { ...cur, ...patch };
    await API.updateProfile({ profile: next });
    return next;
  },

  /* --- Мои документы ---

     Раньше они лежали в браузере: терялись при чистке, не открывались
     с телефона и ничего не знали об учёте. Человек выставлял счёт и
     через месяц не помнил, оплатили его или нет.

     Теперь документ хранит сервер вместе с номером, датой,
     контрагентом и суммой. Отметка «оплачен» заносит поступление
     в «Моё дело» и в расчёт налога.

     Локальное хранилище оставлено как запасной путь: если сервер не
     ответил, только что составленную бумагу терять нельзя. Оно же
     хранит документы, составленные до перехода, — их переносит
     кабинет при первом входе. */
  docsKey() { const u = this.user(); return "pf_docs_" + (u ? u.email : "guest"); },
  docs() { try { return JSON.parse(localStorage.getItem(this.docsKey()) || "[]"); } catch { return []; } },

  async saveDoc(title, content, meta = {}) {
    try {
      const r = await API.documents.save({ title, content, ...meta });
      return r.id;
    } catch (e) {
      const docs = this.docs();
      docs.unshift({ title, content, date: new Date().toISOString(), pending: true });
      localStorage.setItem(this.docsKey(), JSON.stringify(docs.slice(0, 50)));
      throw e;
    }
  },
  deleteDoc(i) {
    const docs = this.docs();
    docs.splice(i, 1);
    localStorage.setItem(this.docsKey(), JSON.stringify(docs));
  },

  /* --- Реферальный код --- */
  referralCode() {
    const u = this.user();
    if (!u) return "";
    let h = 0;
    for (const c of u.email) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
    return "PF-" + h.toString(36).toUpperCase().padStart(4, "0");
  },
};

/* Журнал действий ведёт сервер; локальный вызов оставлен как заглушка,
   чтобы старые страницы не падали. */
function logAction() {}

/* ============ Тема ============ */
function applyTheme(t) {
  document.documentElement.setAttribute("data-theme", t);
  localStorage.setItem(PF.themeKey, t);
  /* Персональный цвет задаётся отдельными оттенками для светлой и тёмной.
     Без пересчёта после переключения остаётся цвет прошлой темы. */
  if (typeof THEMING !== "undefined") THEMING.refresh();
  /* Только у самого переключателя. Раньше кнопка уведомлений носила тот же
     класс ради оформления, и подпись темы затирала её текст — в шапке
     оказывались две кнопки «Светлая тема». */
  document.querySelectorAll("button.theme-toggle").forEach(b => {
    const txt = b.querySelector(".pill-text");
    if (txt) txt.textContent = t === "dark" ? "Тёмная тема" : "Светлая тема";
    else b.textContent = t === "dark" ? "Тёмная тема" : "Светлая тема";
    /* Значок меняется вместе с подписью. Переписывать кнопку целиком
       нельзя — вместе с текстом улетел бы и он. */
    const icon = b.querySelector(".pill-icon");
    if (icon) icon.replaceWith(elFromHtml(t === "dark" ? MOON_SVG : SUN_SVG));
  });
}
/* Собирает элемент из строки разметки: нужен, чтобы заменить значок,
   не переписывая кнопку целиком. */
function elFromHtml(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function initTheme() {
  const saved = localStorage.getItem(PF.themeKey) ||
    (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  applyTheme(saved);
}
function toggleTheme() {
  applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");
}

/* ============ Утилиты ============ */
function toast(msg, type = "") {
  let el = document.querySelector(".toast");
  if (!el) {
    el = document.createElement("div");
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = "toast " + type;
  void el.offsetWidth; // перезапуск анимации
  el.classList.add("show");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), type === "error" ? 5000 : 2800);
}

/* Аватар — либо загруженное фото (data-URL), либо emoji, либо первая буква имени. */
function avatarHtml(u, cls = "avatar") {
  if (!u) return "";
  const a = u.avatar || "";
  if (a.startsWith("data:image/"))
    return `<span class="${cls} has-photo"><img src="${escapeHtml(a)}" alt=""></span>`;
  return `<span class="${cls}">${escapeHtml(a || (u.name || "?")[0].toUpperCase())}</span>`;
}

/* Сжимает выбранное фото до квадрата 160 px — в базу уходят единицы килобайт,
   а не пять мегабайт с телефона. */
async function prepareAvatarPhoto(file) {
  if (!file.type.startsWith("image/")) throw new Error("Это не изображение");
  if (file.size > 20 * 1024 * 1024) throw new Error("Файл больше 20 МБ");

  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);      // берём центральный квадрат
  const sx = (bitmap.width - side) / 2;
  const sy = (bitmap.height - side) / 2;

  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 160;
  canvas.getContext("2d").drawImage(bitmap, sx, sy, side, side, 0, 0, 160, 160);
  bitmap.close?.();

  for (const q of [0.82, 0.7, 0.55, 0.4]) {
    const url = canvas.toDataURL("image/jpeg", q);
    if (url.length <= 45000) return url;
  }
  throw new Error("Не удалось сжать фото — попробуйте другое");
}

/* Склонение при числе: «1 месяц», «3 месяца», «5 месяцев».
   Без него подарочные месяцы читались бы как «3 месяц». */
function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ============ Чистка разметки из ответов ИИ ============

   Ответ модели показывается как обычный текст: его копируют, печатают
   и вставляют в документы. Markdown в нём приезжает буквально — человек
   видит «**Итого:** 45 000 ₽» со звёздочками посреди строки, а в
   распечатанном документе это выглядит просто браком.

   Запрет разметки стоит и в системной подсказке на сервере, но модели
   его нарушают: достаточно длинного ответа или списка, и звёздочки
   возвращаются. Поэтому чистим ещё и здесь — подсказка убирает причину,
   эта функция закрывает остаток.

   Главная опасность — не сломать то, что звёздочками не является.
   В выписках и чеках маскируют номера карт: «**** 1234», «**** **** ****
   5678». Правило вида «две звёздочки, что угодно, две
   звёздочки» съедает такой номер и выдаёт мусор.
   Поэтому выделение опознаём строго: внутри не должно быть ни звёздочек,
   ни переносов строк, и по краям — не пробел. Маскированный номер под
   такое описание не подходит ни одним куском. */
function plainText(s) {
  if (s === null || s === undefined) return "";
  let t = String(s).replace(/\r\n?/g, "\n");

  /* Код в обратных кавычках: сначала блоки, потом строчные. */
  t = t.replace(/```[a-zA-Z0-9_+-]*\n?([\s\S]*?)```/g, "$1");
  t = t.replace(/`([^`\n]+)`/g, "$1");

  /* Заголовки «### Итого» → «ИТОГО». Заглавные — единственный способ
     выделить строку в тексте без разметки, и он переживает и печать,
     и вставку в Word. */
  t = t.replace(/^ {0,3}#{1,6}[ \t]+(.+?)[ \t]*#*$/gm, (m, h) => h.toUpperCase());

  /* Разделительная линия целиком из --- *** ___ . Условие «вся строка»
     обязательно: иначе под нож попал бы наш же разделитель страниц
     «--- страница 2 ---» из распознавания. */
  t = t.replace(/^ {0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$/gm, "");

  /* Выделение. Содержимое без звёздочек, без переносов и без пробелов
     по краям — см. про номера карт выше. Пишем готовыми литералами,
     а не собираем из строк: двойное экранирование в new RegExp уже
     один раз съело слеши и превратило выражение в мусор. */
  t = t.replace(/(?<!\*)\*\*\*([^\s*][^*\n]*[^\s*]|[^\s*])\*\*\*(?!\*)/g, "$1");
  t = t.replace(/(?<!\*)\*\*([^\s*][^*\n]*[^\s*]|[^\s*])\*\*(?!\*)/g, "$1");
  t = t.replace(/(?<!\*)\*([^\s*][^*\n]*[^\s*]|[^\s*])\*(?!\*)/g, "$1");
  t = t.replace(/(?<![A-Za-zА-Яа-яЁё0-9_])__([^\s_][^_\n]*[^\s_]|[^\s_])__(?![A-Za-zА-Яа-яЁё0-9_])/g, "$1");

  /* Маркер списка в начале строки → тире. Пробел после знака обязателен,
     иначе пострадали бы отрицательные суммы: «-5 000 ₽». */
  t = t.replace(/^([ \t]*)[*+][ \t]+(?=\S)/gm, "$1— ");
  t = t.replace(/^([ \t]*)-[ \t]+(?=\S)/gm, "$1— ");

  /* Ссылки: адрес нужен, он и остаётся — просто без скобок разметки. */
  t = t.replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1 ($2)");
  t = t.replace(/\[([^\]\n]+)\]\([^)\n]*\)/g, "$1");

  /* Цитаты и остатки таблиц. Таблицу превращаем в строку со знаком
     разделения: столбцы в моноширинном виде всё равно не выстроятся. */
  t = t.replace(/^ {0,3}> ?/gm, "");
  /* В правилах ниже намеренно [ \t], а не \s: \s включает перенос
     строки, и «конец строки» уезжал на конец следующей — строки
     таблицы склеивались в одну. */
  t = t.replace(/^[ \t]*\|[ \t:|-]+\|[ \t]*\n?/gm, "");
  t = t.replace(/^[ \t]*\|(.+)\|[ \t]*$/gm, (m, row) =>
    row.split("|").map(c => c.trim()).filter(Boolean).join(" · "));

  /* Больше двух пустых строк подряд — след от вырезанных разделителей. */
  return t.replace(/\n{3,}/g, "\n\n").trim();
}

/* Знак весов рисуем вектором, а не эмодзи ⚖.
   Эмодзи — цветной шрифт: он выглядит по-разному в каждой системе,
   а под градиентной заливкой через background-clip вовсе превращался
   в бесформенное пятно. Вектор наследует цвет темы и одинаков везде. */
/* Значки шапки — вектор, как и знак весов: наследуют цвет темы и
   выглядят одинаково во всех системах. На узких экранах остаются
   только они, подпись прячется. */
const SEARCH_SVG = `<svg class="pill-icon" viewBox="0 0 24 24" aria-hidden="true"
  fill="none" stroke="currentColor" stroke-width="1.8"
  stroke-linecap="round" stroke-linejoin="round">
  <circle cx="10.8" cy="10.8" r="6.6"/><path d="M15.6 15.6L20 20"/>
</svg>`;

const BELL_SVG = `<svg class="pill-icon" viewBox="0 0 24 24" aria-hidden="true"
  fill="none" stroke="currentColor" stroke-width="1.7"
  stroke-linecap="round" stroke-linejoin="round">
  <path d="M18 8.5a6 6 0 1 0-12 0c0 6-2 7.5-2 7.5h16s-2-1.5-2-7.5"/>
  <path d="M10.3 20a2 2 0 0 0 3.4 0"/>
</svg>`;

const SUN_SVG = `<svg class="pill-icon" viewBox="0 0 24 24" aria-hidden="true"
  fill="none" stroke="currentColor" stroke-width="1.7"
  stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="4.2"/>
  <path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4L17 7M7 17l-1.6 1.6"/>
</svg>`;

const MOON_SVG = `<svg class="pill-icon" viewBox="0 0 24 24" aria-hidden="true"
  fill="none" stroke="currentColor" stroke-width="1.7"
  stroke-linecap="round" stroke-linejoin="round">
  <path d="M20 14.2A8.4 8.4 0 0 1 9.8 4a8.4 8.4 0 1 0 10.2 10.2z"/>
</svg>`;

/* Знак в шапке. Были весы правосудия — от них отказались вместе с
   героем: сайт про финансы, а весы обещают суд.

   На 24 пикселях подробностей не бывает, поэтому здесь ровно две вещи:
   круг монеты и рубль внутри. Растущие столбики, которые есть в большом
   знаке, в такой размер уже не влезают читаемо — превратились бы в кашу
   из трёх палочек. */
const LOGO_SVG = `<svg class="logo-mark" viewBox="0 0 24 24" aria-hidden="true"
  fill="none" stroke="currentColor" stroke-width="1.6"
  stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="12" r="9.2"/>
  <path d="M9.9 7.2v9.6"/>
  <path d="M9.9 7.2h2.9a2.4 2.4 0 0 1 0 4.8H9.9"/>
  <path d="M8.2 14.1h5.2"/>
</svg>`;

/* ============ Значки нижней панели ============

   Своя горстка вместо готового набора: чужой набор — это лишний файл
   на пол-мегабайта ради шести картинок, а на телефоне каждый килобайт
   виден. Все нарисованы в одной сетке 24×24 одной толщиной линии,
   иначе в ряду они выглядят разнокалиберными. */
const TAB_ICONS = {
  situations: `<path d="M12 3.6 4.2 7.1v5.2c0 4.4 3.2 7.2 7.8 8.1 4.6-.9 7.8-3.7 7.8-8.1V7.1z"/>
    <path d="M12 9v4M12 16.2h.01"/>`,
  calc: `<rect x="4.6" y="3.2" width="14.8" height="17.6" rx="2.4"/>
    <path d="M8 7.6h8M8 11.6h.01M12 11.6h.01M16 11.6h.01M8 15.4h.01M12 15.4h.01M16 15.4v2.4"/>`,
  tools: `<path d="m12 3.4 1.9 4.6 4.7 1.9-4.7 1.9L12 16.4l-1.9-4.6-4.7-1.9 4.7-1.9z"/>
    <path d="M18.4 15.2l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8z"/>`,
  cabinet: `<circle cx="12" cy="8.2" r="3.6"/>
    <path d="M4.8 20c.6-3.7 3.6-6 7.2-6s6.6 2.3 7.2 6"/>`,
  /* «Моё дело» — кошелёк: раздел про деньги, и значок должен читаться
     без подписи, потому что подпись на телефоне мельче значка. */
  book: `<path d="M3.6 8.4a2 2 0 0 1 2-2h12.8a2 2 0 0 1 2 2v9.2a2 2 0 0 1-2 2H5.6a2 2 0 0 1-2-2z"/>
    <path d="M3.6 9.6h11.2M16.6 13.6h.01"/>`,
  more: `<circle cx="5.6" cy="12" r="1.5" fill="currentColor" stroke="none"/>
    <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/>
    <circle cx="18.4" cy="12" r="1.5" fill="currentColor" stroke="none"/>`,
};

const tabIcon = name => `<svg class="tabbar-icon" viewBox="0 0 24 24" aria-hidden="true"
  fill="none" stroke="currentColor" stroke-width="1.7"
  stroke-linecap="round" stroke-linejoin="round">${TAB_ICONS[name]}</svg>`;

/* ============ Нижняя панель и лист «Ещё» ============

   Зачем это вообще появилось. На телефоне было две навигации сразу:
   шапка разворачивалась в два ряда плиток, и вдобавок кнопка «Меню»
   открывала список из тринадцати пунктов. Человек не выбирает из
   тринадцати — он теряется и уходит.

   Теперь четыре главных раздела внизу, под большим пальцем, и всегда
   видно, где находишься. Остальное — в листе «Ещё», сгруппированное
   и с пояснениями: раздел, который надо объяснять одним словом, лучше
   объяснить одной строкой, чем прятать за непонятным названием.

   Почему именно эти четыре: «Что делать» — с него начинают, когда
   случилась беда; «Калькуляторы» — за ними приходят чаще всего;
   «ИИ» — то, за что платят; «Кабинет» — то, ради чего возвращаются.
   Главная доступна по логотипу в шапке, как принято везде. */
const MOBILE_TABS = [
  ["situations.html", "Что делать", "situations"],
  /* «Моё дело» стоит вторым, а не последним: это единственный раздел,
     куда заходят каждый день, и на телефоне он должен быть под пальцем.
     Пятая вкладка — это предел; шестую в ряд уже не втиснуть,
     не сделав подписи нечитаемыми. */
  ["book.html", "Моё дело", "book"],
  /* Внизу «Расчёты», а не «Калькуляторы»: слово длиннее всех остальных
     вместе взятых и на узком экране съедало место у соседей — подписи
     вставали вплотную и читались как одна строка. В шапке компьютера
     место есть, там осталось полное название. */
  ["calc.html", "Расчёты", "calc"],
  ["tools.html", "ИИ", "tools"],
  ["dashboard.html", "Кабинет", "cabinet"],
];

/* Разделы листа «Ещё». Второй строкой — зачем он нужен: без пояснения
   «Практикум» и «Ответы» звучат одинаково непонятно. */
const MOBILE_MORE = [
  ["Разделы", [
    ["index.html", "Главная", "Обзор и что нового"],
    ["clients.html", "Мои клиенты", "Учёт за тех, кого ведёте: ИП, ООО, самозанятые"],
    ["docs.html", "Документы", "32 готовых бланка — заполнить и распечатать"],
    ["knowledge.html", "База знаний", "Статьи простым языком"],
    ["courses.html", "Курсы", "Пошаговое обучение"],
    ["games.html", "Практикум", "Разбор ситуаций на примерах"],
    ["answers.html", "Ответы", "Вопросы других людей"],
    ["expenses.html", "Дневник трат", "Куда уходят деньги"],
  ]],
  ["Справка", [
    ["faq.html", "Частые вопросы", "Как устроен сервис"],
    ["about.html", "О сервисе", "Кто мы и как связаться"],
    ["legal.html", "Правовые документы", "Оферта и обработка данных"],
  ]],
];

function scrollToTop(e) {
  e.preventDefault();
  scrollTo({ top: 0, behavior: "smooth" });
}
window.scrollToTop = scrollToTop;

function renderMobileNav(active, u) {
  document.querySelector(".tabbar")?.remove();
  document.querySelector(".sheet-backdrop")?.remove();

  /* «Ещё» подсвечиваем, только если открытая страница действительно
     лежит в этом листе. Раньше подсвечивалось всё, чего нет среди
     четырёх вкладок, — и на странице входа горело «Ещё», хотя входа
     в листе нет. Подсветка, которая врёт, хуже её отсутствия: человек
     открывает лист и не находит того, что якобы выбрано. */
  const inSheet = MOBILE_MORE.some(([, items]) => items.some(([h]) => h === active))
    || active === "admin.html";

  /* Нажатие на раздел, в котором уже находишься, поднимает страницу
     наверх — так ведут себя все приложения, и рука тянется к этому сама.
     Иначе после долгой прокрутки надо листать обратно вручную. */
  const tab = ([href, label, icon]) => `
    <a href="${PF.href(href)}" class="tabbar-item${active === href ? " active" : ""}"
       ${active === href ? 'onclick="scrollToTop(event)"' : ""}>
      ${tabIcon(icon)}<span>${label}</span>
    </a>`;

  const bar = document.createElement("nav");
  bar.className = "tabbar";
  bar.setAttribute("aria-label", "Основные разделы");
  bar.innerHTML = MOBILE_TABS.map(tab).join("") + `
    <button class="tabbar-item${inSheet ? " active" : ""}" onclick="openMoreSheet()" aria-label="Ещё разделы">
      ${tabIcon("more")}<span>Ещё</span>
    </button>`;
  document.body.appendChild(bar);

  const group = ([title, items]) => `
    <p class="sheet-title">${title}</p>
    <div class="sheet-group">
      ${items.map(([href, label, hint]) => `
        <a href="${PF.href(href)}" class="sheet-item${active === href ? " active" : ""}">
          <span class="sheet-label">${label}</span>
          <span class="sheet-hint">${hint}</span>
        </a>`).join("")}
    </div>`;

  const admin = u && u.isAdmin
    ? group(["Управление", [["admin.html", "Админ-панель", "Люди, оплаты, вопросы"]]])
    : "";

  const back = document.createElement("div");
  back.className = "sheet-backdrop";
  back.onclick = e => { if (e.target === back) closeMoreSheet(); };
  back.innerHTML = `
    <div class="sheet" role="dialog" aria-label="Ещё разделы">
      <div class="sheet-grip" onclick="closeMoreSheet()"></div>
      ${MOBILE_MORE.map(group).join("")}
      ${admin}
      <p class="sheet-title">Оформление</p>
      <div class="sheet-group">
        <button class="sheet-item" onclick="toggleTheme()">
          <span class="sheet-label">Сменить тему</span>
          <span class="sheet-hint">Светлая или тёмная</span>
        </button>
      </div>
      <button class="btn ghost sheet-close" onclick="closeMoreSheet()">Закрыть</button>
    </div>`;
  document.body.appendChild(back);
}

/* Лист открывается и закрывается сменой класса на body: так заодно
   блокируется прокрутка страницы под ним — иначе палец листает фон,
   а не список, и это выглядит поломкой. */
/* «Назад» должна закрывать лист, а не уводить со страницы.
 *
 * На телефоне это главная кнопка, и человек жмёт её рефлекторно, чтобы
 * закрыть то, что открылось поверх. Если она вместо этого уносит на
 * предыдущую страницу, ощущение — будто сайт «выкинул». Поэтому при
 * открытии добавляем шаг в историю и снимаем его при закрытии.
 *
 * Флаг нужен, чтобы не запутаться: закрытие бывает и по кнопке «Назад»
 * (шаг уже снят системой), и по крестику (шаг надо снять самим). */
let sheetInHistory = false;

function openMoreSheet() {
  if (document.body.classList.contains("sheet-open")) return;
  document.body.classList.add("sheet-open");
  history.pushState({ sheet: true }, "");
  sheetInHistory = true;
}

function closeMoreSheet() {
  if (!document.body.classList.contains("sheet-open")) return;
  document.body.classList.remove("sheet-open");
  if (sheetInHistory) {
    sheetInHistory = false;
    history.back();
  }
}

addEventListener("popstate", () => {
  if (document.body.classList.contains("sheet-open")) {
    sheetInHistory = false;      // шаг уже снят системой
    closeMoreSheet();
  }
});
window.openMoreSheet = openMoreSheet;
window.closeMoreSheet = closeMoreSheet;

/* Выбранную плитку подтягиваем в видимую часть строки.

   Ряд прокручивается вбок, и выбранный пункт может оказаться за краем
   экрана — человек открывает страницу и не видит, что именно выбрано.
   Делаем это после отрисовки страницы и только на узком экране: на
   широком строка не прокручивается, и дёргать её незачем. */
function scrollActiveTabIntoView() {
  if (window.innerWidth > 860) return;
  for (const row of document.querySelectorAll(".tabs")) {
    const active = row.querySelector(".tab.active");
    if (!active) continue;
    /* Ставим по центру, а не к краю: так видно и соседей,
       и сразу понятно, что ряд можно листать. */
    const shift = active.offsetLeft - (row.clientWidth - active.offsetWidth) / 2;
    row.scrollTo({ left: Math.max(0, shift), behavior: "instant" });
  }
}
window.addEventListener("load", scrollActiveTabIntoView);
document.addEventListener("click", e => {
  if (e.target.closest(".tabs .tab")) setTimeout(scrollActiveTabIntoView, 0);
});

/* ============ Меню шапки: лишнее уходит в «Ещё» ============

   Меню объявлено горизонтальной прокруткой. На телефоне это верно: ряд
   листают пальцем, обрезанный край последней плитки сам приглашает это
   сделать. На компьютере — нет: мышью такой ряд не листают, признака
   прокрутки не видно, и пункты просто пропадают.

   Так и было: у вошедшего человека меню требовало 818 пикселей при
   доступных 711, и «База знаний» с «Кабинетом» уезжали под кнопку
   аккаунта. Глазами это не поймать — выглядит, будто разделов нет.

   Складываем непоместившееся в «Ещё». Ни один раздел не пропадает,
   шапка перестаёт обрезаться, и на любой ширине видно ровно столько,
   сколько влезло.                                                     */
function fitNav() {
  const nav = document.querySelector(".site-header .nav-links");
  if (!nav) return;

  /* На телефоне меню переносится по строкам и прокрутки не требует —
     складывать там нечего. */
  if (innerWidth <= 860) {
    nav.querySelectorAll("a[hidden]").forEach(a => (a.hidden = false));
    const old = nav.querySelector(".nav-more");
    if (old) old.remove();
    return;
  }

  let more = nav.querySelector(".nav-more");
  if (!more) {
    more = document.createElement("div");
    more.className = "nav-more";
    more.innerHTML = `
      <button type="button" class="nav-more-btn" aria-haspopup="true" aria-expanded="false">Ещё</button>
      <div class="nav-more-list"></div>`;
    nav.appendChild(more);
    more.querySelector(".nav-more-btn").addEventListener("click", e => {
      e.stopPropagation();
      const open = more.classList.toggle("open");
      more.querySelector(".nav-more-btn").setAttribute("aria-expanded", String(open));
    });
    /* Клик мимо и Esc закрывают: раскрытый список, который не закрыть,
       перекрывает страницу и раздражает сильнее, чем помогает. */
    document.addEventListener("click", () => more.classList.remove("open"));
    document.addEventListener("keydown", e => {
      if (e.key === "Escape") more.classList.remove("open");
    });
  }

  const links = [...nav.querySelectorAll(":scope > a")];
  const list = more.querySelector(".nav-more-list");

  /* Считаем от нуля: сначала показываем всё, потом прячем лишнее.
     Иначе после расширения окна спрятанное так и осталось бы в «Ещё». */
  links.forEach(a => (a.hidden = false));
  more.hidden = true;
  list.innerHTML = "";

  const room = nav.clientWidth;
  const widthOf = el => el.getBoundingClientRect().width;
  const moreW = 62;   // запас под саму кнопку «Ещё»

  let used = 0;
  const overflow = [];
  for (const a of links) {
    used += widthOf(a);
    if (used > room - moreW) overflow.push(a);
  }

  /* Прячем в «Ещё» только если не поместилось больше одного: ради
     единственного пункта заводить выпадающий список — хуже, чем
     показать его. */
  if (overflow.length) {
    /* Если лишний ровно один, пробуем обойтись без кнопки: без неё
       освобождается как раз её ширина. */
    if (overflow.length === 1 && used <= room) {
      more.hidden = true;
      return;
    }
    for (const a of overflow) {
      a.hidden = true;
      const copy = a.cloneNode(true);
      copy.hidden = false;
      list.appendChild(copy);
    }
    more.hidden = false;
  }
}

let navFitTimer = 0;
addEventListener("resize", () => {
  clearTimeout(navFitTimer);
  navFitTimer = setTimeout(fitNav, 120);
});
addEventListener("load", fitNav);
document.addEventListener("pf:ready", fitNav);

/* ============ Общее модальное окно ============

   Окно с затемнением собиралось в коде трижды, каждый раз заново:
   создать подложку, повесить закрытие по клику, поставить overflow на
   body и не забыть его вернуть. Четвёртый раз писать то же самое —
   значит забыть одну из мелочей, обычно Esc или возврат прокрутки.

   Закрытие по Esc здесь не «приятная мелочь»: окно накрывает страницу
   целиком, и человек, не нашедший крестик, оказывается заперт. */
const MODAL = {
  open(title, html) {
    let bd = document.getElementById("appModal");
    if (!bd) {
      bd = document.createElement("div");
      bd.id = "appModal";
      bd.className = "modal-backdrop";
      document.body.appendChild(bd);
      bd.addEventListener("click", e => { if (e.target === bd) MODAL.close(); });
      document.addEventListener("keydown", e => {
        if (e.key === "Escape" && bd.classList.contains("open")) MODAL.close();
      });
    }
    bd.innerHTML = `<div class="modal">
      <button class="modal-x" onclick="MODAL.close()" aria-label="Закрыть">&times;</button>
      <h3 style="margin-bottom:12px">${escapeHtml(title)}</h3>
      ${html}
    </div>`;
    bd.classList.add("open");
    document.body.style.overflow = "hidden";
  },

  close() {
    const bd = document.getElementById("appModal");
    if (bd) { bd.classList.remove("open"); bd.innerHTML = ""; }
    document.body.style.overflow = "";
  },
};

/* ============ Шапка (вставляется на каждую страницу) ============ */
function renderHeader(active) {
  const u = PF.user();
  /* Состав шапки постоянный. Раньше он подстраивался под тип
     пользователя и из-за этого прятал разделы: «Практикум» не
     показывался никому, «ИИ-инструменты» исчезали, стоило указать
     статус в профиле. Человек не ищет пропавший пункт — он решает,
     что раздела нет. Предсказуемость здесь важнее умности. */
  const main = [
    /* «Что делать» стоит первым намеренно: человек приходит не за
       инструментом, а с бедой, и не знает, в какой раздел ему идти. */
    ["situations.html", "Что делать"],
    ["book.html", "Моё дело"],
    ["docs.html", "Документы"],
    ["tools.html", "ИИ-инструменты"],
    ["calc.html", "Калькуляторы"],
    ["knowledge.html", "База знаний"],
  ];

  const pages = [["index.html", "Главная"], ...main, ["dashboard.html", "Кабинет"]];
  /* Пункт «Админка» видят только админы и владелец. Прямой заход по адресу
     всё равно упрётся в проверку прав на сервере. */
  if (u && u.isAdmin) pages.push(["admin.html", "Админка"]);

  const shown = new Set(pages.map(([h]) => h));
  const rest = [
    ["games.html", "Практикум"], ["answers.html", "Ответы"], ["courses.html", "Курсы"],
    ["expenses.html", "Дневник трат"], ["search.html", "Поиск"], ["faq.html", "Вопросы"],
  ].filter(([h]) => !shown.has(h));

  const link = ([href, label]) =>
    `<a href="${PF.href(href)}" class="${active === href ? "active" : ""}">${label}</a>`;

  /* Никаких выпадающих меню: список в потоке накрывал соседние пункты,
     а спрятанный за кнопкой раздел люди просто не находят. */
  const links = pages.map(link).join("");
  /* На телефоне меню и так вертикальное, места хватает — показываем всё,
     чтобы «Практикум» и «Дневник трат» не приходилось искать в подвале.
     В шапке компьютера остаётся только нужное этому человеку. */
  const mobileLinks = links + rest.map(link).join("");
  const auth = u
    ? `<a href="${PF.href("dashboard.html")}" class="btn small">${avatarHtml(u)}${escapeHtml(u.name.split(" ")[0])}</a>`
    : `<a href="${PF.href("auth.html")}" class="btn small">Войти</a>`;
  const dark = document.documentElement.getAttribute("data-theme") === "dark";
  const themeLabel = dark ? "Тёмная тема" : "Светлая тема";
  const themeIcon = dark ? MOON_SVG : SUN_SVG;
  const header = document.createElement("header");
  header.className = "site-header";
  header.innerHTML = `
    <div class="container nav">
      <a href="${PF.href("index.html")}" class="logo">${LOGO_SVG}<span class="logo-name">Эко<b>Фин</b></span></a>
      <button class="nav-burger" onclick="this.closest('.site-header').classList.toggle('menu-open')" aria-label="Меню">Меню</button>
      <nav class="nav-links">${links}</nav>
      ${u ? `<button class="header-pill notif-btn" onclick="NOTIFY.open()" title="Уведомления" aria-label="Уведомления">${BELL_SVG}<span class="pill-text">Уведомления</span></button>` : ""}
      <button class="header-pill" onclick="PALETTE.show()" title="Быстрый поиск — Ctrl+K" aria-label="Быстрый поиск">${SEARCH_SVG}<span class="pill-text">Поиск</span></button>
      <button class="header-pill theme-toggle" onclick="toggleTheme()" title="Сменить тему" aria-label="Сменить тему">${themeIcon}<span class="pill-text">${themeLabel}</span></button>
      ${auth}
    </div>
    <nav class="mobile-menu">${mobileLinks}</nav>`;
  document.body.prepend(header);
  renderMobileNav(active, u);
}

function renderFooter() {
  const f = document.createElement("footer");
  f.className = "site-footer";
  const L = (href, label) => `<a href="${PF.href(href)}">${label}</a>`;
  f.innerHTML = `<div class="container">
    <p><b>ЭкоФин</b> — экосистема финансовой и юридической грамотности © 2026</p>
    <p class="footer-nav">
      ${L("situations.html", "Что делать")} · ${L("book.html", "Моё дело")} ·
      ${L("docs.html", "Документы")} ·
      ${L("tools.html", "Инструменты")} · ${L("calc.html", "Калькуляторы")} ·
      ${L("knowledge.html", "База знаний")} · ${L("courses.html", "Курсы")} ·
      ${L("answers.html", "Ответы на вопросы")} · ${L("games.html", "Практикум")} ·
      ${L("expenses.html", "Дневник трат")} ·
      ${L("features.html", "Все возможности")} · ${L("search.html", "Поиск")}
    </p>
    <p>${L("about.html", "О сервисе")} · ${L("about.html#contact", "Связаться")} ·
       ${L("faq.html", "Частые вопросы")} · ${L("legal.html", "Правовые документы")}</p>
    <p>Материалы носят информационный характер и не являются юридической консультацией.</p>
  </div>`;
  document.body.appendChild(f);
}

/* ============ Аналитика ============
   Без цифр нельзя понять, на каком шаге люди уходят и что чинить.
   Метрика подключается одной строкой: впишите номер счётчика из
   metrika.yandex.ru в METRIKA_ID — код счётчика загрузится сам.
   Пока ID пустой, события просто пишутся в консоль и никуда не уходят. */
const METRIKA_ID = "";

function initAnalytics() {
  if (!METRIKA_ID) return;
  /* Счётчик грузим отложенно, чтобы он не тормозил первую отрисовку. */
  const load = () => {
    (function (m, e, t, r, i, k, a) {
      m[i] = m[i] || function () { (m[i].a = m[i].a || []).push(arguments); };
      m[i].l = 1 * new Date();
      k = e.createElement(t); a = e.getElementsByTagName(t)[0];
      k.async = 1; k.src = r; a.parentNode.insertBefore(k, a);
    })(window, document, "script", "https://mc.yandex.ru/metrika/tag.js", "ym");
    window.ym(METRIKA_ID, "init", {
      clickmap: true,
      trackLinks: true,
      accurateTrackBounce: true,
      webvisor: true,
    });
  };
  if (document.readyState === "complete") load();
  else window.addEventListener("load", load);
}

/* Ключевые события воронки. Названия совпадают с целями, которые нужно
   завести в Метрике: register, login, tool_use, paywall, pay_click,
   pay_success, referral_share, analyze_doc. */
function trackEvent(name, params) {
  if (METRIKA_ID && window.ym) window.ym(METRIKA_ID, "reachGoal", name, params);
  console.debug("[event]", name, params || "");
}

/* ============ Чат-виджет с ИИ-консультантом ============ */
function renderChatWidget() {
  const w = document.createElement("div");
  w.className = "chat-widget";
  w.innerHTML = `
    <div class="chat-box" id="chatBox">
      <div class="chat-header">ИИ-консультант <button onclick="clearChat()" title="Очистить историю" style="margin-right:10px;font-size:var(--t-sm)">Очистить</button><button onclick="chatToggle()">✕</button></div>
      <div class="chat-messages" id="chatMessages"></div>
      <div class="chat-input">
        <input type="text" id="chatInput" aria-label="Вопрос ИИ-консультанту" placeholder="Задайте вопрос..." onkeydown="if(event.key==='Enter')chatSend()">
        <button class="btn" onclick="chatSend()">➤</button>
      </div>
    </div>
    <button class="chat-toggle" onclick="chatToggle()">💬</button>`;
  document.body.appendChild(w);
}
function chatStore() {
  const u = PF.user();
  return "pf_chat_" + (u ? u.email : "guest");
}
function chatHistory() { return JSON.parse(localStorage.getItem(chatStore()) || "[]"); }
function chatSave(msgs) { localStorage.setItem(chatStore(), JSON.stringify(msgs.slice(-30))); }
function restoreChat() {
  const box = document.getElementById("chatBox");
  if (!box || box.dataset.restored) return;
  box.dataset.restored = "1";
  const msgs = chatHistory();
  if (msgs.length) {
    msgs.forEach(m => addMsg(m.role === "user" ? "user" : "bot", m.text));
  } else {
    addMsg("bot", "Здравствуйте! Я ИИ-консультант ЭкоФин. Задайте вопрос по праву, налогам или финансам — отвечу кратко и по делу.");
  }
}
function clearChat() {
  localStorage.removeItem(chatStore());
  document.getElementById("chatMessages").innerHTML = "";
  addMsg("bot", "История очищена. Задайте новый вопрос.");
}
function chatContext(text) {
  const hist = chatHistory().slice(-6)
    .map(m => (m.role === "user" ? "Пользователь: " : "Консультант: ") + m.text).join("\n");
  return hist ? "Контекст предыдущего диалога (учти его при ответе):\n" + hist + "\n\nНовый вопрос: " + text : text;
}
function chatToggle() {
  const box = document.getElementById("chatBox");
  box.classList.toggle("open");
  restoreChat();
  if (box.classList.contains("open")) {
    document.getElementById("chatMessages").scrollTop = 1e9;
  }
}
function addMsg(role, text) {
  const d = document.createElement("div");
  d.className = "chat-msg " + role;
  d.textContent = text;
  document.getElementById("chatMessages").appendChild(d);
  document.getElementById("chatMessages").scrollTop = 1e9;
}
async function chatSend() {
  const input = document.getElementById("chatInput");
  const text = input.value.trim();
  if (!text) return;

  /* Консультант — только для вошедших: иначе лимит не к кому привязать. */
  if (!PF.user()) {
    addMsg("bot", "Чтобы задать вопрос ИИ-консультанту, войдите или зарегистрируйтесь — это бесплатно.");
    setTimeout(() => (location.href = PF.href("auth.html")), 1600);
    return;
  }

  input.value = "";

  /* Вопрос сохраняем СРАЗУ, до всякой отправки. Раньше он попадал в
     историю только вместе с ответом — и пропадал, если человек уходил
     со страницы, не дождавшись. */
  const context = chatContext(text);
  chatSave([...chatHistory(), { role: "user", text }]);
  addMsg("user", text);

  try {
    trackEvent("ai_chat");
    const res = await API.aiJobs.ask(text, { kind: "chat", context });
    CHATJOBS.remember(res.id);
    CHATJOBS.watch();
  } catch (e) {
    if (e.isPaywall) {
      addMsg("bot", e.message);
      showPaywall();
    } else {
      addMsg("bot", "Не получилось: " + e.message);
    }
  }
}

/* ============ Ожидание ответов ИИ ============
   Ответ считает сервер, а не вкладка. Браузер помнит только номера
   задач: можно уйти на другую страницу, закрыть её и вернуться —
   ответ дождётся и встанет в переписку сам. */
const CHATJOBS = {
  timer: null,

  key() { return "pf_chat_jobs_" + (PF.user() ? PF.user().email : "guest"); },

  pending() {
    try { return JSON.parse(localStorage.getItem(this.key()) || "[]"); }
    catch { return []; }
  },
  save(ids) { localStorage.setItem(this.key(), JSON.stringify(ids.slice(-5))); },
  remember(id) {
    if (!id) return;
    this.save([...this.pending(), id]);
    /* Время начала переживает переход между страницами — иначе счётчик
       на новой странице пошёл бы с нуля и соврал. */
    try {
      const t = JSON.parse(localStorage.getItem("pf_chat_started") || "{}");
      t[id] = Date.now();
      localStorage.setItem("pf_chat_started", JSON.stringify(t));
    } catch {}
  },
  forget(id) {
    this.save(this.pending().filter(x => x !== id));
    try {
      const t = JSON.parse(localStorage.getItem("pf_chat_started") || "{}");
      delete t[id];
      localStorage.setItem("pf_chat_started", JSON.stringify(t));
    } catch {}
  },

  /* Пузырь ожидания рисуется по номеру задачи, чтобы на любой
     странице он появился ровно один раз. Подробный ответ модель пишет
     30–90 секунд: без счётчика такое ожидание выглядит зависшим. */
  get started() {
    try { return JSON.parse(localStorage.getItem("pf_chat_started") || "{}"); }
    catch { return {}; }
  },

  bubble(id) {
    let el = document.getElementById("job-" + id);
    if (el || !document.getElementById("chatMessages")) return el;
    el = document.createElement("div");
    el.className = "chat-msg bot thinking";
    el.id = "job-" + id;
    if (!this.started[id]) this.started[id] = Date.now();
    this.tickBubble(id);
    document.getElementById("chatMessages").appendChild(el);
    document.getElementById("chatMessages").scrollTop = 1e9;
    return el;
  },

  tickBubble(id) {
    const el = document.getElementById("job-" + id);
    if (!el) return;
    const sec = Math.round((Date.now() - (this.started[id] || Date.now())) / 1000);
    el.textContent = sec < 5
      ? "Думаю над ответом"
      : sec < 40
        ? `Думаю над ответом · ${sec} с`
        : `Ответ подробный, поэтому дольше обычного · ${sec} с`;
  },

  async tick() {
    const ids = this.pending();
    if (!ids.length) { this.stop(); return; }

    for (const id of ids) {
      let d;
      try { d = await API.aiJobs.status(id); }
      catch { this.forget(id); document.getElementById("job-" + id)?.remove(); continue; }

      const job = d.job;
      if (!job || job.status === "pending") { this.bubble(id); this.tickBubble(id); continue; }

      const answer = job.status === "done"
        ? job.answer
        : "Не получилось получить ответ. Попробуйте спросить ещё раз.";

      /* В историю дописываем один раз: если вкладок несколько,
         вторая увидит, что ответ уже сохранён. */
      const hist = chatHistory();
      const already = hist.some(m => m.jobId === id);
      if (!already) chatSave([...hist, { role: "bot", text: answer, jobId: id }]);

      const el = document.getElementById("job-" + id);
      if (el) {
        el.classList.remove("thinking");
        el.textContent = answer;
        el.removeAttribute("id");
        if (job.status === "done") QAOFFER.attach(el, id);
      } else if (document.getElementById("chatMessages") && !already) {
        addMsg("bot", answer);
      }
      this.forget(id);
      refreshSession();
    }

    if (!this.pending().length) this.stop();
  },

  /* Значок чата подсвечен, пока ответ готовится: человек видит это
     на любой странице, даже не открывая переписку. */
  mark(busy) {
    document.querySelector(".chat-toggle")?.classList.toggle("busy", busy);
  },

  watch() {
    this.pending().forEach(id => this.bubble(id));
    this.mark(true);
    if (this.timer) return;
    this.tick();
    this.timer = setInterval(() => this.tick(), 2500);
  },
  stop() { clearInterval(this.timer); this.timer = null; this.mark(false); },

  /* При открытии любой страницы подбираем всё, что осталось висеть:
     и то, что помнит эта вкладка, и то, что сервер уже досчитал. */
  async resume() {
    if (!PF.user()) return;
    if (this.pending().length) return this.watch();
    try {
      const d = await API.aiJobs.list();
      const hist = chatHistory();
      const lost = (d.jobs || []).filter(
        j => j.kind === "chat" && j.status === "pending" && !hist.some(m => m.jobId === j.id));
      if (lost.length) { this.save(lost.map(j => j.id)); this.watch(); }
    } catch {}
  },
};

/* ============ Предложить разбор в общую ленту ============
   Ответ, который видит один человек, пропадает. Опубликованный
   отвечает следующему, кто искал то же самое, и приводит людей из
   поиска — лента растёт сама.

   Только по согласию и только после проверки владельцем: в вопросы
   вставляют суммы, имена и реквизиты. Имя автора не показывается. */
const QAOFFER = {
  topics: ["Налоги", "Договоры", "Работники", "ИП и ООО",
           "Самозанятость", "Проверки и штрафы", "Деньги и счета", "Общее"],

  attach(afterEl, jobId) {
    if (!PF.user() || afterEl.nextElementSibling?.classList?.contains("qa-offer")) return;
    const box = document.createElement("div");
    box.className = "qa-offer";
    box.innerHTML = `
      <span>Разрешить опубликовать этот разбор? Поможет тем, кто ищет то же самое.
        Имя и почта не показываются.</span>
      <div class="row">
        <select class="qa-topic">${this.topics.map(t => `<option>${escapeHtml(t)}</option>`).join("")}</select>
        <button class="btn small" data-job="${jobId}">Опубликовать</button>
        <button class="btn small secondary">Не нужно</button>
      </div>`;

    const [publish, skip] = box.querySelectorAll("button");
    publish.onclick = () => this.send(box, jobId, box.querySelector(".qa-topic").value);
    skip.onclick = () => box.remove();
    afterEl.after(box);
  },

  async send(box, jobId, topic) {
    box.innerHTML = `<span>Отправляем…</span>`;
    try {
      const d = await API.request("/api/qa/offer", { method: "POST", body: { jobId, topic } });
      box.innerHTML = d.already
        ? `<span>Этот разбор уже предложен.</span>`
        : `<span>Спасибо! Разбор появится в <a href="${PF.href("answers.html")}">общей ленте</a> после проверки.</span>`;
      trackEvent("qa_offer");
    } catch (e) {
      box.innerHTML = `<span>Не получилось: ${escapeHtml(e.message)}</span>`;
    }
  },
};

/* ============ Пробный период ============
   Три дня «Про» без карты. Самый сильный довод в продаже: человек,
   который три дня пользовался безлимитом, платит охотнее того, кому
   показали список возможностей. */
const TRIAL = {
  state: null,

  async check() {
    if (!PF.user()) return null;
    if (this.state) return this.state;
    try { this.state = await API.billing.trialStatus(); }
    catch { this.state = { available: false }; }
    return this.state;
  },

  /* Плашка предложения. Возвращает пустую строку, если пробный уже был, —
     удобно вставлять куда угодно без лишних проверок. */
  banner() {
    if (!this.state || !this.state.available) return "";
    return `
      <div class="trial-banner">
        <div>
          <b>Попробуйте «Про» ${this.state.days} дня бесплатно</b>
          <span>Карта не нужна. Разбор документов без лимита, напоминания в Telegram,
            все курсы. По окончании тариф сам вернётся на «Старт» — ничего не спишется.</span>
        </div>
        <button class="btn" onclick="TRIAL.start(this)">Включить бесплатно</button>
      </div>`;
  },

  async start(btn) {
    if (btn) { btn.disabled = true; btn.textContent = "Включаем…"; }
    try {
      const d = await API.billing.trial();
      trackEvent("trial_start");
      toast(`Готово! «Про» на ${d.days} дня — до ${new Date(d.until).toLocaleDateString("ru-RU")}`);
      setTimeout(() => location.reload(), 1300);
    } catch (e) {
      toast(e.message, "error");
      if (btn) { btn.disabled = false; btn.textContent = "Включить бесплатно"; }
    }
  },
};

/* ============ Тарифы и оплата ============
   Три уровня вместо одного. Смысл именно в среднем: рядом с «Базовым»
   за 290 старший тариф выглядит выбором, а не преградой, и человек
   сравнивает тарифы между собой, а не «платить или не платить». */
const PAY = {
  data: null,
  period: "year",   // год открыт по умолчанию: так виднее выгода
  chosen: "basic",

  async open(planId) {
    if (!PF.user()) return (location.href = PF.href("auth.html"));
    if (planId) this.chosen = planId;

    let bd = document.getElementById("payBackdrop");
    if (!bd) {
      bd = document.createElement("div");
      bd.id = "payBackdrop";
      bd.className = "modal-backdrop";
      document.body.appendChild(bd);
      bd.addEventListener("click", e => { if (e.target === bd) PAY.close(); });
    }
    bd.classList.add("open");
    document.body.style.overflow = "hidden";
    bd.innerHTML = '<div class="modal"><p class="hint">Загружаем тарифы…</p></div>';

    try {
      this.data = await API.billing.plans();
      const pts = await API.points().catch(() => ({ balance: 0 }));
      this.balance = pts.balance || 0;
    } catch (e) {
      bd.innerHTML = `<div class="modal"><p>${escapeHtml(e.message)}</p></div>`;
      return;
    }
    /* Пробный показываем над ценами: попробовать проще, чем решиться
       заплатить, а после трёх дней безлимита разговор о цене другой. */
    await TRIAL.check();
    this.render();
  },

  close() {
    document.getElementById("payBackdrop")?.classList.remove("open");
    document.body.style.overflow = "";
  },

  setPeriod(p) { this.period = p; this.render(); },
  choose(id) { this.chosen = id; this.render(); },

  render() {
    const bd = document.getElementById("payBackdrop");
    if (!bd || !this.data) return;
    const paid = this.data.plans.filter(p => p.price.month > 0);
    const current = PF.user()?.tier || "free";
    const trialHtml = TRIAL.banner();

    bd.innerHTML = `
      <div class="modal pay-modal">
        <div class="settings-head">
          <h3>Тарифы</h3>
          <button class="btn small secondary" onclick="PAY.close()">Закрыть</button>
        </div>

        ${trialHtml}

        <div class="period-switch" role="tablist">
          <button role="tab" class="${this.period === "month" ? "on" : ""}" onclick="PAY.setPeriod('month')">На месяц</button>
          <button role="tab" class="${this.period === "year" ? "on" : ""}" onclick="PAY.setPeriod('year')">
            На год <span class="save">выгоднее</span>
          </button>
        </div>

        <div class="tier-grid">
          ${paid.map(p => this.card(p, current)).join("")}
        </div>

        ${(this.data.promises || []).length ? `
          <div class="promises">
            ${this.data.promises.map(pr => `
              <div class="promise">
                <b>${escapeHtml(pr.title)}</b>
                <span>${escapeHtml(pr.text)}</span>
              </div>`).join("")}
          </div>` : ""}

        ${this.balance > 0 ? `
          <p class="hint points-note">
            У вас <b>${this.balance}</b> баллов — спишем автоматически,
            до половины стоимости.
          </p>` : ""}

        ${this.data.enabled === false ? `
          <p class="pay-note">Приём оплаты картой пока не подключён.
          Получить доступ можно по промокоду или запросив его у администратора.</p>` : ""}

        <div class="promo-row">
          <input type="text" id="promoInput2" placeholder="Промокод">
          <button class="btn secondary" onclick="applyPromo('promoInput2')">Активировать</button>
        </div>

        ${this.data.enterprise ? `
          <div class="tier-enterprise">
            <div>
              <b>${escapeHtml(this.data.enterprise.title)}</b> · ${escapeHtml(this.data.enterprise.price)}
              <p class="hint">${escapeHtml(this.data.enterprise.tagline)}. ${this.data.enterprise.perks.map(escapeHtml).join(" · ")}</p>
            </div>
            <a class="btn small secondary" href="${PF.href("about.html#contact")}">Обсудить</a>
          </div>` : ""}
      </div>`;
  },

  card(p, current) {
    const price = p.price[this.period];
    const perMonth = this.period === "year" ? Math.round(price / 12) : price;
    const isCurrent = current === p.id;
    const best = p.id === "basic";

    return `
      <div class="tier ${this.chosen === p.id ? "chosen" : ""} ${best ? "best" : ""}" onclick="PAY.choose('${p.id}')">
        ${best ? '<span class="tier-flag">Чаще всего выбирают</span>' : ""}
        <b class="tier-title">${escapeHtml(p.title)}</b>
        <span class="tier-tagline">${escapeHtml(p.tagline)}</span>
        <div class="tier-price">
          <span class="tier-num">${perMonth.toLocaleString("ru-RU")} ₽</span>
          <span class="tier-per">в месяц</span>
        </div>
        ${this.period === "year"
          ? `<span class="tier-year">${price.toLocaleString("ru-RU")} ₽ за год —
               <b>${p.freeMonths} ${plural(p.freeMonths, "месяц", "месяца", "месяцев")} в подарок</b></span>`
          : `<span class="tier-year">списывается раз в месяц, отменить можно сразу</span>`}
        <ul class="tier-perks">${p.perks.map(x => `<li>${escapeHtml(x)}</li>`).join("")}</ul>
        ${p.worth ? `<p class="tier-worth">${escapeHtml(p.worth)}</p>` : ""}
        ${isCurrent
          ? '<span class="badge ok tier-current">Ваш тариф</span>'
          : `<button class="btn ${best ? "gold" : "secondary"} wide" onclick="event.stopPropagation();PAY.submit('${p.id}')">Выбрать</button>`}
      </div>`;
  },

  async submit(planId) {
    this.chosen = planId;
    trackEvent("pay_click", { plan: planId, period: this.period });
    try {
      const res = await API.billing.create(planId, this.period);
      if (res.confirmationUrl) { location.href = res.confirmationUrl; return; }
      toast("Платёж создан, но ссылка не пришла. Напишите в поддержку", "error");
    } catch (e) {
      toast(e.message, "error");
    }
  },
};

/* Персональное оформление — возможность тарифа «Про».
   Тема меняет всю палитру: фон, поверхности, текст, границы, градиенты.
   Тема и режим (светлый/тёмный) независимы, как в Telegram. */
const THEMING = {
  key: "pf_theme_id",

  current() { return localStorage.getItem(this.key) || ""; },

  /* Перерисовать под текущий режим. Зовётся и при смене темы,
     и при переключении светлая/тёмная. */
  refresh() {
    const id = this.current();
    const mode = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    if (!id || typeof applyThemePalette !== "function") {
      if (typeof clearThemePalette === "function") clearThemePalette();
      return;
    }
    applyThemePalette(id, mode);
  },

  set(id) {
    if (id) localStorage.setItem(this.key, id);
    else localStorage.removeItem(this.key);
    this.refresh();
  },
};

/* ============ Настройки профиля ============ */
const SETTINGS = {
  _avatar: "",
  _tab: "profile",

  open(tab) {
    const u = PF.user();
    if (!u) return (location.href = PF.href("auth.html"));
    this._avatar = u.avatar || "";
    this._tab = tab || "profile";

    let bd = document.getElementById("settingsBackdrop");
    if (!bd) {
      bd = document.createElement("div");
      bd.id = "settingsBackdrop";
      bd.className = "modal-backdrop";
      document.body.appendChild(bd);
      /* Клик по затемнению и Esc закрывают окно — обычное поведение,
         которого людям не хватало. */
      bd.addEventListener("click", e => { if (e.target === bd) SETTINGS.close(); });
    }
    bd.classList.add("open");
    document.body.style.overflow = "hidden";
    this.render();
  },

  close() {
    const bd = document.getElementById("settingsBackdrop");
    if (bd) bd.classList.remove("open");
    document.body.style.overflow = "";
  },

  tab(name) { this._tab = name; this.render(); },

  render() {
    const u = PF.user();
    if (!u) return;
    const bd = document.getElementById("settingsBackdrop");
    const tabs = [
      ["profile", "Профиль"],
      ["notify", "Уведомления"],
      ["look", "Оформление"],
      ["security", "Безопасность"],
      ["subscription", "Подписка"],
      ["data", "Данные"],
    ];

    bd.innerHTML = `
      <div class="modal settings-modal">
        <div class="settings-head">
          <h3>Настройки</h3>
          <button class="btn small secondary" onclick="SETTINGS.close()">Закрыть</button>
        </div>
        <div class="settings-tabs">
          ${tabs.map(([id, label]) =>
            `<button class="settings-tab ${this._tab === id ? "active" : ""}" onclick="SETTINGS.tab('${id}')">${label}</button>`).join("")}
        </div>
        <div class="settings-body">${this["render_" + this._tab](u)}</div>
      </div>`;
  },

  /* --- Вкладка «Профиль» --- */
  render_profile(u) {
    const emojis = ["Ю", "Ф", "⚖", "🧑‍💼", "👩‍💼", "🦉", "📊", "🛡"];
    const preview = this._avatar.startsWith("data:image/")
      ? `<img src="${escapeHtml(this._avatar)}" alt="">`
      : escapeHtml(this._avatar || (u.name || "?")[0].toUpperCase());

    return `
      <div class="avatar-editor">
        <span class="avatar big ${this._avatar.startsWith("data:image/") ? "has-photo" : ""}" id="avatarPreview">${preview}</span>
        <div class="avatar-actions">
          <button class="btn small" onclick="document.getElementById('avatarFile').click()">Загрузить фото</button>
          ${this._avatar.startsWith("data:image/")
            ? '<button class="btn small secondary" onclick="SETTINGS.pickAvatar(\'\')">Убрать фото</button>' : ""}
          <input type="file" id="avatarFile" aria-label="Фотография профиля" accept="image/*" style="display:none" onchange="SETTINGS.onPhoto(this.files[0])">
          <p class="hint">JPEG, PNG или WebP. Фото обрежется по центру в квадрат и сожмётся автоматически.</p>
        </div>
      </div>

      <div class="form-group">
        <label>…или выберите значок</label>
        <div class="avatar-row">
          ${emojis.map(a =>
            `<button class="avatar-option ${this._avatar === a ? "selected" : ""}" onclick="SETTINGS.pickAvatar('${a}')">${a}</button>`).join("")}
        </div>
      </div>

      <div class="form-group">
        <label for="setName">Как к вам обращаться</label>
        <input type="text" id="setName" value="${escapeHtml(u.name)}" maxlength="80" autocomplete="name">
      </div>

      <div class="form-group">
        <label>Электронная почта</label>
        <input type="text" value="${escapeHtml(u.email)}" disabled>
        <p class="hint">Почта — это логин, она не меняется. Нужен другой адрес —
          <a href="${PF.href("about.html#contact")}" target="_blank" rel="noopener">напишите в поддержку</a>.</p>
      </div>

      <button class="btn wide" onclick="SETTINGS.save()">Сохранить изменения</button>`;
  },

  /* --- Вкладка «Уведомления» --- */
  render_notify() {
    return `
      <h4>Telegram</h4>
      <p class="hint">Напоминания о сроках приходят в мессенджер — его открывают
      чаще, чем почту. Там же можно спросить консультанта и посмотреть ближайшие сроки.</p>
      <div id="tgBox" style="margin:14px 0">Загружаем…</div>

      <hr>
      <h4>Лента уведомлений</h4>
      <p class="hint">Всё, о чём мы напоминали. Хранится полгода.</p>
      <div id="notifBox" class="notif-list">Загружаем…</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn small secondary" onclick="NOTIFY.readAll()">Отметить прочитанным</button>
        <button class="btn small secondary" onclick="NOTIFY.clear()">Очистить</button>
      </div>`;
  },

  async loadTelegram() {
    const box = document.getElementById("tgBox");
    if (!box) return;
    try {
      const d = await API.telegram.status();
      if (!d.enabled) { box.innerHTML = `<p class="hint">Бот пока не подключён к сервису.</p>`; return; }

      if (d.linked) {
        box.innerHTML = `
          <p><span class="badge ok">подключён</span>
          ${d.username ? " @" + escapeHtml(d.username) : ""}
          ${d.linkedAt ? `<span class="hint"> · с ${new Date(d.linkedAt).toLocaleDateString("ru-RU")}</span>` : ""}</p>
          <br><button class="btn small secondary" onclick="SETTINGS.unlinkTelegram()">Отключить Telegram</button>`;
        return;
      }

      box.innerHTML = `
        <button class="btn" onclick="SETTINGS.linkTelegram()">Подключить Telegram</button>
        <p class="hint" style="margin-top:8px">Займёт полминуты: выдадим короткий код и ссылку на бота.</p>`;
    } catch (e) {
      box.innerHTML = `<p class="hint">Не удалось загрузить: ${escapeHtml(e.message)}</p>`;
    }
  },

  async linkTelegram() {
    const box = document.getElementById("tgBox");
    box.innerHTML = "Готовим код…";
    try {
      const d = await API.telegram.link();
      box.innerHTML = `
        <ol class="tg-steps">
          <li>Откройте бота <b>@${escapeHtml(d.bot)}</b></li>
          <li>Отправьте ему этот код</li>
        </ol>
        <div class="tg-code">${escapeHtml(d.code)}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <a class="btn" href="${escapeHtml(d.deepLink)}" target="_blank" rel="noopener">Открыть бота</a>
          <button class="btn secondary" onclick="SETTINGS.loadTelegram()">Я подключил, проверить</button>
        </div>
        <p class="hint" style="margin-top:8px">Код действует ${d.expiresIn} минут.
        По ссылке код подставится сам.</p>`;
      trackEvent("telegram_link_start");
    } catch (e) {
      box.innerHTML = `<p class="hint">${escapeHtml(e.message)}</p>`;
    }
  },

  async unlinkTelegram() {
    if (!confirm("Отключить Telegram? Напоминания останутся в кабинете на сайте.")) return;
    try {
      await API.telegram.unlink();
      toast("Telegram отключён");
      this.loadTelegram();
    } catch (e) { toast(e.message, "error"); }
  },

  /* --- Вкладка «Оформление» --- */
  render_look() {
    return `
      <h4>Режим</h4>
      <p class="hint">Работает с любой темой независимо.</p>
      <div class="theme-row">
        <button class="btn small ${document.documentElement.getAttribute("data-theme") !== "dark" ? "" : "secondary"}"
                onclick="applyTheme('light');SETTINGS.render()">Светлый</button>
        <button class="btn small ${document.documentElement.getAttribute("data-theme") === "dark" ? "" : "secondary"}"
                onclick="applyTheme('dark');SETTINGS.render()">Тёмный</button>
      </div>

      <hr>
      <h4>Тема оформления</h4>
      <p class="hint">Меняет всю палитру сайта, а не только цвет кнопок.
      Входит в тариф «Про», сохраняется в аккаунте и работает на всех ваших устройствах.</p>
      <div id="accentBox" class="theme-grid">Загружаем…</div>`;
  },

  async loadThemes() {
    const box = document.getElementById("accentBox");
    if (!box) return;
    try {
      const d = await API.themes.list();
      const mode = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
      const list = typeof themeList === "function" ? themeList() : [];

      box.innerHTML = list.map(t => {
        const c = t[mode];
        const locked = !d.allowed && t.id !== "default";
        const on = (d.current || "default") === t.id;
        /* Миниатюра показывает саму тему — фон, карточку и акцент,
           чтобы было видно, что получишь, ещё до нажатия. */
        return `
          <button class="theme-card ${on ? "on" : ""} ${locked ? "locked" : ""}"
                  onclick="SETTINGS.pickTheme('${t.id}')" title="${escapeHtml(t.title)}">
            <span class="theme-prev" style="background:${c.bg}">
              <span class="theme-prev-bar" style="background:${c.surface}"></span>
              <span class="theme-prev-line" style="background:${c.accent}"></span>
              <span class="theme-prev-line short" style="background:${c.accent};opacity:.4"></span>
            </span>
            <span class="theme-name">${escapeHtml(t.title)}</span>
            ${locked ? '<span class="accent-lock">Про</span>' : ""}
            ${on ? '<span class="theme-tick">✓</span>' : ""}
          </button>`;
      }).join("");
    } catch (e) {
      box.innerHTML = `<p class="hint">Не удалось загрузить: ${escapeHtml(e.message)}</p>`;
    }
  },

  async pickTheme(id) {
    const send = id === "default" ? "" : id;
    /* Показываем сразу, не дожидаясь сервера: выбор темы должен
       ощущаться мгновенно. Откатим, если сервер откажет. */
    const before = THEMING.current();
    THEMING.set(send);
    try {
      await API.themes.set(send);
      toast(send ? "Тема применена" : "Вернули тему сервиса");
      this.loadThemes();
    } catch (e) {
      THEMING.set(before);
      this.loadThemes();
      if (e.isPaywall) { this.close(); showPaywall(e.message); }
      else toast(e.message, "error");
    }
  },

  /* --- Вкладка «Безопасность» --- */
  render_security() {
    return `
      <div class="form-group">
        <label for="setOldPass">Текущий пароль</label>
        <input type="password" id="setOldPass" placeholder="••••••••" autocomplete="current-password">
      </div>
      <div class="form-group">
        <label for="setNewPass">Новый пароль</label>
        <input type="password" id="setNewPass" placeholder="минимум 8 символов"
               autocomplete="new-password" oninput="SETTINGS.strength(this.value)">
        <div class="pw-meter"><div id="pwBar"></div></div>
        <p class="hint" id="pwHint">Надёжнее всего — три несвязанных слова подряд.</p>
      </div>
      <button class="btn wide secondary" onclick="SETTINGS.changePass()">Изменить пароль</button>
      <p class="hint" style="margin-top:8px">
        После смены пароля все остальные устройства выйдут из аккаунта. Текущее — останется.
      </p>

      <hr>
      <h4>Мои устройства</h4>
      <p class="hint">Каждый вход создаёт отдельную сессию. Сессия живёт 30 дней.</p>
      <div id="sessionsList" class="sessions-list">Загружаем…</div>
      <button class="btn wide danger" onclick="SETTINGS.logoutAll()">Выйти на всех других устройствах</button>`;
  },

  /* --- Вкладка «Подписка» --- */
  render_subscription(u) {
    const q = PF.quota;
    const until = u.proUntil ? new Date(u.proUntil).toLocaleDateString("ru-RU") : null;
    const daysLeft = u.proUntil ? Math.ceil((u.proUntil - Date.now()) / 86400000) : null;

    const status = u.isAdmin
      ? `<span class="badge pro">Полный доступ по роли</span>`
      : u.tier === "free"
        ? `<span class="badge">Старт — бесплатный тариф</span>`
        : `<span class="badge pro">${escapeHtml(u.planTitle || "Подписка")}</span>` +
          (until ? ` до ${until} (осталось ${daysLeft} дн.)` : " бессрочно");

    const limits = !q ? "<li>Проверяем остатки…</li>" : [
      q.ai.limit >= 300
        ? "<li>ИИ-консультант — без дневного лимита</li>"
        : `<li>Вопросов ИИ сегодня: <b>${q.ai.left}</b> из ${q.ai.limit}</li>`,
      q.tool.limit === null
        ? "<li>Инструменты — без ограничений</li>"
        : `<li>Пробных запусков инструментов: <b>${q.tool.left}</b> из ${q.tool.limit}</li>`,
      q.analyze && q.analyze.limit === null
        ? "<li>Разбор документов — без ограничений</li>"
        : q.analyze ? `<li>Разборов документов в этом месяце: <b>${q.analyze.left}</b> из ${q.analyze.limit}</li>` : "",
    ].join("");

    const history = (PF.payments || []).length
      ? `<hr><h4>История операций</h4>
         <div class="pay-history">
           ${PF.payments.map(x => `
             <div class="pay-row">
               <span>${new Date(x.created_at).toLocaleDateString("ru-RU")} · ${escapeHtml(String(x.plan))}</span>
               <b>${x.amount ? x.amount.toLocaleString("ru-RU") + " ₽" : (x.source === "promo" ? "промокод" : "подарок")}</b>
             </div>`).join("")}
         </div>` : "";

    return `
      <p style="margin-bottom:10px">Текущий тариф: ${status}</p>
      <ul class="limits-list">${limits}</ul>

      <div class="points-banner" style="margin-bottom:16px">
        <div>
          <span class="points-num">${u.points || 0}</span>
          <span class="points-cap">баллов</span>
        </div>
        <p class="hint">1 балл = 1 ₽ скидки, спишем автоматически при оплате —
        до половины стоимости. Заработать можно, приглашая друзей.</p>
      </div>

      <button class="btn gold wide" onclick="SETTINGS.close();PAY.open()">
        ${u.tier === "free" ? "Выбрать тариф" : "Сменить или продлить"}
      </button>
      <p class="hint" style="margin-top:8px">Автосписаний нет: подписка разовая и просто заканчивается в указанную дату.</p>
      ${history}`;
  },

  /* --- Вкладка «Данные» --- */
  render_data() {
    return `
      <h4>Выгрузка</h4>
      <p class="hint">Профиль и подписка хранятся на сервере и переносятся сами — на новом
      устройстве достаточно войти. Выгрузка нужна для черновиков документов, сроков
      и заметок, которые остаются в браузере.</p>
      <button class="btn wide secondary" onclick="SETTINGS.exportData()">Скачать мои данные (JSON)</button>

      <hr>
      <h4>Удаление аккаунта</h4>
      <p class="hint">Аккаунт, подписка и вся история будут стёрты с сервера безвозвратно.
      Оплаченный остаток подписки не возвращается.</p>
      <button class="btn wide danger" onclick="SETTINGS.deleteAccount()">Удалить аккаунт</button>`;
  },

  /* --- Действия --- */
  pickAvatar(a) { this._avatar = a; this.render(); },

  async onPhoto(file) {
    if (!file) return;
    try {
      toast("Обрабатываем фото…");
      this._avatar = await prepareAvatarPhoto(file);
      this.render();
      toast("Фото готово — не забудьте сохранить");
    } catch (e) { toast(e.message, "error"); }
  },

  /* Простая оценка пароля: длина важнее экзотических символов. */
  strength(v) {
    const bar = document.getElementById("pwBar");
    const hint = document.getElementById("pwHint");
    if (!bar) return;
    let score = 0;
    if (v.length >= 8) score++;
    if (v.length >= 12) score++;
    if (v.length >= 16) score++;
    if (/[^a-zA-Zа-яА-Я]/.test(v) && v.length >= 8) score++;
    const labels = ["слишком короткий", "слабый", "нормальный", "хороший", "отличный"];
    const colors = ["var(--danger)", "var(--danger)", "#d9a13a", "var(--accent)", "var(--accent)"];
    bar.style.width = (score / 4 * 100) + "%";
    bar.style.background = colors[score];
    hint.textContent = v ? "Пароль " + labels[score] : "Надёжнее всего — три несвязанных слова подряд.";
  },

  async save() {
    const name = document.getElementById("setName").value.trim();
    if (name.length < 2) return toast("Имя слишком короткое");
    try {
      await API.updateProfile({ name, avatar: this._avatar });
      toast("Сохранено");
      setTimeout(() => location.reload(), 600);
    } catch (e) { toast(e.message, "error"); }
  },

  async changePass() {
    const oldP = document.getElementById("setOldPass").value;
    const newP = document.getElementById("setNewPass").value;
    if (newP.length < 8) return toast("Новый пароль минимум 8 символов");
    if (newP === oldP) return toast("Новый пароль совпадает со старым");
    try {
      await API.changePassword(oldP, newP);
      toast("Пароль изменён. Другие устройства вышли из аккаунта");
      this.render();
    } catch (e) { toast(e.message, "error"); }
  },

  async loadSessions() {
    const box = document.getElementById("sessionsList");
    if (!box) return;
    try {
      const d = await API.sessions();
      box.innerHTML = d.sessions.map(x => `
        <div class="session-row">
          <span>Вход ${new Date(x.createdAt).toLocaleString("ru-RU")}</span>
          ${x.current ? '<span class="badge ok">это устройство</span>' : '<span class="badge">другое</span>'}
        </div>`).join("") || "<p class='hint'>Активных сессий нет</p>";
    } catch (e) { box.textContent = "Не удалось загрузить: " + e.message; }
  },

  async logoutAll() {
    if (!confirm("Выйти на всех других устройствах? Текущее останется в аккаунте.")) return;
    try {
      const r = await API.logoutEverywhere();
      toast(r.closed ? `Закрыто сессий: ${r.closed}` : "Других сессий не было");
      this.loadSessions();
    } catch (e) { toast(e.message, "error"); }
  },

  exportData() {
    const u = PF.user();
    if (!u) return;
    const data = {
      exported: new Date().toISOString(),
      profile: { email: u.email, name: u.name, plan: u.plan, proUntil: u.proUntil },
      documents: PF.docs(),
      deadlines: JSON.parse(localStorage.getItem("pf_deadlines_" + u.email) || "[]"),
      habits: JSON.parse(localStorage.getItem("pf_habits_" + u.email) || "{}"),
      courses: JSON.parse(localStorage.getItem("pf_course_" + u.email) || "{}"),
      expenses: JSON.parse(localStorage.getItem("pf_expenses_" + u.email) || "[]"),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "pravofin-" + u.email.split("@")[0] + ".json";
    a.click();
    URL.revokeObjectURL(a.href);
    toast("Данные выгружены");
  },

  async deleteAccount() {
    if (!confirm("Точно удалить аккаунт? Подписка и история будут стёрты безвозвратно.")) return;
    if (prompt('Для подтверждения введите слово "удалить"') !== "удалить") return toast("Отменено");
    try {
      await API.deleteAccount();
      toast("Аккаунт удалён");
      setTimeout(() => (location.href = PF.href("index.html")), 700);
    } catch (e) { toast(e.message, "error"); }
  },
};

/* Догружаем то, что нужно конкретной вкладке, после её отрисовки. */
const _settingsRender = SETTINGS.render.bind(SETTINGS);
SETTINGS.render = function () {
  _settingsRender();
  if (this._tab === "security") this.loadSessions();
  if (this._tab === "notify") { this.loadTelegram(); NOTIFY.render(); }
  if (this._tab === "look") this.loadThemes();
  if (this._tab === "subscription" && !PF.quota) {
    /* Остатки могли ещё не приехать — тянем и перерисовываем вкладку,
       иначе человек видит «проверяем…» и не понимает, что у него есть. */
    PF.refreshQuota().then(() => { if (this._tab === "subscription") _settingsRender(); });
  }
};

document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  const bd = document.getElementById("settingsBackdrop");
  if (bd && bd.classList.contains("open")) SETTINGS.close();
});

/* ============ Уведомления о сроках (браузерные) ============ */
const NOTIF = {
  enabled() { return typeof Notification !== "undefined" && Notification.permission === "granted"; },
  async enable() {
    if (typeof Notification === "undefined") return toast("Браузер не поддерживает уведомления");
    const p = await Notification.requestPermission();
    toast(p === "granted" ? "Уведомления включены — напомним о сроках" : "Уведомления не разрешены");
    return p === "granted";
  },
  /* Вызывается при входе в кабинет: предупреждаем о сроках ≤3 дней */
  checkDeadlines() {
    if (!this.enabled()) return;
    const u = PF.user();
    if (!u) return;
    const list = JSON.parse(localStorage.getItem("pf_deadlines_" + u.email) || "[]");
    const today = new Date().toISOString().slice(0, 10);
    const shown = JSON.parse(localStorage.getItem("pf_notif_shown_" + u.email) || "[]");
    list.forEach(d => {
      const days = Math.ceil((new Date(d.date) - new Date(today)) / 86400000);
      const id = d.date + "|" + d.title;
      if (days >= 0 && days <= 3 && !shown.includes(id)) {
        new Notification("ЭкоФин: срок на подходе", {
          body: `${d.title} — ${days === 0 ? "сегодня!" : "через " + days + " дн. (" + new Date(d.date).toLocaleDateString("ru-RU") + ")"}`,
        });
        shown.push(id);
      }
    });
    localStorage.setItem("pf_notif_shown_" + u.email, JSON.stringify(shown));
  },
};

/* ============ Уведомления ============
   Лента живёт на сайте независимо от Telegram: человек может не подключать
   бота и всё равно видеть, о чём мы напоминали. */
const NOTIFY = {
  items: [],
  unread: 0,

  async load() {
    if (!PF.user()) return;
    try {
      const d = await API.notifications.list();
      this.items = d.notifications;
      this.unread = d.unread;
      this.paintBell();
    } catch { /* тихо: колокольчик не критичен */ }
  },

  paintBell() {
    const btn = document.querySelector(".notif-btn");
    if (!btn) return;
    btn.querySelector(".notif-dot")?.remove();
    if (!this.unread) return;
    const dot = document.createElement("span");
    dot.className = "notif-dot";
    dot.textContent = this.unread > 9 ? "9+" : String(this.unread);
    btn.appendChild(dot);
  },

  open() {
    SETTINGS.open("notify");
  },

  render() {
    const box = document.getElementById("notifBox");
    if (!box) return;
    if (!this.items.length) {
      box.innerHTML = `<div class="empty"><b>Уведомлений нет</b>
        <p>Здесь появятся напоминания о сроках — за три дня, за день и в сам день.</p></div>`;
      return;
    }
    box.innerHTML = this.items.map(n => `
      <div class="notif-item ${n.read_at ? "" : "unread"}">
        <span>
          <span class="nt">${escapeHtml(n.title)}</span>
          ${n.body ? `<div class="nb">${escapeHtml(n.body)}</div>` : ""}
          <div class="nd">${new Date(n.created_at).toLocaleString("ru-RU")}</div>
        </span>
      </div>`).join("");
  },

  async readAll() {
    try {
      await API.notifications.read();
      this.unread = 0;
      this.items = this.items.map(n => ({ ...n, read_at: Date.now() }));
      this.render();
      this.paintBell();
    } catch (e) { toast(e.message, "error"); }
  },

  async clear() {
    if (!confirm("Очистить всю ленту уведомлений?")) return;
    try {
      await API.notifications.clear();
      this.items = []; this.unread = 0;
      this.render(); this.paintBell();
    } catch (e) { toast(e.message, "error"); }
  },
};

/* ============ Пейволл (окно подписки) ============

   Это самый дорогой экран сервиса: сюда человек попадает в момент, когда
   ему по-настоящему что-то нужно. Прежняя версия работала против нас:

   — говорила «Нужна подписка «Про»», хотя тарифов три, а почти все упоры
     снимает «Базовый» за 290 ₽ — и вела к самому дорогому;
   — не называла цену вообще (человек не знает, 200 это или 2000);
   — не предлагала три бесплатных дня, хотя принять их здесь проще всего.

   Теперь окно называет цену, показывает нужный тариф и первым делом
   предлагает попробовать бесплатно.                                    */

/* Какой тариф реально снимает конкретное ограничение. */
const PAYWALL_NEED = {
  ai: "basic", tool: "basic", analyze: "basic", reminders: "basic", telegram: "basic",
  courses: "pro", theming: "pro", priority: "pro",
};

function showPaywall(message, need) {
  let bd = document.getElementById("paywallBackdrop");
  if (!bd) {
    bd = document.createElement("div");
    bd.id = "paywallBackdrop";
    bd.className = "modal-backdrop";
    document.body.appendChild(bd);
    bd.addEventListener("click", e => { if (e.target === bd) closePaywall(); });
  }
  const q = PF.quota;
  const reason = message
    || (q && q.tool && q.tool.left === 0 ? "Пробный запуск инструментов израсходован."
    : q && q.ai && q.ai.left === 0 ? "Дневной лимит обращений к консультанту исчерпан."
    : "Эта возможность входит в платную подписку.");

  bd.dataset.need = need || "";
  bd.classList.add("open");
  bd.innerHTML = `
    <div class="modal paywall">
      <p class="paywall-reason">${escapeHtml(reason)}</p>
      <h3 class="paywall-title">Снимается подпиской</h3>
      <div class="paywall-body"><p class="hint">Смотрим тарифы…</p></div>
    </div>`;
  trackEvent("paywall", { reason, need: need || "" });
  paywallFill(reason, need);
}

/* Цены и пробный приходят с сервера — значит, на витрине всегда то,
   что реально спишется, и «три дня» показываются только тому,
   кто их ещё не брал. */
async function paywallFill(reason, need) {
  const bd = document.getElementById("paywallBackdrop");
  if (!bd) return;
  const box = bd.querySelector(".paywall-body");
  if (!box) return;

  let data = null;
  try { data = await API.billing.plans(); }
  catch {
    box.innerHTML = `
      <button class="btn gold wide" onclick="closePaywall();PAY.open()">Посмотреть тарифы</button>
      <button class="btn secondary small wide" onclick="closePaywall()">Позже</button>`;
    return;
  }
  await TRIAL.check();

  const paid = data.plans.filter(p => p.price.month > 0);
  const wanted = need && paid.find(p => p.id === need);
  /* По умолчанию показываем самый дешёвый платный: разговор должен
     начинаться с 290 ₽, а не с 690 — иначе человек не берёт ни то, ни то. */
  const plan = wanted || paid.slice().sort((a, b) => a.price.month - b.price.month)[0];
  if (!plan) { box.innerHTML = ""; return; }

  const money = n => n.toLocaleString("ru-RU");
  const perYearMonth = Math.round(plan.price.year / 12);
  const trial = TRIAL.state && TRIAL.state.available;

  box.innerHTML = `
    ${trial ? `
      <div class="paywall-trial">
        <b>Сначала попробуйте бесплатно</b>
        <span>${TRIAL.state.days} дня полного «Про». Карта не нужна, по окончании
          тариф сам вернётся на «Старт» — ничего не спишется.</span>
        <button class="btn gold wide" onclick="TRIAL.start(this)">Включить на ${TRIAL.state.days} дня</button>
      </div>
      <p class="paywall-or"><span>или подписка</span></p>` : ""}

    <div class="paywall-plan">
      <div class="paywall-plan-head">
        <b>${escapeHtml(plan.title)}</b>
        <span class="paywall-price">${money(plan.price.month)} ₽<i>в месяц</i></span>
      </div>
      <p class="paywall-year">За год — ${money(plan.price.year)} ₽, это ${money(perYearMonth)} ₽ в месяц.
        ${plan.freeMonths} ${plural(plan.freeMonths, "месяц", "месяца", "месяцев")} в подарок.</p>
      <ul class="paywall-perks">${plan.perks.map(x => `<li>${escapeHtml(x)}</li>`).join("")}</ul>
      ${plan.worth ? `<p class="paywall-worth">${escapeHtml(plan.worth)}</p>` : ""}
      <button class="btn ${trial ? "secondary" : "gold"} wide"
              onclick="closePaywall();PAY.open('${plan.id}')">Оформить «${escapeHtml(plan.title)}»</button>
    </div>

    <div class="paywall-foot">
      <button class="btn secondary small" onclick="closePaywall();PAY.open()">Сравнить все тарифы</button>
      <details class="paywall-promo">
        <summary>У меня есть промокод</summary>
        <div class="promo-row">
          <input type="text" id="promoInput" placeholder="Промокод">
          <button class="btn secondary" onclick="applyPromo('promoInput')">Активировать</button>
        </div>
      </details>
      <button type="button" class="paywall-later" onclick="closePaywall()">Не сейчас</button>
    </div>`;
}

function closePaywall() {
  const bd = document.getElementById("paywallBackdrop");
  if (bd) bd.classList.remove("open");
}

/* Промокоды проверяет сервер: подобрать код в консоли браузера нельзя. */
async function applyPromo(inputId) {
  const el = document.getElementById(inputId || "promoInput");
  const code = (el && el.value || "").trim();
  if (!code) return toast("Введите промокод");
  try {
    const res = await API.billing.promo(code);
    closePaywall();
    PAY.close();
    trackEvent("promo_success", { days: res.days });
    toast(`«Про» активирован на ${res.days} дн.`);
    setTimeout(() => location.reload(), 900);
  } catch (e) {
    toast(e.message, "error");
  }
}

/* Единая проверка перед запуском платной возможности.
   Возвращает true, если можно продолжать. Сервер всё равно перепроверит. */
function requirePro(feature, need) {
  if (!PF.user()) {
    toast("Сначала войдите — это бесплатно");
    setTimeout(() => (location.href = PF.href("auth.html?from=feature")), 1200);
    return false;
  }
  if (PF.isPro()) return true;
  const q = PF.quota;
  if (q && q.tool && q.tool.left > 0) return true;
  showPaywall(
    feature ? `«${feature}»: бесплатный пробный запуск уже израсходован.` : undefined,
    need || PAYWALL_NEED.tool
  );
  return false;
}

/* ============ Анимации появления при скролле ============ */
function initRevealAnimations() {
  // tab-panel исключены: скрытая панель не может «появиться» наблюдателем и остаётся прозрачной
  const els = [...document.querySelectorAll(".card, .game-stage, .article-item, .section-title, .hero-stats .hs")]
    .filter(el => !el.classList.contains("tab-panel") && !el.closest(".tab-panel"));
  els.forEach((el, i) => {
    el.classList.add("reveal");
    el.style.transitionDelay = (i % 4) * 70 + "ms";
  });
  /* threshold: 0 — показываем, как только виден первый пиксель.
     Было 0.08, и высокие карточки на телефоне не набирали этих восьми
     процентов площади до самого низа экрана. */
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add("visible");
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0, rootMargin: "0px 0px -4% 0px" });
  els.forEach(el => io.observe(el));

  /* Страховка. Наблюдатель сообщает о пересечениях по кадрам, а быстрый
     рывок пальцем на телефоне их пропускает: блок успевает проскочить
     мимо экрана между двумя кадрами и остаётся прозрачным навсегда.
     Так на главной десять блоков из тринадцати оставались невидимыми —
     человек листал пустые экраны и решал, что сайт сломан.

     Поэтому после каждой прокрутки досматриваем вручную: всё, что уже
     побывало на экране или выше него, показываем безусловно. Проверка
     дешёвая, идёт не чаще раза в кадр и только пока есть что показывать. */
  let waiting = false;
  const sweep = () => {
    waiting = false;
    const rest = els.filter(el => !el.classList.contains("visible"));
    for (const el of rest) {
      if (el.getBoundingClientRect().top < innerHeight) {
        el.classList.add("visible");
        io.unobserve(el);
      }
    }
    if (!rest.length) removeEventListener("scroll", onScroll);
  };
  const onScroll = () => {
    if (waiting) return;
    waiting = true;
    requestAnimationFrame(sweep);
  };
  /* Слушаем и окно, и документ с перехватом: если страница прокручивается
     не окном, а внутренним блоком, событие до окна не доходит вовсе —
     а перехват на документе видит и такие. Ещё поворот экрана: при нём
     меняется высота, и то, что было ниже края, оказывается на виду. */
  addEventListener("scroll", onScroll, { passive: true });
  document.addEventListener("scroll", onScroll, { passive: true, capture: true });
  addEventListener("resize", onScroll, { passive: true });
  addEventListener("orientationchange", onScroll, { passive: true });
  addEventListener("load", sweep);
  sweep();
}

/* Знаки денег, всплывающие в герое.
   Рубль встречается чаще остальных: сайт про российские налоги, и
   случайная россыпь, где долларов поровну с рублями, читалась бы как
   реклама обменника. Процент — про ставки и налоги, он тут по делу. */
const HERO_GLYPHS = ["₽", "₽", "₽", "%", "%", "$"];

function spawnHeroParticles(containerSelector = ".hero", count = 16) {
  const hero = document.querySelector(containerSelector);
  if (!hero) return;
  /* На телефонах и при включённом «уменьшить движение» знаков меньше или нет
     совсем: 16 анимированных элементов заметно греют слабый аппарат. */
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (innerWidth < 700) count = 6;
  for (let i = 0; i < count; i++) {
    const g = HERO_GLYPHS[Math.floor(Math.random() * HERO_GLYPHS.length)];
    const p = document.createElement("span");
    p.className = "hero-particle" + (g === "%" ? " pct" : "");
    p.textContent = g;
    /* Знак — это текст, и его читает озвучка экрана. Вслух «рубль доллар
       процент рубль» посреди заголовка — это мусор, а не украшение. */
    p.setAttribute("aria-hidden", "true");

    /* Разброс размеров больше, чем был у точек: одинаковые буквы одного
       кегля выглядят как строка, уехавшая не туда, а не как россыпь. */
    p.style.fontSize = (11 + Math.random() * 17).toFixed(1) + "px";
    p.style.left = Math.random() * 100 + "%";
    p.style.bottom = -(Math.random() * 30) - 20 + "px";
    p.style.setProperty("--drift", (Math.random() * 80 - 40).toFixed(0) + "px");
    p.style.setProperty("--spin", (Math.random() * 50 - 25).toFixed(0) + "deg");
    p.style.animationDuration = 9 + Math.random() * 12 + "s";
    p.style.animationDelay = Math.random() * 12 + "s";
    hero.appendChild(p);
  }
}

/* ============ Инициализация страницы ============ */
/* Сессию подтверждает сервер. До ответа рисуем по кэшу — чтобы не мигало,
   после ответа перерисовываем шапку, если роль или план изменились. */
async function refreshSession() {
  if (!API.token()) { API.setSession(null, null); return null; }
  try {
    const before = JSON.stringify(API.cached());
    const d = await API.me();
    PF.actions = d.actions || [];
    PF.payments = d.payments || [];
    /* Тема живёт в аккаунте: на новом устройстве она должна примениться
       сама, без похода в настройки. Сервер здесь — источник правды. */
    if (d.user) THEMING.set(d.user.themeAccent || "");
    await PF.refreshQuota();
    if (JSON.stringify(d.user) !== before) window.dispatchEvent(new CustomEvent("pf:userchanged"));
    return d.user;
  } catch (e) {
    if (e.status === 401) return null;   // сессия истекла, API уже почистил кэш
    return API.cached();                 // сеть отвалилась — работаем по кэшу
  }
}

function initPage(active) {
  initTheme();          // initTheme уже зовёт THEMING.refresh через applyTheme
  initAnalytics();
  renderHeader(active);
  renderFooter();
  renderChatWidget();
  /* Историю рисуем сразу, а не при первом открытии: иначе пузырь
     «думаю над ответом» встал бы выше предыдущих реплик. Вызов стоит
     здесь, а не внутри renderChatWidget, чтобы не зависеть от порядка
     объявлений в файле — на этом проект уже спотыкался. */
  restoreChat();
  CHATJOBS.resume();

  /* Ссылка из бота вида ?pay=1 или ?pay=pro сразу открывает оплату:
     иначе человек, пришедший платить, попадает в кабинет и должен
     искать кнопку сам. */
  const payParam = new URLSearchParams(location.search).get("pay");
  if (payParam && PF.user()) {
    const tier = ["basic", "pro"].includes(payParam) ? payParam : null;
    setTimeout(() => PAY.open(tier), 400);
    history.replaceState(null, "", location.pathname);
  }
  initRevealAnimations();

  /* Корень сайта. Страницы статей лежат в подпапке st/, и относительный
     путь «manifest.webmanifest» вёл бы у них в никуда — вместе с ним
     пропадало бы предложение установить приложение. */
  const ROOT = location.pathname.includes("/st/")
    ? location.pathname.replace(/\/st\/.*$/, "/")
    : "./";

  if (!document.querySelector('link[rel="manifest"]')) {
    const m = document.createElement("link");
    m.rel = "manifest";
    m.href = ROOT + "manifest.webmanifest";
    document.head.appendChild(m);
  }
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register(ROOT + "sw.js", { scope: ROOT }).catch(() => {});
  }

  /* Разлогин где угодно — сразу перерисовываем шапку. */
  window.addEventListener("pf:signedout", () => {
    document.querySelector(".site-header")?.remove();
    renderHeader(active);
  });

  refreshSession().then(user => {
    if (user) { NOTIFY.load(); askPendingQuestion(); }
    const header = document.querySelector(".site-header");
    if (header) { header.remove(); renderHeader(active); }
    document.dispatchEvent(new CustomEvent("pf:ready", { detail: { user } }));
  });
}

/* Человек задал вопрос на главной до регистрации. После входа задаём его
   сам — иначе он проделал работу зря и, скорее всего, уйдёт. */
function askPendingQuestion() {
  const q = sessionStorage.getItem("pf_pending_question");
  if (!q) return;
  sessionStorage.removeItem("pf_pending_question");
  setTimeout(() => {
    const input = document.getElementById("chatInput");
    if (!input) return;
    chatToggle();
    input.value = q;
    chatSend();
  }, 600);
}

/* Страницы, которым нужен вошедший пользователь, зовут это вместо своей проверки. */
function requireAuth() {
  if (!API.token()) { location.href = PF.href("auth.html"); return false; }
  return true;
}
