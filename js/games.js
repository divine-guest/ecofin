/* ============ ПравоФин — игры ============ */

/* ---------- 1. Разбор кейсов ---------- */
const DETECTIVE = (() => {
  const cases = [
    {
      title: "Дело №1: Молчаливый подрядчик",
      story: "ООО «Строймонтаж» выполнил работы, но заказчик отказался платить, ссылаясь на то, что договор был подписан неуполномоченным лицом. Кто выиграет спор?",
      options: ["Заказчик — договор недействителен", "Подрядчик — если заказчик принял работы (ст. 183 ГК РФ)", "Никто — сделка ничтожна"],
      correct: 1,
      explain: "Ст. 183 ГК РФ: если заказчик фактически принял работы, он одобрил сделку. Подрядчик вправе требовать оплату.",
    },
    {
      title: "Дело №2: Пропавшая предоплата",
      story: "Покупатель перечислил предоплату за товар, продавец товар не поставил и на письма не отвечает. Какой документ быстрее всего вернёт деньги?",
      options: ["Иск в суд", "Претензия с требованием вернуть предоплату (ст. 487 ГК РФ)", "Жалоба в Роспотребнадзор"],
      correct: 1,
      explain: "По ст. 487 ГК РФ при непоставке товара предоплата возвращается. Досудебная претензия обязательна и часто решает дело без суда.",
    },
    {
      title: "Дело №3: Самозанятый лимит",
      story: "Самозанятый заработал за год 3 млн ₽. Что будет с его статусом?",
      options: ["Ничего, просто доначислят налог", "Статус аннулируется с превышения 2,4 млн ₽, доход сверх лимита облагается НДФЛ", "Оштрафуют на 100 000 ₽"],
      correct: 1,
      explain: "При доходе свыше 2,4 млн ₽ статус НПД прекращается; превышение облагается НДФЛ. Штрафа нет, но анонимные чеки уже не выписать.",
    },
    {
      title: "Дело №4: Уволенный без объяснений",
      story: "Работника уволили «по соглашению сторон», но соглашение он не подписывал. Суд или трудовая инспекция?",
      options: ["Только суд", "Трудовая инспекция может восстановить, суд — взыскать компенсацию; оба пути открыты", "Ничего не сделать"],
      correct: 1,
      explain: "Увольнение без подписанного соглашения незаконно. Инспекция (ст. 356 ТК РФ) восстановит права, суд — плюс компенсации (ст. 394 ТК РФ).",
    },
    {
      title: "Дело №5: Долг по расписке",
      story: "Друг занял 300 000 ₽ по расписке без свидетелей и не отдаёт 2 года. Прошёл ли срок исковой давности?",
      options: ["Да, 2 года прошло", "Нет — общий срок давности 3 года (ст. 196 ГК РФ)", "Расписка без нотариуса недействительна"],
      correct: 1,
      explain: "Исковая давность — 3 года с момента, когда долг должен был быть возвращён. Расписка — достаточное доказательство без нотариуса.",
    },
  ];
  let idx = 0, score = 0;

  function render() {
    const c = cases[idx];
    document.getElementById("detTitle").textContent = c.title;
    document.getElementById("detStory").textContent = c.story;
    document.getElementById("detExplain").textContent = "";
    document.getElementById("detExplain").className = "ai-result";
    document.getElementById("detNext").style.display = "none";
    document.getElementById("detOptions").innerHTML =
      c.options.map((_, i) => `<button class="quiz-option" onclick="DETECTIVE.answer(${i})">${escapeHtml(c.options[i])}</button>`).join("");
    document.getElementById("detProgress").textContent = `Кейс ${idx + 1} / ${cases.length} · Верно: ${score / 20}`;
  }
  function answer(i) {
    const c = cases[idx];
    const btns = document.querySelectorAll("#detOptions .quiz-option");
    btns.forEach((b, j) => {
      b.disabled = true;
      if (j === c.correct) b.classList.add("correct");
      else if (j === i) b.classList.add("wrong");
    });
    if (i === c.correct) { score += 20; COMP.award("contracts", 4); }
    const ex = document.getElementById("detExplain");
    ex.textContent = (i === c.correct ? "✅ Верно! " : "❌ Неверно. ") + c.explain;
    ex.classList.add("show");
    document.getElementById("detNext").style.display = "inline-flex";
    document.getElementById("detProgress").textContent = `Кейс ${idx + 1} / ${cases.length} · Верно: ${score / 20}`;
  }
  function next() {
    idx++;
    if (idx >= cases.length) {
      PF.logAction(`Разбор кейсов: верно ${score / 20} из ${cases.length}`);
      document.getElementById("detTitle").textContent = "Разбор кейсов завершён";
      document.getElementById("detStory").textContent = `Верно решено: ${score / 20} из ${cases.length} кейсов (${Math.round(score / (cases.length * 20) * 100)}%). Компетенция «Договорная работа» выросла.`;
      document.getElementById("detOptions").innerHTML = `<button class="btn" onclick="DETECTIVE.restart()">Пройти заново</button>`;
      document.getElementById("detNext").style.display = "none";
      return;
    }
    render();
  }
  function restart() { idx = 0; score = 0; render(); }
  /* cases открыты наружу: «Задание недели» показывает название дела. */
  return { render, answer, next, restart, cases };
})();

