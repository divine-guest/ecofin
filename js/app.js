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
    ? `<a href="dashboard.html" class="btn small"><span class="avatar">${escapeHtml(u.avatar || u.name[0].toUpperCase())}</span>${escapeHtml(u.name.split(" ")[0])}</a>`
    : `<a href="auth.html" class="btn small">Войти</a>`;
  const themeLabel = document.documentElement.getAttribute("data-theme") === "dark" ? "Тёмная тема" : "Светлая тема";
  const header = document.createElement("header");
  header.className = "site-header";
  header.innerHTML = `
    <div class="container nav">
      <a href="index.html" class="logo"><span class="logo-mark">⚖</span>Право<b>Фин</b></a>
      <button class="nav-burger" onclick="this.closest('.site-header').classList.toggle('menu-open')" aria-label="Меню">Меню</button>
      <nav class="nav-links">${links}</nav>
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

/* ============ Аналитика (Яндекс.Метрика) ============
   Подключение: создайте счётчик на metrika.yandex.ru, вставьте их
   <script>-сниппет в <head> каждой страницы, затем раскомментируйте
   строку в trackEvent, подставив ID счётчика. События уже расставлены
   по коду: register, login, paywall, pay_success, tool_use и др. */
function trackEvent(name) {
  // if (window.ym) window.ym(XXXXXXXX, "reachGoal", name);
  console.debug("[event]", name);
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
  open() {
    const u = PF.user();
    if (!u) return (location.href = "auth.html");
    let bd = document.getElementById("settingsBackdrop");
    if (!bd) {
      bd = document.createElement("div");
      bd.id = "settingsBackdrop";
      bd.className = "modal-backdrop";
      document.body.appendChild(bd);
    }
    bd.classList.add("open");
    bd.innerHTML = `
      <div class="modal">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <h3 style="font-family:'Playfair Display',Georgia,serif">Настройки профиля</h3>
          <button class="btn small secondary" onclick="SETTINGS.close()">Закрыть</button>
        </div>

        <div class="form-group">
          <label>Аватар</label>
          <div class="avatar-row">
            ${["Ю", "Ф", "⚖", "🧑‍💼", "👩‍💼", "🦉"].map(a =>
              `<button class="avatar-option ${u.avatar === a ? "selected" : ""}" onclick="SETTINGS.pickAvatar(this,'${a}')">${a}</button>`).join("")}
          </div>
        </div>
        <div class="form-group">
          <label>Имя</label>
          <input type="text" id="setName" value="${escapeHtml(u.name)}" maxlength="80">
        </div>
        <div class="form-group">
          <label>Email</label>
          <input type="text" value="${escapeHtml(u.email)}" disabled>
          <p style="color:var(--muted);font-size:.78rem;margin-top:4px">Email — логин аккаунта, он не меняется.</p>
        </div>
        <button class="btn" style="width:100%" onclick="SETTINGS.save()">Сохранить</button>

        <hr style="border:none;border-top:1px solid var(--border);margin:20px 0">

        <div class="form-group">
          <label>Текущий пароль</label>
          <input type="password" id="setOldPass" placeholder="••••••••" autocomplete="current-password">
        </div>
        <div class="form-group">
          <label>Новый пароль (мин. 8 символов)</label>
          <input type="password" id="setNewPass" placeholder="••••••••" autocomplete="new-password">
        </div>
        <button class="btn secondary" style="width:100%" onclick="SETTINGS.changePass()">Изменить пароль</button>
        <p style="color:var(--muted);font-size:.78rem;margin-top:8px">
          После смены пароля все остальные устройства будут разлогинены.
        </p>

        <hr style="border:none;border-top:1px solid var(--border);margin:20px 0">
        <button class="btn secondary" style="width:100%" onclick="SETTINGS.exportData()">Скачать мои документы (JSON)</button>
        <p style="color:var(--muted);font-size:.78rem;margin-top:8px">
          Профиль и подписка хранятся на сервере и переносятся сами — на любом устройстве
          достаточно войти. Выгрузка нужна только для черновиков документов и заметок,
          которые остаются в браузере.
        </p>

        <hr style="border:none;border-top:1px solid var(--border);margin:20px 0">
        <button class="btn danger" style="width:100%" onclick="SETTINGS.deleteAccount()">Удалить аккаунт</button>
        <p style="color:var(--muted);font-size:.78rem;margin-top:8px">
          Аккаунт, подписка и история будут стёрты с сервера безвозвратно.
        </p>
      </div>`;
    this._avatar = u.avatar || "";
  },
  close() {
    const bd = document.getElementById("settingsBackdrop");
    if (bd) bd.classList.remove("open");
  },
  pickAvatar(btn, a) {
    document.querySelectorAll(".avatar-option").forEach(b => b.classList.remove("selected"));
    btn.classList.add("selected");
    this._avatar = a;
  },
  async save() {
    const name = document.getElementById("setName").value.trim();
    if (name.length < 2) return toast("Имя слишком короткое");
    try {
      await API.updateProfile({ name, avatar: this._avatar });
      toast("Профиль сохранён");
      setTimeout(() => location.reload(), 600);
    } catch (e) { toast(e.message, "error"); }
  },
  async changePass() {
    const oldP = document.getElementById("setOldPass").value;
    const newP = document.getElementById("setNewPass").value;
    if (newP.length < 8) return toast("Новый пароль минимум 8 символов");
    try {
      await API.changePassword(oldP, newP);
      toast("Пароль изменён");
      document.getElementById("setOldPass").value = "";
      document.getElementById("setNewPass").value = "";
      SETTINGS.close();
    } catch (e) { toast(e.message, "error"); }
  },
  exportData() {
    const u = PF.user();
    if (!u) return;
    const data = {
      exported: new Date().toISOString(),
      profile: { email: u.email, name: u.name, plan: u.plan },
      documents: PF.docs(),
      deadlines: JSON.parse(localStorage.getItem("pf_deadlines_" + u.email) || "[]"),
      habits: JSON.parse(localStorage.getItem("pf_habits_" + u.email) || "{}"),
      courses: JSON.parse(localStorage.getItem("pf_course_" + u.email) || "{}"),
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
    const u = PF.user();
    if (!u) return;
    if (!confirm("Точно удалить аккаунт? Подписка и история будут стёрты безвозвратно.")) return;
    if (prompt('Для подтверждения введите слово "удалить"') !== "удалить") return toast("Отменено");
    try {
      await API.deleteAccount();
      toast("Аккаунт удалён");
      setTimeout(() => (location.href = "index.html"), 700);
    } catch (e) { toast(e.message, "error"); }
  },
};

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
    const header = document.querySelector(".site-header");
    if (header) { header.remove(); renderHeader(active); }
    document.dispatchEvent(new CustomEvent("pf:ready", { detail: { user } }));
  });
}

/* Страницы, которым нужен вошедший пользователь, зовут это вместо своей проверки. */
function requireAuth() {
  if (!API.token()) { location.href = "auth.html"; return false; }
  return true;
}
