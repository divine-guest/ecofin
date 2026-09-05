/* Целостность содержания: база знаний, тесты, практикум.

   Проверки офлайн — сети не требуют, поэтому идут в CI на каждую
   отправку кода. Ловят то, на чём этот раздел уже спотыкался:
   пустые статьи, битые ссылки «читать дальше», вопросы без разбора
   и правильные ответы, скопившиеся на одной позиции.               */

import fs from "node:fs";

const read = f => fs.readFileSync(new URL(f, import.meta.url), "utf8");

/* Модули написаны для браузера: подставляем недостающее и выполняем. */
const sandbox = {};
const load = (file, names) => {
  const src = read(file);
  const fn = new Function(src + "\nreturn {" + names.join(",") + "};");
  return fn();
};

let pass = 0, fail = 0;
const ok = (c, label, extra = "") => {
  c ? (pass++, console.log("  ✓", label)) : (fail++, console.log("  ✗", label, extra));
};

const { ARTICLES, TESTS } = load("../js/knowledge.js", ["ARTICLES", "TESTS"]);

console.log("\n— База знаний —");
ok(ARTICLES.length >= 25, `статей: ${ARTICLES.length}`);

const short = ARTICLES.filter(a => (a.body || "").length < 800);
ok(short.length === 0, "нет статей короче 800 символов",
   short.map(a => a.title).join("; "));

const noSummary = ARTICLES.filter(a => !a.summary);
ok(noSummary.length === 0, "у каждой статьи есть краткое описание",
   noSummary.map(a => a.title).join("; "));

const noSteps = ARTICLES.filter(a => !(a.steps || []).length);
ok(noSteps.length === 0, "у каждой статьи есть раздел «что сделать»",
   noSteps.map(a => a.title).join("; "));

const noMistakes = ARTICLES.filter(a => !(a.mistakes || []).length);
ok(noMistakes.length === 0, "у каждой статьи есть частые ошибки",
   noMistakes.map(a => a.title).join("; "));

const noArea = ARTICLES.filter(a => !a.area);
ok(noArea.length === 0, "у каждой статьи указана область",
   noArea.map(a => a.title).join("; "));

/* Ссылка «читать дальше» на несуществующую статью — тихая поломка:
   кнопка просто не появится, и никто не заметит. */
const titles = new Set(ARTICLES.map(a => a.title));
const brokenLinks = [];
for (const a of ARTICLES) {
  for (const r of a.related || []) {
    if (!titles.has(r)) brokenLinks.push(`${a.title} → ${r}`);
  }
}
ok(brokenLinks.length === 0, "все ссылки «читать дальше» ведут на существующие статьи",
   brokenLinks.join("; "));

const dupes = ARTICLES.map(a => a.title).filter((t, i, arr) => arr.indexOf(t) !== i);
ok(dupes.length === 0, "нет статей с одинаковыми заголовками", dupes.join("; "));

console.log("\n— Тесты —");
const keys = Object.keys(TESTS);
ok(keys.length >= 4, `тестов: ${keys.length}`);

let allQ = [];
for (const k of keys) allQ = allQ.concat(TESTS[k].questions || []);
ok(allQ.length >= 40, `вопросов всего: ${allQ.length}`);

const noWhy = allQ.filter(x => !x.why);
ok(noWhy.length === 0, "у каждого вопроса есть разбор",
   noWhy.slice(0, 3).map(x => x.text).join("; "));

const badRange = allQ.filter(x => !(x.correct >= 0 && x.correct < x.opts.length));
ok(badRange.length === 0, "номер правильного ответа не выходит за список вариантов",
   badRange.map(x => x.text).join("; "));

const fewOpts = allQ.filter(x => (x.opts || []).length < 3);
ok(fewOpts.length === 0, "минимум три варианта в каждом вопросе",
   fewOpts.map(x => x.text).join("; "));

/* Главная проверка. В прошлой версии 16 из 19 правильных ответов
   стояли посередине, и тест проходился, не читая вопросов. */
