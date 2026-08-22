/* ============ ПравоФин — общая логика ============ */
const FREE_AI_LIMIT = 1; // бесплатных использований AI-инструментов

const PF = {
  usersKey: "pf_users",
  sessionKey: "pf_session",
  themeKey: "pf_theme",
  historyKey: "pf_history",
  habitsKey: "pf_habits",
  scoresKey: "pf_scores",

  users() { return JSON.parse(localStorage.getItem(this.usersKey) || "{}"); },
  saveUsers(u) { localStorage.setItem(this.usersKey, JSON.stringify(u)); },
  user() {
    const email = localStorage.getItem(this.sessionKey);
    return email ? this.users()[email] : null;
  },
  register(name, email, pass) {
    const users = this.users();
    if (users[email]) throw new Error("Пользователь уже существует");
    if (pass.length < 4) throw new Error("Пароль минимум 4 символа");
    const isFirst = Object.keys(users).length === 0;
    users[email] = {
      name, email, pass, registered: Date.now(),
      plan: isFirst ? "pro" : "free", // первый зарегистрированный — владелец (PRO + админ)
      isAdmin: isFirst,
      aiUses: 0, actions: [],
    };
    this.saveUsers(users);
    localStorage.setItem(this.sessionKey, email);
    this.logAction(isFirst ? "Регистрация владельца сервиса (админ)" : "Регистрация аккаунта");
    trackEvent("register");
    return users[email];
  },
  login(email, pass) {
    const u = this.users()[email];
    if (!u || u.pass !== pass) throw new Error("Неверный email или пароль");
    localStorage.setItem(this.sessionKey, email);
    this.logAction("Вход в аккаунт");
    trackEvent("login");
    return u;
  },
  logout() {
    localStorage.removeItem(this.sessionKey);
    location.href = "index.html";
  },
  updateUser(patch) {
    const email = localStorage.getItem(this.sessionKey);
    if (!email) return;
    const users = this.users();
    Object.assign(users[email], patch);
    this.saveUsers(users);
  },

  /* --- Подписка и лимиты AI --- */
  isPro() { const u = this.user(); return !!u && (u.plan === "pro" || u.isAdmin); },
  aiUses() { const u = this.user(); return u ? u.aiUses || 0 : 0; },
  aiLeft() { return this.isPro() ? Infinity : Math.max(0, FREE_AI_LIMIT - this.aiUses()); },
  consumeAIUse() {
    if (this.aiLeft() <= 0) return false;
    if (!this.isPro()) this.updateUser({ aiUses: this.aiUses() + 1 });
    return true;
  },

  history() {
    const email = localStorage.getItem(this.sessionKey);
    if (!email) return [];
    return this.users()[email].actions || [];
  },
  logAction(text) {
    const email = localStorage.getItem(this.sessionKey);
    if (!email) return;
    const users = this.users();
    users[email].actions = [{ text, date: new Date().toISOString() }, ...(users[email].actions || [])].slice(0, 50);
    this.saveUsers(users);
  },
  addScore(game, points) {
    const email = localStorage.getItem(this.sessionKey);
    if (!email) return;
    const users = this.users();
    const s = (users[email].scores || {});
    s[game] = Math.max(s[game] || 0, points);
    users[email].scores = s;
    this.saveUsers(users);
  },
  getScore(game) {
    const u = this.user();
    return u && u.scores ? u.scores[game] || 0 : 0;
  },

  /* --- Мои документы (сгенерированные/сохранённые) --- */
  docs() {
    const u = this.user();
    return JSON.parse(localStorage.getItem("pf_docs_" + (u ? u.email : "guest")) || "[]");
  },
  saveDoc(title, content) {
    const key = "pf_docs_" + (this.user() ? this.user().email : "guest");
    const docs = this.docs();
    docs.unshift({ title, content, date: new Date().toISOString() });
    localStorage.setItem(key, JSON.stringify(docs.slice(0, 50)));
    this.logAction("Сохранён документ: " + title);
  },
  deleteDoc(i) {
    const key = "pf_docs_" + (this.user() ? this.user().email : "guest");
    const docs = this.docs();
    docs.splice(i, 1);
    localStorage.setItem(key, JSON.stringify(docs));
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
function toast(msg) {
  let el = document.querySelector(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), 2600);
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
      <nav class="nav-links">${links}</nav>
      <button class="theme-toggle" onclick="toggleTheme()" title="Сменить тему">${themeLabel}</button>
      ${auth}
    </div>`;
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
      <div class="chat-header">🤖 AI-консультант <button onclick="chatToggle()">✕</button></div>
      <div class="chat-messages" id="chatMessages"></div>
      <div class="chat-input">
        <input type="text" id="chatInput" placeholder="Задайте вопрос..." onkeydown="if(event.key==='Enter')chatSend()">
        <button class="btn" onclick="chatSend()">➤</button>
      </div>
    </div>
    <button class="chat-toggle" onclick="chatToggle()">💬</button>`;
  document.body.appendChild(w);
}
function chatToggle() {
  const box = document.getElementById("chatBox");
  box.classList.toggle("open");
  if (box.classList.contains("open") && !box.dataset.hello) {
    addMsg("bot", "Здравствуйте! Я ИИ-консультант ПравоФин. Задайте вопрос по праву, налогам или финансам — отвечу кратко и по делу.");
    box.dataset.hello = "1";
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
  input.value = "";
  addMsg("user", text);
  const thinking = document.createElement("div");
  thinking.className = "chat-msg bot";
  thinking.textContent = "…";
  document.getElementById("chatMessages").appendChild(thinking);
  try {
    const reply = await AI.complete(
      `Ты — юридическо-финансовый консультант сервиса «ПравоФин». Отвечай кратко и по делу на русском языке, делая оговорку, что это не официальная консультация. Вопрос: ${text}`,
      () => OFFLINE.chat(text)
    );
    thinking.textContent = reply;
  } catch (e) {
    thinking.remove();
    addMsg("bot", "Ошибка: " + e.message);
  }
  PF.logAction("Вопрос ИИ-консультанту: " + text.slice(0, 60));
  document.getElementById("chatMessages").scrollTop = 1e9;
}

/* ============ Платежи (подписка Pro) ============ */
const PAY = {
  plans: {
    month: { title: "Pro на месяц", price: 490, days: 30 },
    year: { title: "Pro на год", price: 4900, days: 365, note: "2 месяца в подарок" },
  },

  open(planId) {
    let bd = document.getElementById("payBackdrop");
    if (!bd) {
      bd = document.createElement("div");
      bd.id = "payBackdrop";
      bd.className = "modal-backdrop";
      document.body.appendChild(bd);
    }
    bd.classList.add("open");
    this.step = { plan: planId || "month", method: "card" };
    this.renderPlans();
  },
  close() { document.getElementById("payBackdrop").classList.remove("open"); },

  renderPlans() {
    const bd = document.getElementById("payBackdrop");
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
        <div class="form-group" style="margin-top:16px">
          <label>Способ оплаты</label>
          <div class="pay-methods">
            <button class="pay-method ${this.step.method === "card" ? "selected" : ""}" onclick="PAY.selectMethod('card')">Банковская карта</button>
            <button class="pay-method ${this.step.method === "sbp" ? "selected" : ""}" onclick="PAY.selectMethod('sbp')">СБП</button>
          </div>
        </div>
        <div id="payDetails"></div>
        <br><button class="btn gold" style="width:100%" onclick="PAY.submit()">Оплатить ${this.plans[this.step.plan].price} ₽</button>
        <p class="pay-note">Демо-режим: карта не списывается. Точка подключения реального эквайринга — в js/app.js, функция PAY.submit.</p>
      </div>`;
    this.renderDetails();
  },
  selectPlan(id) { this.step.plan = id; this.renderPlans(); },
  selectMethod(m) { this.step.method = m; this.renderPlans(); },

  renderDetails() {
    const box = document.getElementById("payDetails");
    if (this.step.method === "card") {
      box.innerHTML = `
        <div class="grid cols-2" style="gap:10px">
          <div class="form-group" style="margin:0;grid-column:1/-1">
            <label>Номер карты</label>
            <input type="text" id="ccNum" inputmode="numeric" placeholder="0000 0000 0000 0000" maxlength="19" oninput="PAY.formatCard(this)">
          </div>
          <div class="form-group" style="margin:0"><label>Срок</label><input type="text" id="ccExp" placeholder="ММ/ГГ" maxlength="5"></div>
          <div class="form-group" style="margin:0"><label>CVC</label><input type="password" id="ccCvc" placeholder="•••" maxlength="3"></div>
        </div>`;
    } else {
      box.innerHTML = `
        <div class="pay-sbp">
          <p style="color:var(--muted);font-size:.9rem">Отсканируйте QR-код в приложении банка или подтвердите платёж по push-уведомлению.</p>
          <div class="pay-qr">СБП</div>
        </div>`;
    }
  },
  formatCard(input) {
    input.value = input.value.replace(/\D/g, "").slice(0, 16).replace(/(\d{4})(?=\d)/g, "$1 ");
  },

  async submit() {
    /* ================================================================
       ТОЧКА ИНТЕГРАЦИИ ПЛАТЕЖЕЙ (YooKassa / CloudPayments / Robokassa)
       Здесь вместо демо-блока создайте платёж через ваш бэкенд:
       const res = await fetch("/api/pay", { method: "POST",
         body: JSON.stringify({ plan: this.step.plan, method: this.step.method, ...card }) });
       и активируйте Pro только после подтверждения вебхуком.
       ================================================================ */
    if (this.step.method === "card") {
      const num = (document.getElementById("ccNum").value || "").replace(/\s/g, "");
      const exp = document.getElementById("ccExp").value || "";
      const cvc = document.getElementById("ccCvc").value || "";
      if (num.length !== 16) return toast("Введите номер карты полностью");
      if (!/^\d{2}\/\d{2}$/.test(exp)) return toast("Срок в формате ММ/ГГ");
      if (cvc.length !== 3) return toast("CVC — 3 цифры");
    }
    const btn = document.querySelector("#payBackdrop .btn.gold");
    btn.disabled = true;
    btn.textContent = "Обработка платежа…";
    await new Promise(r => setTimeout(r, 1800));

    const plan = this.plans[this.step.plan];
    const until = Date.now() + plan.days * 86400000;
    const u = PF.user();
    const payments = [...(u.payments || []), {
      id: "PF-" + Date.now().toString(36).toUpperCase(),
      plan: this.step.plan, amount: plan.price, method: this.step.method,
      date: new Date().toISOString(),
    }];
    PF.updateUser({ plan: "pro", proUntil: until, payments });
    PF.logAction(`Оплата: ${plan.title} за ${plan.price} ₽`);
    trackEvent("pay_success");
    this.close();
    toast("Pro активирован! Приятной работы");
    setTimeout(() => location.reload(), 900);
  },

  cancel() {
    if (!confirm("Отменить подписку Pro? Доступ сохранится до конца оплаченного периода.")) return;
    PF.updateUser({ plan: "free" });
    PF.logAction("Подписка Pro отменена");
    toast("Подписка отменена");
    location.reload();
  },
};

/* ============ Настройки профиля ============ */
const SETTINGS = {
  open() {
    const u = PF.user();
    if (!u) return location.href = "auth.html";
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
          <input type="text" id="setName" value="${escapeHtml(u.name)}">
        </div>
        <button class="btn" style="width:100%" onclick="SETTINGS.save()">Сохранить</button>

        <hr style="border:none;border-top:1px solid var(--border);margin:20px 0">

        <div class="form-group">
          <label>Смена пароля</label>
          <input type="password" id="setOldPass" placeholder="Текущий пароль">
        </div>
        <div class="form-group">
          <label>Новый пароль (мин. 4 символа)</label>
          <input type="password" id="setNewPass" placeholder="••••••">
        </div>
        <button class="btn secondary" style="width:100%" onclick="SETTINGS.changePass()">Изменить пароль</button>

        <hr style="border:none;border-top:1px solid var(--border);margin:20px 0">
        <hr style="border:none;border-top:1px solid var(--border);margin:20px 0">
        <button class="btn secondary" style="width:100%" onclick="SETTINGS.exportData()">Скачать все мои данные (JSON)</button>
        <input type="file" id="importFile" accept=".json" style="display:none" onchange="SETTINGS.importData(this.files[0])">
        <br><button class="btn secondary" style="width:100%" onclick="document.getElementById('importFile').click()">Импорт данных из файла</button>
        <p style="color:var(--muted);font-size:.8rem;margin-top:8px">Профиль, документы, сроки, прогресс курсов и календарь — одним файлом.</p>
        <br><br>
        <button class="btn danger" style="width:100%" onclick="SETTINGS.deleteAccount()">Удалить аккаунт</button>
        <p style="color:var(--muted);font-size:.8rem;margin-top:8px">Аккаунт и все данные будут стёрты из этого браузера безвозвратно.</p>
      </div>`;
    this._avatar = u.avatar || "";
  },
  close() { document.getElementById("settingsBackdrop").classList.remove("open"); },
  pickAvatar(btn, a) {
    document.querySelectorAll(".avatar-option").forEach(b => b.classList.remove("selected"));
    btn.classList.add("selected");
    this._avatar = a;
  },
  save() {
    const name = document.getElementById("setName").value.trim();
    if (name.length < 2) return toast("Имя слишком короткое");
    PF.updateUser({ name, avatar: this._avatar });
    PF.logAction("Обновлён профиль");
    toast("Профиль сохранён");
    setTimeout(() => location.reload(), 700);
  },
  changePass() {
    const u = PF.user();
    const oldP = document.getElementById("setOldPass").value;
    const newP = document.getElementById("setNewPass").value;
    if (oldP !== u.pass) return toast("Текущий пароль неверен");
    if (newP.length < 4) return toast("Новый пароль минимум 4 символа");
    PF.updateUser({ pass: newP });
    PF.logAction("Изменён пароль");
    toast("Пароль изменён");
    SETTINGS.close();
  },
  exportData() {
    const u = PF.user();
    if (!u) return;
    const email = u.email;
    const data = {
      exported: new Date().toISOString(),
      profile: { ...u, pass: undefined },
      documents: PF.docs(),
      deadlines: JSON.parse(localStorage.getItem("pf_deadlines_" + email) || "[]"),
      habits: JSON.parse(localStorage.getItem("pf_habits_" + email) || "{}"),
      courses: JSON.parse(localStorage.getItem("pf_course_" + email) || "{}"),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "pravofin-" + email.split("@")[0] + ".json";
    a.click();
    URL.revokeObjectURL(a.href);
    toast("Данные выгружены");
  },
  importData(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        const email = data.profile.email;
        const users = PF.users();
        if (!users[email]) throw new Error("Сначала зарегистрируйтесь с тем же email");
        users[email] = { ...users[email], ...data.profile };
        PF.saveUsers(users);
        if (data.deadlines) localStorage.setItem("pf_deadlines_" + email, JSON.stringify(data.deadlines));
        if (data.habits) localStorage.setItem("pf_habits_" + email, JSON.stringify(data.habits));
        if (data.courses) localStorage.setItem("pf_course_" + email, JSON.stringify(data.courses));
        if (data.documents) localStorage.setItem("pf_docs_" + email, JSON.stringify(data.documents));
        PF.logAction("Импорт данных из файла");
        toast("Данные перенесены");
        setTimeout(() => location.reload(), 800);
      } catch (e) { toast("Ошибка импорта: " + e.message); }
    };
    reader.readAsText(file);
  },
  deleteAccount() {
    if (!confirm("Точно удалить аккаунт? Действие необратимо.")) return;
    const email = localStorage.getItem(PF.sessionKey);
    const users = PF.users();
    delete users[email];
    PF.saveUsers(users);
    localStorage.removeItem(PF.sessionKey);
    localStorage.removeItem("pf_habits_" + email);
    toast("Аккаунт удалён");
    setTimeout(() => location.href = "index.html", 700);
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
function showPaywall() {
  let bd = document.getElementById("paywallBackdrop");
  if (!bd) {
    bd = document.createElement("div");
    bd.id = "paywallBackdrop";
    bd.className = "modal-backdrop";
    bd.innerHTML = `
      <div class="modal" style="text-align:center">
        <h3 style="font-family:'Playfair Display',Georgia,serif;margin:6px 0 10px">Нужна подписка Pro</h3>
        <p style="color:var(--muted);margin-bottom:16px">
          Бесплатный тариф даёт ${FREE_AI_LIMIT} использование ИИ-инструментов.
          Оформите Pro — и работайте без ограничений.
        </p>
        <ul style="text-align:left;color:var(--muted);font-size:.9rem;margin:0 20px 18px;line-height:2">
          <li>Безлимитные ИИ-инструменты</li>
          <li>Готовые документы за минуту</li>
          <li>Персональные налоговые расчёты</li>
          <li>Доступ к платным курсам (скоро)</li>
        </ul>
        <br><button class="btn gold" onclick="PAY.open()">Оформить за 490 ₽/мес</button>
        <p style="color:var(--muted);font-size:.8rem;margin-top:10px">или введите промокод</p>
        <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:6px">
          <input type="text" id="promoInput" placeholder="Промокод" style="max-width:170px">
          <button class="btn secondary" onclick="applyPromo()">Активировать</button>
        </div>
        <br><button class="btn secondary small" onclick="closePaywall()">Позже</button>
      </div>`;
    document.body.appendChild(bd);
  }
  bd.classList.add("open");
  trackEvent("paywall");
}
function closePaywall() {
  const bd = document.getElementById("paywallBackdrop");
  if (bd) bd.classList.remove("open");
}
function applyPromo() {
  const code = (document.getElementById("promoInput").value || "").trim().toUpperCase();
  if (code === "PRO2026") {
    PF.updateUser({ plan: "pro" });
    PF.logAction("Активирована подписка Pro (промокод)");
    closePaywall();
    toast("Pro активирован! Приятной работы");
    setTimeout(() => location.reload(), 800);
  } else {
    toast("❌ Неверный промокод");
  }
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
function initPage(active) {
  initTheme();
  renderHeader(active);
  renderFooter();
  renderChatWidget();
  initRevealAnimations();
  // PWA: manifest + service worker (работает на GitHub Pages / любом хостинге)
  if (!document.querySelector('link[rel="manifest"]')) {
    const m = document.createElement("link");
    m.rel = "manifest";
    m.href = "manifest.webmanifest";
    document.head.appendChild(m);
  }
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}