/* ---------- 3. ФинЗарядка (быстрая викторина на время) ---------- */
const WARMUP = (() => {
  const pool = [
    q("Чему равен налог для самозанятого с дохода от юрлиц?", ["4%", "6%", "13%", "20%"], 1),
    q("Сколько составляет лимит дохода самозанятого?", ["1 млн ₽", "2,4 млн ₽", "5 млн ₽", "Без лимита"], 1),
    q("Ставка УСН «Доходы» (базовая)?", ["5%", "6%", "15%", "25%"], 1),
    q("ИП обязан платить страховые взносы за себя?", ["Да, каждый год", "Нет", "Только с работниками"], 0),
    q("Срок исковой давности по ГК РФ?", ["1 год", "2 года", "3 года", "5 лет"], 2),
    q("Что такое НДС?", ["Налог на добычу средств", "Налог на добавленную стоимость", "Налог для самозанятых"], 1),
    /* Было помечено «в день выхода» — это противоречило разделу
    «верно/неверно» в этом же файле и статье 67 ТК РФ: оформить письменно
    надо не позднее трёх рабочих дней с фактического допуска. */
    q("За сколько работодатель обязан оформить трудовой договор письменно после фактического допуска к работе?", ["В тот же день", "3 рабочих дня", "30 дней"], 1),
    q("ФЗ-115 регулирует…", ["Противодействие отмыванию доходов", "Трудовые отношения", "Налогообложение ИП"], 0),
    q("Может ли самозанятый нанимать работников?", ["Да", "Нет"], 1),
    q("Налог на прибыль ООО с 2025 г.?", ["20%", "25%", "30%"], 1),
  ];
  function q(text, opts, correct) { return { text, opts, correct }; }

  let questions = [], idx = 0, score = 0, timer = null, timeLeft = 60;

  function start() {
    questions = [...pool].sort(() => Math.random() - 0.5);
    idx = 0; score = 0; timeLeft = 60;
    clearInterval(timer);
    timer = setInterval(() => {
      timeLeft--;
      document.getElementById("wuTime").textContent = timeLeft;
      if (timeLeft <= 0) finish();
    }, 1000);
    document.getElementById("wuStart").style.display = "none";
    document.getElementById("wuQuiz").style.display = "block";
    render();
  }
  function render() {
    const c = questions[idx];
    document.getElementById("wuQ").textContent = c.text;
    document.getElementById("wuOpts").innerHTML = c.opts.map((o, i) =>
      `<button class="quiz-option" onclick="WARMUP.answer(${i})">${o}</button>`).join("");
    document.getElementById("wuScore").textContent = score;
  }
  function answer(i) {
    if (i === questions[idx].correct) { score += 10; toast("Верно"); }
    else toast("Неверно");
    idx++;
    if (idx >= questions.length) finish(); else render();
  }
  function finish() {
    clearInterval(timer);
    const pct = Math.round(score / (questions.length * 10) * 100);
    const grown = COMP.award("tax", Math.round(pct * 0.15));
    PF.logAction(`Экспресс-тест: ${pct}% верных`);
    document.getElementById("wuQuiz").style.display = "none";
    document.getElementById("wuStart").style.display = "block";
    document.getElementById("wuStart").innerHTML = `<h3>Результат: ${pct}% верных</h3><p style="color:var(--muted)">Компетенция «Налоги»: +${grown}%</p><br><button class="btn" onclick="WARMUP.start()">Пройти ещё раз</button>`;
  }
  return { start, answer };
})();

