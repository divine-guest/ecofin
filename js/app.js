/* ============ ПравоФин — общая логика ============ */

/* Кэш пользователя нужен только чтобы шапка и кабинет рисовались без мигания.
   Все запреты живут на сервере: правка кэша в DevTools ничего не открывает. */
const PF = {
  themeKey: "pf_theme",

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
    location.href = "index.html";
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
  },
  prefs() { try { return JSON.parse(localStorage.getItem(this.localKey("prefs")) || "{}"); } catch { return {}; } },

  /* --- Мои документы: остаются в браузере, это черновики, а не аккаунт --- */
  docsKey() { const u = this.user(); return "pf_docs_" + (u ? u.email : "guest"); },
  docs() { try { return JSON.parse(localStorage.getItem(this.docsKey()) || "[]"); } catch { return []; } },
  saveDoc(title, content) {
    const docs = this.docs();
    docs.unshift({ title, content, date: new Date().toISOString() });
    localStorage.setItem(this.docsKey(), JSON.stringify(docs.slice(0, 50)));
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

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* Знак весов рисуем вектором, а не эмодзи ⚖.
   Эмодзи — цветной шрифт: он выглядит по-разному в каждой системе,
   а под градиентной заливкой через background-clip вовсе превращался
   в бесформенное пятно. Вектор наследует цвет темы и одинаков везде. */
/* Значки шапки — вектор, как и знак весов: наследуют цвет темы и
   выглядят одинаково во всех системах. На узких экранах остаются
   только они, подпись прячется. */
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

const SCALES_SVG = `<svg class="logo-mark" viewBox="0 0 24 24" aria-hidden="true"
  fill="none" stroke="currentColor" stroke-width="1.5"
  stroke-linecap="round" stroke-linejoin="round">
  <circle cx="12" cy="3.1" r="1.3" fill="currentColor" stroke="none"/>
  <path d="M12 4.6v14.6M8.6 19.2h6.8M4.5 7.4h15"/>
  <path d="M4.5 7.4 2 12.4M4.5 7.4 7 12.4M19.5 7.4 17 12.4M19.5 7.4 22 12.4"/>
  <path d="M2 12.4a2.5 2.5 0 0 0 5 0M17 12.4a2.5 2.5 0 0 0 5 0"/>
</svg>`;

/* ============ Шапка (вставляется на каждую страницу) ============ */
function renderHeader(active) {
  const u = PF.user();
  /* Состав шапки постоянный. Раньше он подстраивался под тип
     пользователя и из-за этого прятал разделы: «Практикум» не
     показывался никому, «ИИ-инструменты» исчезали, стоило указать
     статус в профиле. Человек не ищет пропавший пункт — он решает,
     что раздела нет. Предсказуемость здесь важнее умности. */
  const main = [
    ["tools.html", "ИИ-инструменты"],
    ["calc.html", "Калькуляторы"],
    ["games.html", "Практикум"],
    ["knowledge.html", "База знаний"],
  ];

  const pages = [["index.html", "Главная"], ...main, ["dashboard.html", "Кабинет"]];
  /* Пункт «Админка» видят только админы и владелец. Прямой заход по адресу
     всё равно упрётся в проверку прав на сервере. */
  if (u && u.isAdmin) pages.push(["admin.html", "Админка"]);

  const shown = new Set(pages.map(([h]) => h));
  const rest = [
    ["courses.html", "Курсы"], ["expenses.html", "Дневник трат"],
    ["search.html", "Поиск"], ["faq.html", "Вопросы"],
  ].filter(([h]) => !shown.has(h));

  const link = ([href, label]) =>
    `<a href="${href}" class="${active === href ? "active" : ""}">${label}</a>`;

  /* Никаких выпадающих меню: список в потоке накрывал соседние пункты,
     а спрятанный за кнопкой раздел люди просто не находят. */
  const links = pages.map(link).join("");
  /* На телефоне меню и так вертикальное, места хватает — показываем всё,
     чтобы «Практикум» и «Дневник трат» не приходилось искать в подвале.
     В шапке компьютера остаётся только нужное этому человеку. */
  const mobileLinks = links + rest.map(link).join("");
  const auth = u
    ? `<a href="dashboard.html" class="btn small">${avatarHtml(u)}${escapeHtml(u.name.split(" ")[0])}</a>`
    : `<a href="auth.html" class="btn small">Войти</a>`;
  const dark = document.documentElement.getAttribute("data-theme") === "dark";
  const themeLabel = dark ? "Тёмная тема" : "Светлая тема";
  const themeIcon = dark ? MOON_SVG : SUN_SVG;
  const header = document.createElement("header");
  header.className = "site-header";
  header.innerHTML = `
    <div class="container nav">
      <a href="index.html" class="logo">${SCALES_SVG}Право<b>Фин</b></a>
      <button class="nav-burger" onclick="this.closest('.site-header').classList.toggle('menu-open')" aria-label="Меню">Меню</button>
      <nav class="nav-links">${links}</nav>
      ${u ? `<button class="header-pill notif-btn" onclick="NOTIFY.open()" title="Уведомления" aria-label="Уведомления">${BELL_SVG}<span class="pill-text">Уведомления</span></button>` : ""}
      <button class="header-pill theme-toggle" onclick="toggleTheme()" title="Сменить тему" aria-label="Сменить тему">${themeIcon}<span class="pill-text">${themeLabel}</span></button>
      ${auth}
    </div>
    <nav class="mobile-menu">${mobileLinks}</nav>`;
  document.body.prepend(header);
}

function renderFooter() {
  const f = document.createElement("footer");
  f.className = "site-footer";
  f.innerHTML = `<div class="container">
    <p><b>ПравоФин</b> — экосистема юридической и финансовой грамотности © 2026</p>
    <p class="footer-nav">
      <a href="tools.html">Инструменты</a> · <a href="calc.html">Калькуляторы</a> ·
      <a href="knowledge.html">База знаний</a> · <a href="courses.html">Курсы</a> ·
      <a href="games.html">Практикум</a> · <a href="expenses.html">Дневник трат</a> ·
      <a href="search.html">Поиск</a>
    </p>
    <p><a href="about.html">О сервисе</a> · <a href="about.html#contact">Связаться</a> · <a href="faq.html">Частые вопросы</a> · <a href="legal.html">Правовые документы</a></p>
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
        <input type="text" id="chatInput" placeholder="Задайте вопрос..." onkeydown="if(event.key==='Enter')chatSend()">
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
    addMsg("bot", "Здравствуйте! Я ИИ-консультант ПравоФин. Задайте вопрос по праву, налогам или финансам — отвечу кратко и по делу.");
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
    setTimeout(() => (location.href = "auth.html"), 1600);
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

/* ============ Тарифы и оплата ============
   Три уровня вместо одного. Смысл именно в среднем: рядом с «Базовым»
   за 290 старший тариф выглядит выбором, а не преградой, и человек
   сравнивает тарифы между собой, а не «платить или не платить». */
const PAY = {
  data: null,
  period: "year",   // год открыт по умолчанию: так виднее выгода
  chosen: "basic",

  async open(planId) {
    if (!PF.user()) return (location.href = "auth.html");
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

    bd.innerHTML = `
      <div class="modal pay-modal">
        <div class="settings-head">
          <h3>Тарифы</h3>
          <button class="btn small secondary" onclick="PAY.close()">Закрыть</button>
        </div>

        <div class="period-switch" role="tablist">
          <button role="tab" class="${this.period === "month" ? "on" : ""}" onclick="PAY.setPeriod('month')">На месяц</button>
          <button role="tab" class="${this.period === "year" ? "on" : ""}" onclick="PAY.setPeriod('year')">
            На год <span class="save">выгоднее</span>
          </button>
        </div>

        <div class="tier-grid">
          ${paid.map(p => this.card(p, current)).join("")}
        </div>

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
            <a class="btn small secondary" href="about.html#contact">Обсудить</a>
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
          ? `<span class="tier-year">${price.toLocaleString("ru-RU")} ₽ за год · экономия ${p.yearDiscount}%</span>`
          : `<span class="tier-year">списывается раз в месяц</span>`}
        <ul class="tier-perks">${p.perks.map(x => `<li>${escapeHtml(x)}</li>`).join("")}</ul>
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
    if (!u) return (location.href = "auth.html");
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
          <input type="file" id="avatarFile" accept="image/*" style="display:none" onchange="SETTINGS.onPhoto(this.files[0])">
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
          <a href="about.html#contact" target="_blank" rel="noopener">напишите в поддержку</a>.</p>
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
      setTimeout(() => (location.href = "index.html"), 700);
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
        new Notification("ПравоФин: срок на подходе", {
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

/* ============ Пейволл (окно подписки) ============ */
function showPaywall(message) {
  let bd = document.getElementById("paywallBackdrop");
  if (!bd) {
    bd = document.createElement("div");
    bd.id = "paywallBackdrop";
    bd.className = "modal-backdrop";
    document.body.appendChild(bd);
  }
  const q = PF.quota;
  const reason = message
    || (q && q.tool && q.tool.left === 0 ? "Пробный запуск инструментов израсходован."
    : q && q.ai && q.ai.left === 0 ? "Дневной лимит обращений к ИИ исчерпан."
    : "Эта возможность доступна по подписке Pro.");

  bd.innerHTML = `
    <div class="modal" style="text-align:center">
      <h3 style="font-family:"Onest", Georgia, serif;margin:6px 0 10px">Нужна подписка Pro</h3>
      <p style="color:var(--muted);margin-bottom:16px">${escapeHtml(reason)}</p>
      <ul style="text-align:left;color:var(--muted);font-size:var(--t-sm);margin:0 20px 18px;line-height:2">
        <li>Безлимитные ИИ-инструменты и калькуляторы</li>
        <li>Анализ договоров: файлом и фотографией</li>
        <li>ИИ-консультант без дневного лимита</li>
        <li>Платные курсы и сертификаты</li>
      </ul>
      <button class="btn gold" onclick="closePaywall();PAY.open()">Оформить Pro</button>
      <p style="color:var(--muted);font-size:var(--t-xs);margin-top:14px;margin-bottom:6px">или введите промокод</p>
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
        <input type="text" id="promoInput" placeholder="Промокод" style="max-width:170px">
        <button class="btn secondary" onclick="applyPromo('promoInput')">Активировать</button>
      </div>
      <br><button class="btn secondary small" onclick="closePaywall()">Позже</button>
    </div>`;
  bd.classList.add("open");
  trackEvent("paywall", { reason });
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
    toast(`Pro активирован на ${res.days} дн.`);
    setTimeout(() => location.reload(), 900);
  } catch (e) {
    toast(e.message, "error");
  }
}

/* Единая проверка перед запуском платной возможности.
   Возвращает true, если можно продолжать. Сервер всё равно перепроверит. */
function requirePro(feature) {
  if (!PF.user()) {
    toast("Сначала войдите — это бесплатно");
    setTimeout(() => (location.href = "auth.html"), 1200);
    return false;
  }
  if (PF.isPro()) return true;
  const q = PF.quota;
  if (q && q.tool && q.tool.left > 0) return true;
  showPaywall(feature ? `«${feature}» доступно по подписке Pro — пробный запуск уже израсходован.` : undefined);
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
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add("visible");
        io.unobserve(e.target);
      }
    });
  }, { threshold: 0.08 });
  els.forEach(el => io.observe(el));
}

/* Золотые частицы в герое (восходящие «искры») */
function spawnHeroParticles(containerSelector = ".hero", count = 16) {
  const hero = document.querySelector(containerSelector);
  if (!hero) return;
  /* На телефонах и при включённом «уменьшить движение» частиц меньше или нет
     совсем: 16 анимированных элементов заметно греют слабый аппарат. */
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  if (innerWidth < 700) count = 6;
  for (let i = 0; i < count; i++) {
    const p = document.createElement("span");
    p.className = "hero-particle";
    const size = 3 + Math.random() * 5;
    p.style.width = p.style.height = size + "px";
    p.style.left = Math.random() * 100 + "%";
    p.style.bottom = -(Math.random() * 30) + "px";
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

  if (!document.querySelector('link[rel="manifest"]')) {
    const m = document.createElement("link");
    m.rel = "manifest";
    m.href = "manifest.webmanifest";
    document.head.appendChild(m);
  }
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
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
  if (!API.token()) { location.href = "auth.html"; return false; }
  return true;
}
