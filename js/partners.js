/* ============ ЭкоФин — партнёрские предложения ============

   Зачем это здесь. Подписка — не единственный и на раннем этапе не главный
   доход. У калькуляторов будет поисковый трафик: «какой налоговый режим
   выбрать», «расчёт больничного». Это люди с деньгами и конкретной задачей.
   Банк платит за одного открытого расчётного счёта ИП больше, чем стоит
   годовая подписка.

   ГДЕ ЗАПОЛНЯЮТСЯ ССЫЛКИ. В админке, раздел «Партнёрские предложения».
   Раньше их правили прямо в этом файле и выкатывали сайт — то есть
   включить партнёрку мог только тот, кто умеет пользоваться git.
   Тексты остались здесь, потому что это содержание страницы; ссылка,
   рекламодатель и токен приходят с сервера.

   ⚠️ ПОЧЕМУ БЕЗ ТРЁХ ПОЛЕЙ НИЧЕГО НЕ ПОКАЗЫВАЕТСЯ.

   Партнёрская ссылка — это реклама по 38-ФЗ. С 2022 года интернет-реклама
   подлежит маркировке: до показа креатив регистрируется у оператора
   рекламных данных, тот выдаёт токен erid, и данные о показах ежемесячно
   уходят в ЕРИР. Токен привязан к конкретному договору и конкретному
   рекламодателю — придумать его нельзя.

   Штраф за рекламу без маркировки — до 500 000 ₽ на юрлицо
   (ст. 14.3 КоАП РФ). Поэтому `ready()` ниже не показывает предложение,
   пока не заполнены все три поля. Это не перестраховка: показать заглушку
   с выдуманным токеном дороже, чем не показать ничего.

   ЧТО СДЕЛАТЬ ВЛАДЕЛЬЦУ, по шагам:

   1. Заключить партнёрский договор. У банков это «партнёрская программа»
      или «реферальная программа для вебмастеров»; у сервисов — обычно
      через CPA-сети. Оплата за открытый счёт ИП сейчас сопоставима
      с годовой подпиской на наш сервис.
   2. Получить у партнёра или у CPA-сети целевую ссылку.
   3. Взять точное наименование рекламодателя и его ИНН из договора.
   4. Зарегистрировать креатив у оператора рекламных данных (ОРД).
      Часть партнёров выдаёт токен erid сама — спросить у них раньше,
      чем идти в ОРД самому.
   5. Открыть админку, раздел «Партнёрские предложения», вписать три
      поля и включить. Ничего выкатывать не нужно.
   6. Ежемесячно сдавать отчётность о показах — обычно это делает ОРД
      автоматически, но проверить обязан рекламодатель.

   Пока предложение не заполнено и не включено, блок видят только
   администраторы, с пометкой, что это заготовка. Обычные посетители
   не видят ничего.                                                    */