/* ---------- 5. Кейс-клуб ---------- */
const CASECLUB = (() => {
  const cases = [
    {
      field: "Корпоративное право",
      text: "Два учредителя ООО 50/50 не могут согласовать директора, компания парализована полгода. Что посоветуете?",
      answer: "Корпоративный тупик. Варианты: медиация, выкуп доли одной стороной (ст. 8 ФЗ об ООО — возможность обращения с требованием выкупа в исключительных случаях), в крайнем случае — ликвидация по решению суда (ст. 67.3 ГК РФ о злоупотреблении правом). Профилактика — корпоративный договор с механизмом разрешения тупиков.",
    },
    {
      field: "Налоги",
      text: "ИП на УСН 6% оказывает услуги единственному заказчику — крупной компании. Налоговая намекает на переквалификацию в трудовые отношения. Риски?",
      answer: "Риск доначисления НДФЛ и взносов при признании отношений трудовыми (ст. 54.1 НК РФ). Что снижает риск: несколько заказчиков, собственное оборудование, отсутствие графика работы и подчинения, свои риски и расходы, документы о результатами работ (акты).",
    },
    {
      field: "Банкротство",
      text: "Директор ООО довёл компанию до банкротства, долгов на 50 млн ₽. Может ли он избежать субсидиарной ответственности?",
      answer: "Субсидиарная ответственность (ФЗ-127, гл. III.2) наступает при невыплате налогов из-за виновных действий (презумпция при долгах >50% требований). Защита: доказать добросовестность — бухгалтерский учёт в порядке, решения экономически обоснованы, иск о взыскании задолженности подавался. Полностью «избежать» нельзя — можно лишь доказать невиновность.",
    },
    {
      field: "ФЗ-115 / ПОД/ФТ",
      text: "Банк заблокировал счёт ИП: «подозрительные операции». Что делать?",
      answer: "Запросить у банка основания блокировки (115-ФЗ, ст. 7). Подготовить документы по сделкам: договоры, счета, акты, платежки. Направить мотивированное обоснование. Отказ — жалоба в межведомственную комиссию при Росфинмониторинге или суд (позиция ВС РФ: блокировка должна быть обоснованной).",
    },
    {
      field: "Трудовое право",
      text: "Работодатель переводит всех на самозанятость «чтобы сэкономить». Законно ли это?",
      answer: "Замена трудового договора договором ГПХ с самозанятым при сохранении признаков трудовых отношений (график, подчинение, постоянный характер) — незаконна (ст. 15 ТК РФ). Работник может требовать переквалификации в суде, налоговая — доначислит НДФЛ и взносы, ФНС автоматически исключает бывшего работника из плательщиков НПД (период 2 года).",
    },
    {
      field: "Договорное право",
      text: "Контрагент прислал договор с условием «одностороннее изменение цены без уведомления». Подписывать?",
      answer: "Нет без правки. Одностороннее изменение цены допустимо лишь в случаях, предусмотренных законом или договором (ст. 310 ГК РФ), но для предпринимателей условия можно закрепить — риск в отсутствии лимита и уведомления. Требуйте: уведомление за 30 дней, лимит повышения (например, не более 10%), право расторгнуть при несогласии.",
    },
  ];
  let current = 0;

  function render() {
    const c = cases[current];
    document.getElementById("ccField").textContent = c.field;
    document.getElementById("ccText").textContent = c.text;
    const ans = document.getElementById("ccAnswer");
    ans.classList.remove("show");
    document.getElementById("ccNum").textContent = `${current + 1} / ${cases.length}`;
  }
  function reveal() {
    document.getElementById("ccAnswer").classList.add("show");
    COMP.award("contracts", 2);
    PF.logAction("Разбор кейса: " + document.getElementById("ccField").textContent);
  }
  function next(dir) {
    current = (current + dir + cases.length) % cases.length;
    render();
  }
  return { render, reveal, next, cases };
})();

