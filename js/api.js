/* ============ ПравоФин — клиент серверного API ============
   Всё, что раньше жило в localStorage (аккаунты, подписка, лимиты, права),
   теперь считает сервер. Здесь только запросы и кэш для отрисовки:
   подделка кэша в DevTools меняет картинку, но не даёт доступа. */

const API = {
  BASE: "https://pravofin-api.pravofin.workers.dev",

  tokenKey: "pf_token",
  userKey: "pf_user_cache",

  token() { return localStorage.getItem(this.tokenKey) || ""; },

  /* Кэш пользователя — чтобы шапка рисовалась мгновенно, до ответа сервера. */
  cached() {
    try { return JSON.parse(localStorage.getItem(this.userKey) || "null"); }
    catch { return null; }
  },
  setSession(token, user) {
    if (token) localStorage.setItem(this.tokenKey, token);
    if (user) localStorage.setItem(this.userKey, JSON.stringify(user));
    else localStorage.removeItem(this.userKey);
  },
  clearSession() {
    localStorage.removeItem(this.tokenKey);
    localStorage.removeItem(this.userKey);
  },

  async request(path, { method = "GET", body, timeout = 90000 } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    let res;
    try {
      res = await fetch(this.BASE + path, {
        method,
        headers: {
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...(this.token() ? { Authorization: "Bearer " + this.token() } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      throw new ApiError(e.name === "AbortError"
        ? "Сервер не ответил вовремя. Проверьте связь и попробуйте ещё раз"
        : "Нет связи с сервером ПравоФин", 0);
    }
    clearTimeout(timer);

    const data = await res.json().catch(() => ({}));
    if (res.ok) return data;

    /* Токен протух или сессию сбросили — выходим начисто. */
    if (res.status === 401) {
      this.clearSession();
      window.dispatchEvent(new CustomEvent("pf:signedout"));
    }
    throw new ApiError(data.error || `Ошибка сервера (${res.status})`, res.status, data);
  },

  /* --- Аккаунт --- */
  async register(name, email, password, ref) {
    const d = await this.request("/api/auth/register", { method: "POST", body: { name, email, password, ref } });
    this.setSession(d.token, d.user);
    return d.user;
  },
  async login(email, password) {
    const d = await this.request("/api/auth/login", { method: "POST", body: { email, password } });
    this.setSession(d.token, d.user);
    return d.user;
  },
  async logout() {
    try { await this.request("/api/auth/logout", { method: "POST", timeout: 8000 }); } catch {}
    this.clearSession();
  },
  async me() {
    const d = await this.request("/api/auth/me");
    this.setSession(null, d.user);
    return d;
  },
  async updateProfile(patch) {
    const d = await this.request("/api/auth/profile", { method: "POST", body: patch });
    this.setSession(null, d.user);
    return d.user;
  },
  changePassword(oldPassword, newPassword) {
    return this.request("/api/auth/password", { method: "POST", body: { oldPassword, newPassword } });
  },
  async deleteAccount() {
    await this.request("/api/auth/delete", { method: "POST" });
    this.clearSession();
  },
  sessions() { return this.request("/api/auth/sessions"); },
  referral() { return this.request("/api/referral"); },
  points() { return this.request("/api/points"); },
  courseLesson(course, lesson) {
    return API.request(`/api/courses/lesson?course=${encodeURIComponent(course)}&lesson=${lesson}`);
  },
  themes: {
    list() { return API.request("/api/themes"); },
    set(id) { return API.request("/api/themes", { method: "POST", body: { id } }); },
  },

  /* --- Напоминания и уведомления --- */
  reminders: {
    list() { return API.request("/api/reminders"); },
    presets() { return API.request("/api/reminders/presets"); },
    create(data) { return API.request("/api/reminders", { method: "POST", body: data }); },
    update(data) { return API.request("/api/reminders/update", { method: "POST", body: data }); },
    remove(id) { return API.request("/api/reminders/delete", { method: "POST", body: { id } }); },
    addPreset(id) { return API.request("/api/reminders/preset", { method: "POST", body: { id } }); },
  },
  notifications: {
    list() { return API.request("/api/notifications"); },
    read(id) { return API.request("/api/notifications/read", { method: "POST", body: id ? { id } : {} }); },
    clear() { return API.request("/api/notifications/clear", { method: "POST" }); },
  },
  telegram: {
    status() { return API.request("/api/telegram/status"); },
    link() { return API.request("/api/telegram/link", { method: "POST" }); },
    unlink() { return API.request("/api/telegram/unlink", { method: "POST" }); },
  },
  referralCheck(code) { return this.request("/api/referral/check?code=" + encodeURIComponent(code)); },
  logoutEverywhere() { return this.request("/api/auth/logout-all", { method: "POST" }); },

  /* --- ИИ --- */
  quota() { return this.request("/api/quota"); },
  ai(prompt, { kind = "chat", system, maxTokens } = {}) {
    return this.request("/api/ai", { method: "POST", body: { prompt, system, kind, maxTokens } });
  },

  /* Фоновый ИИ: вопрос ставится в очередь на сервере и переживает
     уход со страницы. context — то, что уходит модели (с предыдущими
     репликами), prompt — то, что человек увидит в переписке. */
  aiJobs: {
    ask(prompt, { kind = "chat", context, system, maxTokens } = {}) {
      return API.request("/api/ai/ask", {
        method: "POST", body: { prompt, context, system, kind, maxTokens },
      });
    },
    status(id) { return API.request("/api/ai/job?id=" + encodeURIComponent(id)); },
    list()     { return API.request("/api/ai/jobs"); },
  },
  analyze({ text, images, fileName }) {
    return this.request("/api/analyze", { method: "POST", body: { text, images, fileName }, timeout: 120000 });
  },

  /* --- Оплата --- */
  billing: {
    plans() { return API.request("/api/billing/plans"); },
    create(plan, period) { return API.request("/api/billing/create", { method: "POST", body: { plan, period } }); },
    check() { return API.request("/api/billing/check", { method: "POST" }); },
    async promo(code) {
      const d = await API.request("/api/billing/promo", { method: "POST", body: { code } });
      API.setSession(null, d.user);
      return d;
    },
  },

  /* --- Админка --- */
  admin: {
    stats() { return API.request("/api/admin/stats"); },
    users(q = "", limit = 100, offset = 0) {
      const p = new URLSearchParams({ q, limit, offset });
      return API.request("/api/admin/users?" + p);
    },
    card(email) { return API.request("/api/admin/user?email=" + encodeURIComponent(email)); },
    payments() { return API.request("/api/admin/payments"); },
    /* tier — какой именно тариф дарим: basic или pro. Без него сервер
       по умолчанию выдаёт старший, и «Базовый» подарить было нельзя. */
    grant(email, plan, days, tier) {
      return API.request("/api/admin/grant", { method: "POST", body: { email, plan, days, tier } });
    },
    revoke(email) { return API.request("/api/admin/revoke", { method: "POST", body: { email } }); },
    /* Очередь публичной ленты: что ждёт проверки и решение по вопросу. */
    qaPending() { return API.request("/api/admin/qa"); },
    qaDecide(id, action, question, topic) {
      return API.request("/api/admin/qa", { method: "POST", body: { id, action, question, topic } });
    },
    resetTrial(email) { return API.request("/api/admin/reset-trial", { method: "POST", body: { email } }); },
    deleteUser(email) { return API.request("/api/admin/delete-user", { method: "POST", body: { email } }); },
    setRole(email, role) { return API.request("/api/admin/set-role", { method: "POST", body: { email, role } }); },
    resetPassword(email) { return API.request("/api/admin/reset-password", { method: "POST", body: { email } }); },
    points(email, delta, reason) { return API.request("/api/admin/points", { method: "POST", body: { email, delta, reason } }); },
  },
};

class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data || {};
  }
  /* 402 — упёрлись в лимит: вызывающий код показывает пейволл, а не ошибку. */
  get isPaywall() { return this.status === 402 || Boolean(this.data.paywall); }
}
window.ApiError = ApiError;