const dist = {};
for (const x of allQ) dist[x.correct] = (dist[x.correct] || 0) + 1;
const worst = Math.max(...Object.values(dist)) / allQ.length;
ok(worst <= 0.5,
   `правильные ответы распределены: максимум ${Math.round(worst * 100)}% на одной позиции`,
   JSON.stringify(dist));

const dupQ = allQ.map(x => x.text).filter((t, i, arr) => arr.indexOf(t) !== i);
ok(dupQ.length === 0, "нет повторяющихся вопросов", dupQ.slice(0, 3).join("; "));

console.log("\n— Практикум —");
const games = read("../js/games.js");

const cases = (games.match(/title:\s*"Дело/g) || []).length;
ok(cases >= 12, `дел для разбора: ${cases}`);

const tf = (games.match(/\["[^"]+",\s*(?:true|false)\]/g) || []).length;
ok(tf >= 30, `утверждений «верно / неверно»: ${tf}`);

const clubCases = (games.match(/field:\s*"/g) || []).length;
ok(clubCases >= 8, `кейсов в кейс-клубе: ${clubCases}`);

/* Перемешивание — единственная надёжная защита от «правильный всегда
   посередине»: оно работает независимо от того, как написаны данные. */
ok(games.includes("shuffleAnswers"), "варианты перемешиваются при показе");
ok(games.includes("shown[j].right"), "проверка ответа идёт по перемешанному порядку");

const kbHtml = read("../knowledge.html");
ok(kbHtml.includes("shuffleOpts"), "в тестах варианты тоже перемешиваются");
ok(kbHtml.includes("quiz-why"), "разбор ответа показывается в тестах");

/* ---------- Витрина против содержания ----------

   Главная обещала «7 калькуляторов» и «13 статей», когда их было 12 и 28:
   страница недооценивала продукт вдвое в самом видном месте и спорила
   сама с собой — тремя экранами ниже стояло «12 калькуляторов».
   Теперь числа на витрине сверяются с кодом. */

console.log("\n— Витрина не расходится с содержанием —");

const home = read("../index.html");
const calcHtml = read("../calc.html");

const calcCount = (calcHtml.match(/onclick="switchCalc\(/g) || []).length;
const heroNum = word => {
  const m = home.match(new RegExp("<b>(\\d+)</b><span>[^<]*" + word));
  return m ? Number(m[1]) : null;
};

ok(heroNum("калькулятор") === calcCount,
   `калькуляторов: на главной ${heroNum("калькулятор")}, в calc.html ${calcCount}`);
ok(heroNum("стат") === ARTICLES.length,
   `статей: на главной ${heroNum("стат")}, в базе знаний ${ARTICLES.length}`);

/* На витрине они названы «готовыми документами», а не «шаблонами»:
   человек ищет документ, а слово «шаблон» обещает заготовку, которую
   ещё надо доделывать. Ищем по слову «документ» — оно в счётчиках
   главной встречается ровно один раз. */
const tplCount = Object.keys(load("../js/templates.js", ["TEMPLATES"]).TEMPLATES).length;
ok(heroNum("документ") === tplCount,
   `документов: на главной ${heroNum("документ")}, в templates.js ${tplCount}`);

/* Каждый документ должен лежать в какой-то группе, иначе он есть
   в библиотеке, но его не видно на странице. */
const { TEMPLATES: T2, TEMPLATE_GROUPS } = load("../js/templates.js", ["TEMPLATES", "TEMPLATE_GROUPS"]);
const grouped = TEMPLATE_GROUPS.flatMap(g => g[2]);
const orphan = Object.keys(T2).filter(t => !grouped.includes(t));
const ghost = grouped.filter(t => !T2[t]);
ok(orphan.length === 0, `все документы разложены по группам${orphan.length ? ": не попали — " + orphan.join(", ") : ""}`);
ok(ghost.length === 0, `в группах нет ссылок на несуществующие документы${ghost.length ? ": " + ghost.join(", ") : ""}`);

/* Цены в разметке для поиска обязаны совпадать с тарифами воркера:
   расхождение цены на витрине и в кассе — претензия потребителя. */
const plans = read("../worker/src/plans.js");
const priceOf = (id, period) => {
  const block = plans.split(`  ${id}: {`)[1] || "";
  const m = block.match(/price: \{ month: (\d+), year: (\d+)/);
  return m ? Number(period === "year" ? m[2] : m[1]) : null;
};
for (const [id, period] of [["basic", "month"], ["basic", "year"], ["pro", "month"], ["pro", "year"]]) {
  const p = priceOf(id, period);
  ok(p !== null && home.includes(`"price":"${p}"`),
     `цена ${id}/${period} = ${p} ₽ есть в разметке главной`);
}

/* ---------- Страницы статей для поиска ---------- */

console.log("\n— Отдельные страницы статей —");

/* Правило превращения заголовка в адрес живёт в двух местах: в сборщике
   build-seo.mjs и в knowledge.html, который на эти адреса ссылается.
   Разъедутся — весь список статей будет вести в никуда. */
const { slug } = await import("../build-seo.mjs");
const kbPage = read("../knowledge.html");
const kbSlug = new Function(
  kbPage.match(/const KB_SLUG_MAP = \{[\s\S]*?\n\};/)[0] +
  kbPage.match(/function kbSlug\(title\) \{[\s\S]*?\n\}/)[0] +
  "\nreturn kbSlug;")();

const diff = ARTICLES.filter(a => kbSlug(a.title) !== slug(a.title));
ok(diff.length === 0, "адреса статей в списке и в сборщике совпадают",
   diff.map(a => a.title).join("; "));

const files = fs.readdirSync(new URL("../st/", import.meta.url)).filter(f => f.endsWith(".html"));
ok(files.length === ARTICLES.length,
   `файлов статей ${files.length}, статей ${ARTICLES.length}`);

const missing = ARTICLES.filter(a => !files.includes(slug(a.title) + ".html"));
ok(missing.length === 0, "у каждой статьи есть своя страница",
   missing.map(a => a.title).join("; "));

const sitemap = read("../sitemap.xml");
const notInMap = ARTICLES.filter(a => !sitemap.includes(`st/${slug(a.title)}.html`));
ok(notInMap.length === 0, "все страницы статей есть в карте сайта",
   notInMap.map(a => a.title).join("; "));

const faq = read("../faq.html");
ok(faq.includes('"@type":"FAQPage"'), "у раздела «Частые вопросы» есть разметка для поиска");
const faqQ = (faq.match(/<summary>/g) || []).length;
const ldQ = (faq.match(/"@type":"Question"/g) || []).length;
ok(faqQ === ldQ, `вопросов на странице ${faqQ}, в разметке ${ldQ}`);

ok(home.includes('"@type":"Organization"') && home.includes('"@type":"WebSite"'),
   "на главной есть разметка организации и поиска по сайту");

/* Кавычка внутри кавычки в style рвала три заголовка: атрибут
   закрывался раньше времени, остаток строки становился мусорными
   атрибутами, а размер шрифта и отступы пропадали. */
console.log("\n— Разметка —");
const brokenStyle = [];
for (const f of fs.readdirSync(new URL("../", import.meta.url))) {
  if (!/\.(html|js)$/.test(f)) continue;
  const src = read("../" + f);
  /* Кавычки внутри ${…} — это подстановка в шаблонной строке, там они
     законны. Ловим только настоящий разрыв атрибута. */
  const hits = (src.match(/style="[^"\n]*"[A-Za-zА-Яа-я]/g) || [])
    .filter(x => !x.includes("${"));
  if (hits.length) brokenStyle.push(`${f}: ${hits[0].slice(0, 60)}`);
}
ok(brokenStyle.length === 0, "нет кавычки внутри кавычки в style",
   brokenStyle.join("; "));

/* Библиотека шаблонов сходится сама с собой.

   Испортить её можно тремя способами, и ни один не виден глазом в
   файле на полторы тысячи строк: назвать в группе несуществующий
   шаблон (кнопка есть, нажатие пустое), написать шаблон и не положить
   ни в одну группу (найти нельзя), поставить в текст подстановку без
   поля ввода (человек получает документ с двойными скобками внутри). */
console.log("\n— Библиотека шаблонов —");
{
  const code = read("../js/templates.js");
  const box = {};
  new Function("box", code + "\nbox.T = TEMPLATES; box.G = TEMPLATE_GROUPS;")(box);
  const { T, G } = box;

  const missing = [];
  for (const [group, , items] of G)
    for (const name of items) if (!T[name]) missing.push(`${group} → ${name}`);
  ok(missing.length === 0, `все ${G.flatMap(g => g[2]).length} названий в разделах имеют шаблон`,
     missing.join("; "));

  const listed = new Set(G.flatMap(g => g[2]));
  const orphan = Object.keys(T).filter(k => !listed.has(k));
  ok(orphan.length === 0, `все ${Object.keys(T).length} шаблонов разложены по разделам`,
     orphan.join("; "));

  const noField = [];
  for (const [name, t] of Object.entries(T))
    for (const m of t.body.match(/\{\{(\w+)\}\}/g) || []) {
      const key = m.slice(2, -2);
      if (!t.fields.some(f => f[0] === key)) noField.push(`${name}: ${key}`);
    }
  ok(noField.length === 0, "у каждой подстановки в тексте есть поле ввода", noField.join("; "));

  /* Строка «зачем нужен документ» живёт в docs.html, а сам шаблон — в
     templates.js. Забыть её проще всего: карточка не ломается, просто
     выходит немой, и человек листает список названий, не понимая, что
     из них выбрать. */
  {
    const html = read("../docs.html");
    const box2 = {};
    new Function("box", html.match(/const DOC_WHY = \{[\s\S]*?\n\};/)[0] + "\nbox.W = DOC_WHY;")(box2);
    const mute = Object.keys(T).filter(k => !box2.W[k]);
    ok(mute.length === 0, "у каждого шаблона есть строка «зачем он нужен»", mute.join("; "));
    const stale = Object.keys(box2.W).filter(k => !T[k]);
    ok(stale.length === 0, "нет подсказок к удалённым шаблонам", stale.join("; "));
  }

  /* Поле, которое некуда подставить, — тоже ошибка: человек его
     заполняет, а в документе оно не появляется. */
  const unused = [];
  for (const [name, t] of Object.entries(T))
    for (const [key] of t.fields)
      if (!t.body.includes("{{" + key + "}}")) unused.push(`${name}: ${key}`);
  ok(unused.length === 0, "каждое поле ввода где-то подставляется", unused.join("; "));
}

/* Витрина возможностей не теряет целый вид записей.

   Она обещает «всё, что умеет сервис», и собирается из указателя
   быстрого поиска. Если в указателе заведут новый вид — скажем,
   «Курс» — а в списке разделов витрины его не окажется, все такие
   записи пропадут молча. Витрина при этом продолжит выглядеть полной. */
console.log("\n— Витрина показывает все виды записей —");
{
  const feats = read("../features.html");
  const groups = [...feats.matchAll(/\["([А-Яа-яЁё]+)",\s*"/g)].map(m => m[1]);

  const palette = read("../js/palette.js");
  const kinds = [...new Set([...palette.matchAll(/kind:\s*"([А-Яа-яЁё]+)"/g)].map(m => m[1]))];

  const missing = kinds.filter(k => !groups.includes(k));
  ok(missing.length === 0,
     `все виды из указателя есть на витрине (${kinds.length} видов)`,
     missing.join(", "));
}

/* Разбирается ли каждый файл js вообще.

   Повод: в комментарии оказался пример регулярного выражения, внутри
   которого встретилась закрывающая последовательность комментария.
   Комментарий оборвался посреди фразы, остаток стал кодом, и app.js
   перестал разбираться. app.js подключён на каждой странице — упал бы
   весь сайт разом, а остальные проверки этого не видят: они проверяют
   сервер, а не то, как браузер читает файлы. */
console.log("\n— Файлы js разбираются —");
{
  const dir = new URL("../js/", import.meta.url);
  const broken = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".js")) continue;
    const code = fs.readFileSync(new URL(f, dir), "utf8");
    try {
      new Function(code);
    } catch (e) {
      broken.push(`${f}: ${e.message}`);
    }
  }
  ok(broken.length === 0, `все ${fs.readdirSync(dir).filter(f => f.endsWith(".js")).length} файлов js разбираются`,
     broken.join("; "));
}

/* Скрипты внутри страниц тоже должны разбираться.

   Проверка выше смотрела только папку js. Но половина логики сайта
   живёт прямо в страницах, и ошибка там страшнее: браузер бросает
   разбор целиком, и страница выходит пустой. Так уже случалось —
   второй модуль с именем PLAN в кабинете обрушил бы весь кабинет,
   и ни одна проверка этого не увидела бы.

   Каждый встроенный скрипт разбираем отдельно, а потом все вместе:
   страница подключает их подряд, и повторно объявленное имя между
   двумя блоками браузер тоже считает ошибкой. */
console.log("\n— Скрипты внутри страниц разбираются —");
{
  const root = new URL("../", import.meta.url);
  const pages = fs.readdirSync(root).filter(f => f.endsWith(".html"));
  const broken = [];

  for (const f of pages) {
    const html = fs.readFileSync(new URL(f, root), "utf8");
    /* Пропускаем внешние файлы и разметку для поисковиков: там JSON,
       а не JavaScript. */
    const blocks = [...html.matchAll(/<script(?![^>]*\ssrc=)(?![^>]*type="application)[^>]*>([\s\S]*?)<\/script>/g)]
      .map(m => m[1]);
    blocks.forEach((code, i) => {
      try { new Function(code); } catch (e) { broken.push(`${f} #${i + 1}: ${e.message}`); }
    });
    if (blocks.length > 1) {
      try { new Function(blocks.join("\n;\n")); }
      catch (e) { broken.push(`${f} (все скрипты вместе): ${e.message}`); }
    }
  }
  ok(broken.length === 0, `скрипты на ${pages.length} страницах разбираются`, broken.slice(0, 4).join("; "));
}

/* Подпись поля связана с самим полем.

   Визуально подпись стоит рядом, и глазами всё в порядке. Программе
   связь не видна, если нет for="…": озвучка экрана называет такое поле
   безымянным — «поле ввода, пусто», — и незрячий человек не знает, что
   вводить. Плюс по клику на подпись не встаёт курсор, а это ожидают все.

   Так было у 136 полей: почти все формы сайта. */
console.log("\n— Подписи связаны с полями —");
{
  const loose = [];
  for (const f of fs.readdirSync(new URL("../", import.meta.url))) {
    if (!f.endsWith(".html")) continue;
    const src = read("../" + f);
    const re = /<label(?![^>]*\bfor=)[^>]*>(?:(?!<\/label>)[\s\S])*?<\/label>\s*<(?:input|select|textarea)\b[^>]*\bid="/g;
    const n = (src.match(re) || []).length;
    if (n) loose.push(`${f}: ${n}`);
  }
  ok(loose.length === 0, "у каждого поля подпись связана через for", loose.join("; "));
}

/* Идентификаторы уникальны в пределах страницы.

   Повторяющийся id — недопустимая разметка, и getElementById возвращает
   только первое совпадение. Так в «Моём деле» два экрана — первичная
   настройка и карточка профиля — делили одни имена полей: экраны
   взаимоисключающие, поэтому работало, но стоило показать оба, и
   сохранилось бы не то, что человек выбрал. */
console.log("\n— Идентификаторы не повторяются —");
{
  const bad = [];
  for (const f of fs.readdirSync(new URL("../", import.meta.url))) {
    if (!f.endsWith(".html")) continue;
    const ids = [...read("../" + f).matchAll(/\bid="([A-Za-z0-9_\-]+)"/g)].map(m => m[1]);
    const seen = new Set(), dup = new Set();
    for (const i of ids) (seen.has(i) ? dup : seen).add(i);
    if (dup.size) bad.push(`${f}: ${[...dup].join(", ")}`);
  }
  ok(bad.length === 0, "в каждой странице идентификаторы уникальны", bad.join("; "));
}


/* Числа на странице «О сервисе» — не только на главной.

   Там годами стояло 19 калькуляторов, 42 статьи и 32 документа при
   настоящих 30, 49 и 50: проверка смотрела одну главную, а расхождение
   росло с каждым добавлением. Это то место, куда идут решать, стоит ли
   доверять, — втрое заниженные числа работают против нас. */
console.log("\n— Числа на странице «О сервисе» —");
{
  const about = read("../about.html");
  const num = (re) => {
    const m = about.match(re);
    return m ? Number(m[1]) : null;
  };

  const calcCount = (read("../calc.html").match(/class="tab-panel/g) || []).length;
  const artCount = fs.readdirSync(new URL("../st/", import.meta.url)).filter(f => f.endsWith(".html")).length;

  const tplBox = {};
  new Function("box", read("../js/templates.js") + "\nbox.T = TEMPLATES;")(tplBox);
  const docCount = Object.keys(tplBox.T).length;

  const toolCount = (read("../tools.html").match(/data-tool="/g) || []).length;

  const shownCalc = num(/(\d+)<\/div><div class="stat-label">калькулятор/);
  const shownArt = num(/(\d+)<\/div><div class="stat-label">стат/);
  const shownDoc = num(/(\d+)<\/div><div class="stat-label">готовых документ/);
  const shownTool = num(/(\d+)<\/div><div class="stat-label">ИИ-инструмент/);

  ok(shownCalc === calcCount, `калькуляторов: на «О сервисе» ${shownCalc}, в calc.html ${calcCount}`);
  ok(shownArt === artCount, `статей: на «О сервисе» ${shownArt}, страниц в st/ ${artCount}`);
  ok(shownDoc === docCount, `документов: на «О сервисе» ${shownDoc}, в templates.js ${docCount}`);
  ok(shownTool === toolCount, `инструментов: на «О сервисе» ${shownTool}, вкладок в tools.html ${toolCount}`);

  /* И в перечне возможностей ниже — те же числа, а не свои. */
  const listCalc = num(/✓ (\d+) калькулятор/);
  const listArt = num(/✓ (\d+) стат/);
  const listDoc = num(/✓ (\d+) готовых документ/);
  ok(listCalc === calcCount, `в перечне калькуляторов: ${listCalc}`, listCalc);
  ok(listArt === artCount, `в перечне статей: ${listArt}`, listArt);
  ok(listDoc === docCount, `в перечне документов: ${listDoc}`, listDoc);
}


/* Правило оформления не должно молча перебиваться другим.

   Как это выглядело. Черта подведения итога под заголовками разделов
   написана в базовом слое, а ниже, в блоке «Переоформление 2026»,
   осталось старое мнение о том же селекторе. Побеждало старое: черта
   не отрисовалась НИ РАЗУ ни на одной странице, хотя стояла в файле
   вместе с объяснением, зачем она нужна. Заметить это глазами нельзя —
   отсутствие того, чего никогда не было, не бросается в глаза.

   Проверяем ровно опасное направление: одиночный селектор задал
   свойство, а ниже блок с ТЕМ ЖЕ селектором задаёт его иначе. Вес
   селекторов одинаков, значит решает порядок в файле, и раннее
   объявление — мёртвое.

   Обратное направление законно и не трогается: сначала группа
   «.hint, .badge { font-size }», потом исключение для одного из них. */
console.log("\n— Ни одно правило оформления не перебито молча —");
{
  const orig = read("../css/style.css");
  const mask = orig.replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length));

  const blocks = [];
  let i = 0, selStart = 0;
  while (i < mask.length) {
    if (mask[i] === "{") {
      const sel = mask.slice(selStart, i).trim();
      let d = 1, j = i + 1;
      while (j < mask.length && d > 0) { if (mask[j] === "{") d++; else if (mask[j] === "}") d--; j++; }
      if (!sel.startsWith("@")) blocks.push({ sel, from: i + 1, to: j - 1, at: i });
      i = j; selStart = i; continue;
    }
    if (mask[i] === "}") selStart = i + 1;
    i++;
  }

  const norm = (s) => s.trim().replace(/\s+/g, " ");
  const decls = (b) => {
    const out = [];
    let start = b.from;
    const push = (raw) => {
      const c = raw.indexOf(":");
      if (c > 0 && raw.trim()) out.push({ prop: norm(raw.slice(0, c)), val: norm(raw.slice(c + 1)) });
    };
    for (let k = b.from; k < b.to; k++) if (mask[k] === ";") { push(mask.slice(start, k)); start = k + 1; }
    push(mask.slice(start, b.to));
    return out;
  };

  const after = [];
  for (const b of blocks)
    for (const d of decls(b))
      for (const s of b.sel.split(",").map(norm).filter(Boolean))
        after.push({ sel: s, prop: d.prop, val: d.val, at: b.at });

  const dead = [];
  for (const b of blocks) {
    if (b.sel.includes(",")) continue;
    const s = norm(b.sel);
    for (const d of decls(b)) {
      const over = after.find(x => x.at > b.at && x.sel === s && x.prop === d.prop);
      if (!over) continue;
      if (d.val.includes("!important") || over.val.includes("!important")) continue;
      if (d.val === over.val) continue;
      dead.push(`${s} { ${d.prop}: ${d.val} } — ниже переустановлено в «${over.val}»`);
    }
  }

  ok(dead.length === 0, `мёртвых объявлений в стилях: ${dead.length}`,
     "\n      " + dead.slice(0, 8).join("\n      "));

  /* Черта итога — не декорация, а опознавательный знак сервиса:
     так подводят итог в ведомости. Проверяем, что она осталась
     чертой, а не превратилась обратно в градиентную пилюлю. */
  const lineRule = orig.match(/\.section-title \.line \{[^}]*\}/g) || [];
  const base = lineRule[0] || "";
  ok(/border-top:/.test(base) && !/background:\s*var\(--grad/.test(base),
     "черта под заголовком раздела — черта, а не градиентная пилюля", base.slice(0, 90));
}


/* Срок ответа вынимается из разбора верно.

   На эту дату ставится напоминание, а пропуск срока по требованию
   ФНС — это блокировка счёта. Ошибка в разборе строки означает либо
   молчание там, где надо предупредить, либо напоминание на дату,
   которой не было в ответе. */
console.log("\n— Срок ответа из разбора —");
{
  const src = read("../tools.html");
  const body = src.match(/function replyDeadline\(text\) \{[\s\S]*?\n\}/)[0];
  const replyDeadline = new Function("return " + body)();

  const future = new Date(Date.now() + 30 * 86400000);
  const f = `${String(future.getDate()).padStart(2, "0")}.${
    String(future.getMonth() + 1).padStart(2, "0")}.${future.getFullYear()}`;
  const fIso = future.toISOString().slice(0, 10);

  ok(replyDeadline(`2. СРОКИ.\nОтветить до: ${f}\nЗакон даёт 10 дней.`) === fIso,
     "дата из строки «Ответить до» разобрана", replyDeadline(`Ответить до: ${f}`));

  ok(replyDeadline(`ответить до: ${f.replace(/\./g, "/")}`) === fIso,
     "разделители через косую черту тоже понимаются");

  /* Однозначный день и месяц без нуля — обычное дело в тексте. */
  const short = `1.3.${future.getFullYear() + 1}`;
  ok(replyDeadline("Ответить до: " + short) === `${future.getFullYear() + 1}-03-01`,
     "день и месяц без ведущего нуля дополняются", replyDeadline("Ответить до: " + short));

  /* Прошедший срок — не повод ставить напоминание: он уже пропущен,
     и напоминать не о чем. Кнопки в таком случае просто нет. */
  ok(replyDeadline("Ответить до: 01.01.2020") === null, "прошедшая дата отбрасывается");

  ok(replyDeadline("Срок ответа — десять рабочих дней.") === null,
     "без явной строки со сроком ничего не выдумываем");
  ok(replyDeadline("") === null, "пустой разбор не роняет");
  ok(replyDeadline(null) === null, "отсутствующий разбор не роняет");

  /* Системная подсказка обязана просить эту строку — иначе разбирать
     будет нечего, и кнопка не появится никогда. */
  ok(/Ответить до: ДД\.ММ\.ГГГГ/.test(src),
     "подсказка модели требует выводить срок отдельной строкой");
}

console.log(`\nИТОГО: ${pass} пройдено, ${fail} провалено\n`);
process.exit(fail ? 1 : 0);