/* ---------- 4. Найди ошибку в договоре ---------- */
const ERRHUNT = (() => {
  const docs = [
    {
      title: "Договор оказания услуг (образец с ошибками)",
      parts: [
        { t: "1.2. Исполнитель вправе в одностороннем порядке изменять стоимость услуг без уведомления Заказчика.", err: "Одностороннее изменение цены — риск: требуйте лимит и уведомление за 30 дней (ст. 310 ГК РФ)." },
        { t: "3.1. За просрочку оплаты Заказчик уплачивает неустойку 5% от суммы за каждый день.", err: "Чрезмерная неустойка: суд снизит по ст. 333 ГК РФ, но спор лучше предупредить — рыночно 0,1%/день." },
        { t: "6.4. Все споры рассматриваются только в суде по месту нахождения Исполнителя.", err: "Подсудность «по месту ответчика» удобнее: измените на «по месту истца» или договорную." },
        { t: "7.2. Заказчик согласен на обработку его персональных данных в любых целях.", err: "«В любых целях» — нарушение 152-ФЗ: цели должны быть конкретны." },
        { t: "2.3. Срок оказания услуг — по факту готовности Исполнителя.", err: "Нет определённого срока — спорный предмет: укажите конкретную дату или период." },
      ],
    },
    {
      title: "Договор поставки (образец с ошибками)",
      parts: [
        { t: "5.1. Поставщик не несёт ответственности за качество товара после отгрузки.", err: "Отказ от гарантии не снимает законную ответственность по ст. 475 ГК РФ — условие ничтожно." },
        { t: "4.4. Оплата производится в течение 90 дней с момента приёмки товара.", err: "Кассовый разрыв 90 дней — согласуйте отсрочку не более 30–45 дней." },
        { t: "8.1. Договор действует бессрочно; расторжение возможно только по соглашению сторон.", err: "Без права одностороннего выхода вы «прикованы» к договору (ст. 450.1 ГК РФ)." },
        { t: "9.3. Обстоятельства непреодолимой силы включают изменение курса валют.", err: "Валютный риск — не форс-мажор: это обычный предпринимательский риск." },
        { t: "10.2. Поставщик вправе передать права и обязанности третьим лицам без согласия Заказчика.", err: "Перемена лица без согласия — риск «неизвестного» контрагента (ст. 388 ГК РФ)." },
      ],
    },
  ];
  let doc = 0, found = 0;

  function start(d = 0) {
    doc = d; found = 0;
    render();
  }
  function render() {
    const c = docs[doc];
    document.getElementById("ehTitle").textContent = c.title;
    document.getElementById("ehText").innerHTML = c.parts.map((p, i) =>
      `<span class="eh-part" id="eh${i}" onclick="ERRHUNT.pick(${i})">${p.t}</span>`
    ).join(" ");
    document.getElementById("ehStatus").textContent = `Найдено ${found} из 5 ошибок`;
    document.getElementById("ehResult").classList.remove("show");
  }
  function pick(i) {
    const part = docs[doc].parts[i];
    const el = document.getElementById("eh" + i);
    if (part.err && !el.classList.contains("found")) {
      el.classList.add("found");
      found++;
      COMP.award("contracts", 3);
      const r = document.getElementById("ehResult");
      r.textContent = "Верно! " + part.err;
      r.classList.add("show");
      document.getElementById("ehStatus").textContent = `Найдено ${found} из 5 ошибок`;
      if (found === 5) {
        r.textContent += "\n\nВсе ошибки найдены — компетенция «Договорная работа» выросла.";
        PF.logAction("«Найди ошибку»: документ разобран полностью");
      }
    } else if (!part.err) {
      el.classList.add("ok");
      const r = document.getElementById("ehResult");
      r.textContent = "Этот пункт корректен — ищите дальше.";
      r.classList.add("show");
    }
  }
  return { start, pick };
})();

/* ---------- 5. Верно / неверно ---------- */
const TRUEFALSE = (() => {
  const pool = [
    ["Самозанятый может нанимать работников по трудовому договору", false],
    ["УСН «Доходы» облагается по ставке 6%", true],
    ["Исковая давность по общим спорам — 5 лет", false],
    ["Декларацию по УСН ИП подаёт до 25 апреля", true],
    ["Работодатель может штрафовать работников деньгами", false],
    ["НДС на УСН появляется при доходе свыше 60 млн ₽", true],
    ["Расписка без нотариуса недействительна", false],
    ["Трудовой договор заключается письменно в 3-дневный срок", true],
    ["ИП обязан платить страховые взносы за себя даже без дохода", true],
    ["Претензия контрагенту в арбитражном споре обязательна", true],
    ["Налог на прибыль ООО с 2025 года — 20%", false],
    ["Неустойку можно снизить через суд по ст. 333 ГК РФ", true],
  ];
  let qs = [], i = 0, correct = 0;

  function start() {
    qs = [...pool].sort(() => Math.random() - .5).slice(0, 8);
    i = 0; correct = 0;
    document.getElementById("tfStart").style.display = "none";
    document.getElementById("tfQuiz").style.display = "block";
    render();
  }
  function render() {
    document.getElementById("tfNum").textContent = `Вопрос ${i + 1} из ${qs.length}`;
    document.getElementById("tfQ").textContent = qs[i][0];
  }
  function answer(v) {
    const ok = v === qs[i][1];
    if (ok) { correct++; COMP.award("tax", 2); }
    toast(ok ? "Верно" : "Неверно: " + (qs[i][1] ? "это правда" : "это миф"));
    i++;
    if (i >= qs.length) {
      const pct = Math.round(correct / qs.length * 100);
      PF.logAction(`«Верно/неверно»: ${pct}%`);
      document.getElementById("tfQuiz").style.display = "none";
      document.getElementById("tfStart").style.display = "block";
      document.getElementById("tfStart").innerHTML =
        `<h3>Результат: ${pct}% верных</h3><p style="color:var(--muted)">Верно ${correct} из ${qs.length}</p><br><button class="btn" onclick="TRUEFALSE.start()">Ещё раз</button>`;
    } else render();
  }
  return { start, answer };
})();
