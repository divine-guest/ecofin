/* ============ ЭкоФин — реквизиты и контрагенты ============

   Один раз ввёл — работает во всех пятидесяти документах.

   До этого человек набирал наименование, ИНН, адрес и банк заново в
   каждой бумаге. Для счёта, который выставляют дважды в неделю, проще
   было держать свой файл в Word: там хотя бы ничего не надо вводить.

   Отсюда же ощущение, что «услуг мало». Их не мало — они не связаны.
   Пятьдесят несвязанных шаблонов человек воспринимает как один шаблон,
   который каждый раз заполняется с нуля.                              */

const REQ = {
  mine: null,          // свои реквизиты
  parties: [],         // контрагенты
  loaded: false,

  async load(force = false) {
    if (this.loaded && !force) return this;
    if (!PF.user()) { this.loaded = true; return this; }
    try {
      const [a, b] = await Promise.all([API.requisites(), API.counterparties()]);
      this.mine = a.requisites || null;
      this.parties = b.counterparties || [];
    } catch { /* нет связи — просто не подставляем, форма остаётся рабочей */ }
    this.loaded = true;
    return this;
  },

  ready() { return Boolean(this.mine && this.mine.name && this.mine.inn); },

  /* ---------- Какое поле кем является ----------

     Имя поля — основной признак, подпись к нему — право вето.

     Так вышло, что ключ from в одних шаблонах значит «От кого», а в
     «Дополнительном соглашении» — «С какой даты действует». Подстановка
     только по имени вписала бы наименование организации вместо даты, и
     человек получил бы документ, действующий с «ИП Иванов И. И.».     */
  MINE: ["org", "from", "side1", "seller", "landlord", "employer", "lender", "executor"],
  OTHER: ["to", "side2", "buyer", "customer", "tenant", "borrower", "recipient"],

  /* Подпись, которая заведомо просит не сторону, а что-то другое. */
  NOT_PARTY: /дат|срок|период|сумм|номер|цен|кол-во|₽|причин|основани/i,

  role(key, label) {
    if (this.NOT_PARTY.test(label || "")) return null;
    if (this.MINE.includes(key)) return "mine";
    if (this.OTHER.includes(key)) return "other";
    return null;
  },

  /* ---------- Что именно подставить ----------

     Подписи к полям сами говорят, чего от них хотят: «Поставщик
     (название, ИНН, КПП, адрес)» — одно, «Сторона 1» — другое. Собираем
     строку по подписи, а не вываливаем всё подряд: лишние реквизиты в
     договоре подряда выглядят так же неряшливо, как их нехватка. */
  compose(r, label = "") {
    if (!r || !r.name) return "";
    const want = String(label).toLowerCase();
    const parts = [r.name];

    const asked = (...words) => words.some(w => want.includes(w));

    if (r.inn && asked("инн", "реквизит")) parts.push("ИНН " + r.inn);
    if (r.kpp && asked("кпп", "реквизит")) parts.push("КПП " + r.kpp);
    if (r.ogrn && asked("огрн", "реквизит")) parts.push((r.ogrn.length === 15 ? "ОГРНИП " : "ОГРН ") + r.ogrn);
    if (r.address && asked("адрес", "реквизит")) parts.push(r.address);
    if (r.phone && asked("телефон", "реквизит")) parts.push("тел. " + r.phone);

    /* Если подпись ничего конкретного не просит, но у поля длинная
       строка ввода — даём наименование с ИНН: этого хватает, чтобы
       сторону можно было опознать, и не превращает поле в простыню. */
    if (parts.length === 1 && r.inn && want.length > 22) parts.push("ИНН " + r.inn);

    return parts.join(", ");
  },

  /* Банковские реквизиты — отдельной строкой: в счёте под них своё поле,
     и втискивать их в наименование нельзя. */
  bankLine(r) {
    if (!r || !r.bank) return "";
    const p = [r.bank];
    if (r.bik) p.push("БИК " + r.bik);
    if (r.account) p.push("р/с " + r.account);
    if (r.corr) p.push("к/с " + r.corr);
    return p.join(", ");
  },

  /* ---------- Подстановка в открытую форму ----------

     Возвращает, сколько полей заполнено: вызывающему это нужно, чтобы
     сказать человеку «подставлено 4 поля», а не молча ничего не сделать
     и оставить его гадать, нажалась кнопка или нет. */
  fill(fields, who, party = null) {
    const source = who === "mine" ? this.mine : party;
    if (!source) return 0;
    let n = 0;

    for (const [key, label] of fields) {
      const el = document.getElementById("f_" + key);
      if (!el) continue;

      /* Заполненное не трогаем: человек мог уже что-то вписать руками,
         и затирать это — худшее, что может сделать «удобная» кнопка. */
      if (el.value.trim()) continue;

      let value = "";
      if (key === "bank") value = who === "mine" ? this.bankLine(source) : (source.bank || "");
      else if (key === "inn" && who === "mine") value = source.inn || "";
      else if (this.role(key, label) === who) value = this.compose(source, label);

      if (value) { el.value = value; el.dispatchEvent(new Event("input", { bubbles: true })); n++; }
    }
    return n;
  },

  /* ---------- Дата документа ----------

     Подставляем сегодняшнюю — но только там, где речь о дате САМОГО
     документа. Подписи разделяются чисто: «Дата», «Дата счёта», «Дата
     приказа» — это он и есть; «Дата расторжения», «Дата увольнения»,
     «На какую дату нужна справка» — совсем другие даты, и сегодняшняя
     там будет прямой ошибкой в документе, который человек подпишет.

     Поэтому список закрытый: любая подпись, не попавшая в него,
     остаётся пустой. Пустое поле человек заметит и заполнит, неверно
     заполненное — подпишет. */
  OWN_DATE: /^дата( (счёта|счета|приказа|акта|документа|накладной|справки))?$/i,

  putDate(fields) {
    const today = new Date().toLocaleDateString("ru-RU");
    let n = 0;
    for (const [key, label] of fields) {
      if (!this.OWN_DATE.test(String(label).trim())) continue;
      const el = document.getElementById("f_" + key);
      if (!el || el.value.trim()) continue;
      el.value = today;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      n++;
    }
    return n;
  },

  /* ---------- Номер документа ----------

     Вид определяем по названию шаблона. Номер занимаем на сервере сразу,
     а не просто показываем: иначе человек, открывший форму дважды,
     выставит два счёта с одним номером — а это спор с контрагентом и
     вопрос на проверке. Пропущенный номер не нарушает ничего. */
  KIND_BY_TITLE: [
    [/счёт|счет/i, "schet"],
    [/накладн/i, "nakladnaya"],
    [/^акт|акт /i, "akt"],
    [/договор|соглашение/i, "dogovor"],
    [/приказ/i, "prikaz"],
    [/претензи/i, "pretenziya"],
  ],

  kindOf(title) {
    for (const [re, kind] of this.KIND_BY_TITLE) if (re.test(title)) return kind;
    return "";
  },

  async putNumber(title, fields) {
    const kind = this.kindOf(title);
    if (!kind || !PF.user()) return 0;

    const numField = fields.find(([k]) => k === "no" || k === "number");
    if (!numField) return 0;
    const el = document.getElementById("f_" + numField[0]);
    if (!el || el.value.trim()) return 0;

    try {
      const r = await API.docNumber(kind);
      el.value = String(r.number);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      return r.number;
    } catch { return 0; }
  },
};

if (typeof window !== "undefined") window.REQ = REQ;
