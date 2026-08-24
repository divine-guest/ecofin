/* ============ ПравоФин — общая логика ============ */

/* Кэш пользователя нужен только чтобы шапка и кабинет рисовались без мигания.
   Все запреты живут на сервере: правка кэша в DevTools ничего не открывает. */
const PF = {
  themeKey: "pf_theme",

  user() { return API.cached(); },
  isPro() { const u = this.user(); return !!u && (u.plan === "pro" || u.isAdmin); },
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
  document.querySelectorAll(".theme-toggle").forEach(b => (b.textContent = t === "dark" ? "Тёмная тема" : "Светлая тема"));
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

/* ============ Шапка (вставляется на каждую страницу) ============ */
function renderHeader(active) {
  const u = PF.user();
  const pages = [
    ["index.html", "Главная"], ["tools.html", "Инструменты"], ["calc.html", "Калькуляторы"],
    ["courses.html", "Курсы"], ["games.html", "Практикум"], ["knowledge.html", "База знаний"], ["dashboard.html", "Кабинет"],
  ];
  /* Пункт «Админка» видят только админы и владелец. Прямой заход по адресу
     всё равно упрётся в проверку прав на сервере. */
  if (u && u.isAdmin) pages.push(["admin.html", "Админка"]);
  const links = pages.map(([href, label]) =>
    `<a href="${href}" class="${active === href ? "active" : ""}">${label}</a>`).join("");
  const auth = u
    ? `<a href="dashboard.html" class="btn small">${avatarHtml(u)}${escapeHtml(u.name.split(" ")[0])}</a>`
    : `<a href="auth.html" class="btn small">Войти</a>`;
  const themeLabel = document.documentElement.getAttribute("data-theme") === "dark" ? "Тёмная тема" : "Светлая тема";
  const header = document.createElement("header");
  header.className = "site-header";
  header.innerHTML = `
    <div class="container nav">
      <a href="index.html" class="logo"><span class="logo-mark">⚖</span>Право<b>Фин</b></a>
      <button class="nav-burger" onclick="this.closest('.site-header').classList.toggle('menu-open')" aria-label="Меню">Меню</button>
      <nav class="nav-links">${links}</nav>
      ${u ? `<button class="theme-toggle notif-btn" onclick="NOTIFY.open()" title="Уведомления" aria-label="Уведомления">Уведомления</button>` : ""}
      <button class="theme-toggle" onclick="toggleTheme()" title="Сменить тему">${themeLabel}</button>
      ${auth}
    </div>
    <nav class="mobile-menu">${links}</nav>`;
  document.body.prepend(header);
}

function renderFooter() {
  const f = document.createElement("footer");
  f.className = "site-footer";
  f.innerHTML = `<div class="container">
    <p><b>ПравоФин</b> — экосистема юридической и финансовой грамотности © 2026</p>
    <p><a href="about.html">О сервисе</a> · <a href="faq.html">Частые вопросы</a> · <a href="legal.html">Правовые документы</a> · <a href="search.html">Поиск</a></p>
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
      <div class="chat-header">ИИ-консультант <button onclick="clearChat()" title="Очистить историю" style="margin-right:10px;font-size:.85rem">Очистить</button><button onclick="chatToggle()">✕</button></div>
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
  addMsg("user", text);
  const thinking = document.createElement("div");
  thinking.className = "chat-msg bot";
  thinking.textContent = "…";
  document.getElementById("chatMessages").appendChild(thinking);
  document.getElementById("chatMessages").scrollTop = 1e9;

  try {
    trackEvent("ai_chat");
    const res = await API.ai(chatContext(text), { kind: "chat" });
    thinking.textContent = res.text;
    PF.quota = res.quota || PF.quota;
    chatSave([...chatHistory(), { role: "user", text }, { role: "bot", text: res.text }]);
    if (res.quota && !res.quota.pro && res.quota.ai.left === 0) {
      addMsg("bot", "Это было последнее бесплатное обращение на сегодня. Лимит обновится завтра, а с Pro его нет совсем.");
    }
  } catch (e) {
    thinking.remove();
    if (e.isPaywall) {
      addMsg("bot", e.message);
      showPaywall();
    } else {
      addMsg("bot", "Не получилось: " + e.message);
    }
  }
  document.getElementById("chatMessages").scrollTop = 1e9;
}

/* ============ Платежи (подписка Pro) ============ */
/* Формы карты здесь больше нет: реквизиты вводятся на стороне ЮKassa.
   Сайт только создаёт платёж и уводит на защищённую страницу оплаты. */
const PAY = {
  plans: {
    month: { title: "Pro на месяц", price: 490, days: 30 },
    year: { title: "Pro на год", price: 4900, days: 365, note: "2 месяца в подарок" },
  },
  enabled: null,

  async open(planId) {
    if (!PF.user()) return (location.href = "auth.html");
    let bd = document.getElementById("payBackdrop");
    if (!bd) {
      bd = document.createElement("div");
      bd.id = "payBackdrop";
      bd.className = "modal-backdrop";
      document.body.appendChild(bd);
    }
    bd.classList.add("open");
    this.step = { plan: planId || "month" };
    this.render();
    try {
      const info = await API.billing.plans();
      this.enabled = info.enabled;
      if (info.plans) info.plans.forEach(p => { if (this.plans[p.id]) this.plans[p.id].price = p.price; });
    } catch { this.enabled = false; }
    this.render();
  },
  close() {
    const bd = document.getElementById("payBackdrop");
    if (bd) bd.classList.remove("open");
  },
  selectPlan(id) { this.step.plan = id; this.render(); },

  render() {
    const bd = document.getElementById("payBackdrop");
    if (!bd) return;
    const off = this.enabled === false;
    bd.innerHTML = `
      <div class="modal">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
          <h3 style="font-family:'Playfair Display',Georgia,serif">Оформление Pro</h3>
          <button class="btn small secondary" onclick="PAY.close()">Закрыть</button>
        </div>
        <div class="pay-plans">
          ${Object.entries(this.plans).map(([id, p]) => `
            <div class="pay-plan ${this.step.plan === id ? "selected" : ""}" onclick="PAY.selectPlan('${id}')">
              <b>${p.title}</b>
              <div class="pay-price">${p.price} ₽</div>
              ${p.note ? `<span class="badge ok">${p.note}</span>` : ""}
            </div>`).join("")}
        </div>
        ${off ? `
          <p class="pay-note" style="margin-top:16px">
            Приём оплаты картой пока не подключён. Получить Pro можно по промокоду
            или запросив доступ у администратора сервиса.
          </p>` : `
          <p class="pay-note" style="margin-top:16px">
            Оплата проходит на защищённой странице ЮKassa. Реквизиты карты
            вводятся там и на сайт ПравоФин не попадают.
          </p>`}
        <br><button class="btn gold" style="width:100%" ${off ? "disabled" : ""} onclick="PAY.submit()">
          ${off ? "Оплата временно недоступна" : `Перейти к оплате — ${this.plans[this.step.plan].price} ₽`}
        </button>
        <div style="margin-top:16px;text-align:center">
          <p style="color:var(--muted);font-size:.8rem;margin-bottom:6px">или введите промокод</p>
          <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
            <input type="text" id="promoInput2" placeholder="Промокод" style="max-width:170px">
            <button class="btn secondary" onclick="applyPromo('promoInput2')">Активировать</button>
          </div>
        </div>
      </div>`;
  },

  async submit() {
    const btn = document.querySelector("#payBackdrop .btn.gold");
    btn.disabled = true;
    btn.textContent = "Создаём платёж…";
    trackEvent("pay_click", { plan: this.step.plan, price: this.plans[this.step.plan].price });
    try {
      const res = await API.billing.create(this.step.plan);
      if (res.confirmationUrl) {
        location.href = res.confirmationUrl;   // дальше платёж ведёт ЮKassa
        return;
      }
      toast("Платёж создан, но ЮKassa не вернула ссылку. Напишите в поддержку", "error");
    } catch (e) {
      toast(e.message, "error");
    }
    btn.disabled = false;
    btn.textContent = `Перейти к оплате — ${this.plans[this.step.plan].price} ₽`;
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
        <p class="hint">Почта — это логин, она не меняется. Нужен другой адрес — напишите в поддержку.</p>
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
    const until = u.proUntil
      ? new Date(u.proUntil).toLocaleDateString("ru-RU")
      : null;
    const daysLeft = u.proUntil ? Math.ceil((u.proUntil - Date.now()) / 86400000) : null;

    const status = u.isAdmin
      ? `<span class="badge pro">Полный доступ по роли</span>`
      : PF.isPro()
        ? `<span class="badge pro">Pro</span> ${until ? `до ${until} (осталось ${daysLeft} дн.)` : "бессрочно"}`
        : `<span class="badge">Бесплатный тариф</span>`;

    const limits = PF.isPro()
      ? "<li>Инструменты и калькуляторы — без ограничений</li><li>ИИ-консультант — без дневного лимита</li>"
      : q
        ? `<li>Пробных запусков инструментов: <b>${q.tool.left}</b> из ${q.tool.limit}</li>
           <li>Обращений к ИИ сегодня: <b>${q.ai.left}</b> из ${q.ai.limit}</li>`
        : "<li>Проверяем остатки…</li>";

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
      <p style="margin-bottom:10px">Текущий статус: ${status}</p>
      <ul class="limits-list">${limits}</ul>
      ${PF.isPro()
        ? '<button class="btn gold wide" onclick="SETTINGS.close();PAY.open()">Продлить Pro</button>'
        : '<button class="btn gold wide" onclick="SETTINGS.close();PAY.open()">Оформить Pro</button>'}
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
      box.innerHTML = `<p class="hint">Пока пусто. Здесь появятся напоминания о сроках.</p>`;
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
      <h3 style="font-family:'Playfair Display',Georgia,serif;margin:6px 0 10px">Нужна подписка Pro</h3>
      <p style="color:var(--muted);margin-bottom:16px">${escapeHtml(reason)}</p>
      <ul style="text-align:left;color:var(--muted);font-size:.9rem;margin:0 20px 18px;line-height:2">
        <li>Безлимитные ИИ-инструменты и калькуляторы</li>
        <li>Анализ договоров: файлом и фотографией</li>
        <li>ИИ-консультант без дневного лимита</li>
        <li>Платные курсы и сертификаты</li>
      </ul>
      <button class="btn gold" onclick="closePaywall();PAY.open()">Оформить Pro</button>
      <p style="color:var(--muted);font-size:.8rem;margin-top:14px;margin-bottom:6px">или введите промокод</p>
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
    await PF.refreshQuota();
    if (JSON.stringify(d.user) !== before) window.dispatchEvent(new CustomEvent("pf:userchanged"));
    return d.user;
  } catch (e) {
    if (e.status === 401) return null;   // сессия истекла, API уже почистил кэш
    return API.cached();                 // сеть отвалилась — работаем по кэшу
  }
}

function initPage(active) {
  initTheme();
  initAnalytics();
  renderHeader(active);
  renderFooter();
  renderChatWidget();
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