const PARTNERS = {
  /* Что пришло с сервера: ссылка, рекламодатель и токен по каждому
     предложению. Пусто, пока не загрузилось или пока владелец ничего
     не подключил. */
  live: null,

  async load() {
    if (this.live) return this.live;
    try {
      const d = await API.request("/api/partners");
      this.live = Object.fromEntries((d.offers || []).map(o => [o.id, o]));
    } catch {
      /* Не загрузилось — показываем пусто. Реклама не та вещь, ради
         которой стоит показывать заглушку или ошибку. */
      this.live = {};
    }
    return this.live;
  },

  offers: [
    {
      id: "rko",
      /* Где показывать: id вкладки калькулятора или страницы */
      context: ["tax", "invoice", "tools"],
      audience: "ip",
      title: "Расчётный счёт для ИП",
      lead: "Бесплатное открытие и обслуживание в первые месяцы, онлайн-бухгалтерия в комплекте.",
      benefit: "Обычно нужен сразу после регистрации ИП",
      cta: "Сравнить банки",
      url: "",
      advertiser: "",
      erid: "",
    },
    {
      id: "buh",
      context: ["tax", "tools", "courses"],
      audience: "ip",
      title: "Онлайн-бухгалтерия",
      lead: "Считает налоги и взносы, сама формирует и сдаёт отчётность, напоминает о платежах.",
      benefit: "Дешевле приходящего бухгалтера",
      cta: "Посмотреть",
      url: "",
      advertiser: "",
      erid: "",
    },
    {
      id: "ecp",
      context: ["tools", "invoice"],
      audience: "all",
      title: "Электронная подпись",
      lead: "Нужна для отчётности, госзакупок и электронного документооборота.",
      benefit: "Выпуск за один день",
      cta: "Оформить",
      url: "",
      advertiser: "",
      erid: "",
    },
    {
      id: "acquiring",
      context: ["invoice", "tax"],
      audience: "ip",
      title: "Приём оплаты картой и по СБП",
      lead: "Эквайринг без кассового аппарата: ссылка на оплату, QR, платёжная страница.",
      benefit: "Нужен всем, кто выставляет счета",
      cta: "Сравнить условия",
      url: "",
      advertiser: "",
      erid: "",
    },
    {
      id: "marketplace",
      context: ["tools", "tax"],
      audience: "ip",
      title: "Сервис для продавцов на маркетплейсах",
      lead: "Аналитика ниш, автоматические поставки, управление ценой и остатками.",
      benefit: "Аудитория раздела «Аудит карточки товара»",
      cta: "Посмотреть",
      url: "",
      advertiser: "",
      erid: "",
    },
    {
      id: "samozanyat",
      context: ["tax"],
      audience: "self",
      title: "Карта для самозанятых",
      lead: "Отдельный счёт для доходов, автоматический учёт и уплата налога на профдоход.",
      benefit: "Не смешивать личные деньги с рабочими",
      cta: "Подобрать",
      url: "",
      advertiser: "",
      erid: "",
    },
  ],

  /* Предложение готово к показу, только если заполнены ссылка и
     маркировка. То же самое проверяет сервер — он и решает, что
     отдать: в браузере такое правило обходится правкой в консоли,
     а цена ошибки — штраф до 500 000 ₽ по ст. 14.3 КоАП. */
  ready(offer) {
    const l = (this.live || {})[offer.id];
    return Boolean(l && l.url && l.advertiser && l.erid);
  },

  /* Тексты берём из этого файла, ссылку и маркировку — с сервера. */
  full(offer) {
    return { ...offer, ...((this.live || {})[offer.id] || {}) };
  },

  forContext(context, audience) {
    return this.offers.filter(o =>
      o.context.includes(context) &&
      (o.audience === "all" || !audience || o.audience === audience)
    );
  },

  /* Рисует блок в указанный контейнер. Если партнёрки не подключены,
     администратор видит заготовку, остальные — ничего. */
  async render(containerId, context, audience) {
    const box = document.getElementById(containerId);
    if (!box) return;

    await this.load();

    const offers = this.forContext(context, audience);
    const live = offers.filter(o => this.ready(o)).map(o => this.full(o));
    const isAdmin = typeof PF !== "undefined" && PF.isAdmin && PF.isAdmin();

    if (!live.length) {
      box.innerHTML = isAdmin && offers.length
        ? `<div class="partners preview">
             <div class="partners-head">
               <span class="partners-label">Партнёрский блок · заготовка</span>
               <span class="hint">Видно только администраторам</span>
             </div>
             <p class="hint">Здесь встанут ${offers.length} предложения для этой страницы.
             Чтобы включить: <a href="${PF.href("admin.html")}#partners">заполнить ссылку и
             маркировку в админке</a>. Выкатывать сайт не нужно.</p>
             <div class="partners-grid">${offers.map(o => this.card(o, true)).join("")}</div>
           </div>`
        : "";
      return;
    }

    /* Показы считаем на сервере: отношение переходов к показам —
       то, о чём разговаривают с партнёром про ставку. Два перехода
       из десяти показов и два из тысячи — разные новости. */
    try {
      API.request("/api/partners/shown", { method: "POST", body: { ids: live.map(o => o.id) } });
    } catch {}

    box.innerHTML = `
      <div class="partners">
        <div class="partners-head">
          <span class="partners-label">Что может пригодиться</span>
          <span class="hint">Реклама</span>
        </div>
        <div class="partners-grid">${live.map(o => this.card(o, false)).join("")}</div>
      </div>`;
  },

  card(o, preview) {
    const esc = typeof escapeHtml === "function" ? escapeHtml : (x => x);
    const action = preview
      ? `<span class="btn small secondary" aria-disabled="true">${esc(o.cta)}</span>`
      : `<a class="btn small" href="${esc(o.url)}" target="_blank" rel="nofollow sponsored noopener"
            onclick="PARTNERS.track('${esc(o.id)}')">${esc(o.cta)}</a>`;

    return `
      <div class="partner-card">
        <div class="partner-body">
          <b>${esc(o.title)}</b>
          <p>${esc(o.lead)}</p>
          <span class="partner-benefit">${esc(o.benefit)}</span>
        </div>
        <div class="partner-foot">
          ${action}
          ${preview ? "" : `<span class="partner-mark">Реклама. ${esc(o.advertiser)}. erid: ${esc(o.erid)}</span>`}
        </div>
      </div>`;
  },

  /* Переход считаем на сервере: счётчик в браузере не переживает
     закрытие вкладки, а именно по переходам владелец разговаривает
     с партнёром. Ответа не ждём — переход не должен тормозить. */
  track(id) {
    if (typeof trackEvent === "function") trackEvent("partner_click", { id });
    try { API.request("/api/partners/click", { method: "POST", body: { id } }); } catch {}
  },
};
