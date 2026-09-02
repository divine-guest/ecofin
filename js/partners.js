/* ============ ЭкоФин — партнёрские предложения ============

   Зачем это здесь. Подписка — не единственный и на раннем этапе не главный
   доход. У калькуляторов будет поисковый трафик: «какой налоговый режим
   выбрать», «расчёт больничного». Это люди с деньгами и конкретной задачей.
   Банк платит за одного открытого расчётного счёта ИП больше, чем стоит
   годовая подписка.

   ⚠️ ЭТИ ПОЛЯ НЕЛЬЗЯ ЗАПОЛНИТЬ ЗА ВЛАДЕЛЬЦА, И ВОТ ПОЧЕМУ.

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
   2. Получить у партнёра или у CPA-сети целевую ссылку → в поле `url`.
   3. Взять точное наименование рекламодателя и его ИНН из договора
      → в поле `advertiser`.
   4. Зарегистрировать креатив у оператора рекламных данных (ОРД).
      Токен erid → в поле `erid`. Часть партнёров выдаёт токен сама —
      спросить у них раньше, чем идти в ОРД самому.
   5. Поставить `enabled: true` в этом файле.
   6. Ежемесячно сдавать отчётность о показах — обычно это делает ОРД
      автоматически, но проверить обязан рекламодатель.

   Пока `enabled: false`, блок видят только администраторы, с пометкой,
   что это заготовка. Обычные посетители не видят ничего.               */

const PARTNERS = {
  /* Общий рубильник: пока не заполнены ссылки и маркировка — блок скрыт. */
  enabled: false,

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

  /* Предложение готово к показу, только если заполнены ссылка и маркировка. */
  ready(offer) {
    return Boolean(offer.url && offer.advertiser && offer.erid);
  },

  forContext(context, audience) {
    return this.offers.filter(o =>
      o.context.includes(context) &&
      (o.audience === "all" || !audience || o.audience === audience)
    );
  },

  /* Рисует блок в указанный контейнер. Если партнёрки не подключены,
     администратор видит заготовку, остальные — ничего. */
  render(containerId, context, audience) {
    const box = document.getElementById(containerId);
    if (!box) return;

    const offers = this.forContext(context, audience);
    const live = offers.filter(o => this.ready(o));
    const isAdmin = typeof PF !== "undefined" && PF.isAdmin && PF.isAdmin();

    if (!this.enabled || !live.length) {
      box.innerHTML = isAdmin && offers.length
        ? `<div class="partners preview">
             <div class="partners-head">
               <span class="partners-label">Партнёрский блок · заготовка</span>
               <span class="hint">Видно только администраторам</span>
             </div>
             <p class="hint">Здесь встанут ${offers.length} предложения для этой страницы.
             Чтобы включить: заполнить ссылку и маркировку в <code>js/partners.js</code>
             и поставить <code>enabled: true</code>.</p>
             <div class="partners-grid">${offers.map(o => this.card(o, true)).join("")}</div>
           </div>`
        : "";
      return;
    }

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

  track(id) {
    if (typeof trackEvent === "function") trackEvent("partner_click", { id });
  },
};
