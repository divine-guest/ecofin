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

  /* Дату строим целиком в UTC. Смешивать getDate() с toISOString()
     нельзя: первое возвращает местный день, второе — день по UTC, и
     при разнице часовых поясов они расходятся. Проверка ломалась не
     от изменений в коде, а просто оттого, что наступил новый день. */
  const future = new Date(Date.now() + 30 * 86400000);
  const fIso = future.toISOString().slice(0, 10);
  const [fy, fm, fd] = fIso.split("-");
  const f = `${fd}.${fm}.${fy}`;

  ok(replyDeadline(`2. СРОКИ.\nОтветить до: ${f}\nЗакон даёт 10 дней.`) === fIso,
     "дата из строки «Ответить до» разобрана", replyDeadline(`Ответить до: ${f}`));

  ok(replyDeadline(`ответить до: ${f.replace(/\./g, "/")}`) === fIso,
     "разделители через косую черту тоже понимаются");

  /* Однозначный день и месяц без нуля — обычное дело в тексте. */
  const nextYear = Number(fy) + 1;
  const short = `1.3.${nextYear}`;
  ok(replyDeadline("Ответить до: " + short) === `${nextYear}-03-01`,
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

/* Партнёрский блок не рисуется в пустоту.

   На странице калькуляторов вызов PARTNERS.render стоял, а контейнера
   не было: блок не появился бы ни разу даже после подключения
   партнёрки — и заметить это нельзя, потому что «нет рекламы» и
   «реклама не подключена» выглядят одинаково.

   А калькуляторы — как раз та страница, ради поискового трафика
   которой партнёрка и задумана: единственный доход, который не
   требует ни подписчиков, ни чьего-то времени. */
console.log("\n— Партнёрскому блоку есть куда встать —");
{
  const root = new URL("../", import.meta.url);
  const broken = [];
  for (const f of fs.readdirSync(root).filter(x => x.endsWith(".html"))) {
    const html = fs.readFileSync(new URL(f, root), "utf8");
    for (const m of html.matchAll(/PARTNERS\.render\(\s*"([^"]+)"/g)) {
      if (!html.includes(`id="${m[1]}"`)) broken.push(`${f}: нет контейнера ${m[1]}`);
    }
  }
  ok(broken.length === 0, "у каждого вызова есть свой контейнер", broken.join("; "));

  /* Маркировка — не украшение: показ рекламы без токена erid стоит
     до 500 000 ₽ по ст. 14.3 КоАП. Проверяем, что решение о показе
     не принимается по одному лишь наличию ссылки. */
  const js = read("../js/partners.js");
  ok(/l\.url && l\.advertiser && l\.erid/.test(js),
     "показ требует всех трёх полей, а не только ссылки");
  ok(/rel="nofollow sponsored noopener"/.test(js),
     "партнёрская ссылка помечена для поисковиков");
  ok(/partner-mark[\s\S]{0,200}erid/.test(js),
     "в карточке выводится пометка «Реклама» с токеном");

  /* И то же самое на сервере: в браузере правило обходится правкой
     в консоли, поэтому решать должен он. */
  const srv = read("../worker/src/partners.js");
  ok(/enabled = 1 AND url != '' AND advertiser != '' AND erid != ''/.test(srv),
     "сервер отдаёт только полностью заполненные и включённые");
  ok(/КоАП/.test(srv), "отказ включить неполное объясняет причину");
}

/* Наборы документов ссылаются на существующие бумаги.

   Набор — это список названий, и переименование любого шаблона рвёт
   его молча: кнопка в наборе остаётся, а по нажатию ничего не
   открывается. Заметить это можно только пройдя все наборы руками.

   То же с напоминаниями: набор обещает поставить сроки в календарь,
   и эти сроки должны существовать в налоговом календаре. */
console.log("\n— Наборы документов не рассыпались —");
{
  const box = {};
  new Function("box", read("../js/templates.js") + "\nbox.T = TEMPLATES; box.K = DOC_KITS;")(box);

  ok(box.K.length >= 5, `наборов: ${box.K.length}`, box.K.length);

  const ids = new Set();
  const dup = box.K.filter(k => (ids.has(k.id) ? true : (ids.add(k.id), false)));
  ok(dup.length === 0, "нет двух наборов с одинаковым id", dup.map(k => k.id));

  const missing = [];
  for (const k of box.K)
    for (const [title] of k.steps)
      if (!box.T[title]) missing.push(`${k.id}: «${title}»`);
  ok(missing.length === 0, "каждый шаг ведёт к существующему шаблону", missing);

  const thin = box.K.filter(k => k.steps.length < 3);
  ok(thin.length === 0, "в наборе хотя бы три документа — иначе это не набор", thin.map(k => k.id));

  /* Пояснение к шагу — и есть весь смысл набора: без него это просто
     список названий, который человек и так видит в библиотеке. */
  const noWhy = [];
  for (const k of box.K)
    for (const [title, why] of k.steps)
      if (!why || why.length < 40) noWhy.push(`${k.id}: «${title}»`);
  ok(noWhy.length === 0, "у каждого шага объяснено, зачем он и почему здесь", noWhy);

  const noWhen = box.K.filter(k => !k.when);
  ok(noWhen.length === 0, "у каждого набора сказано, когда за него браться", noWhen.map(k => k.id));

  /* Сроки набора должны существовать в налоговом календаре. */
  const rem = read("../worker/src/reminders.js");
  const knownIds = [...rem.matchAll(/\{ id: "([^"]+)"/g)].map(m => m[1]);
  const ghosts = [];
  for (const k of box.K)
    for (const r of k.reminders || [])
      if (!knownIds.includes(r)) ghosts.push(`${k.id} → ${r}`);
  ok(ghosts.length === 0, "обещанные сроки есть в налоговом календаре", ghosts);
}

console.log("\n— За границу не уходит лишнего —");
{
  /* Структурная проверка каналов.

     Изображения уходят к модели только одним способом — через
     image_url в теле запроса. Такой вызов допустим ровно в одном
     файле, vision.js, где он стоит запасным путём на время, пока не
     выдан ключ российского распознавания. Появление его где-то ещё
     означает, что фотография документа снова уезжает за границу — а
     политика обещает обратное, и это обещание пойдёт в уведомление
     Роскомнадзору. */
  const dir = new URL("../worker/src/", import.meta.url);
  const withImages = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".js") || f === "vision.js") continue;
    if (fs.readFileSync(new URL(f, dir), "utf8").includes("image_url")) withImages.push(f);
  }
  ok(withImages.length === 0,
     "изображения отправляет только vision.js", withImages);

  /* Текст к модели обязан проходить обезличивание. Вызовов провайдера
     немного, и каждый должен быть рядом с redact — иначе появился
     новый путь мимо защиты. Ровно так и было с фоновой очередью:
     через неё идут все ИИ-инструменты, и первая версия обезличивания
     её не покрывала. */
  const callers = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".js") || f === "vision.js" || f === "ai.js") continue;
    const src = fs.readFileSync(new URL(f, dir), "utf8");
    if (src.includes("callProvider(") && !src.includes("redact")) callers.push(f);
  }
  ok(callers.length === 0, "каждый вызов модели проходит обезличивание", callers);

  /* В самом ai.js — то же самое, но там есть и определение
     callProvider, поэтому проверяем по обработчикам. */
  const ai = read("../worker/src/ai.js");
  ok(/redact\(prompt\)/.test(ai), "вопрос консультанту обезличивается");
  ok(/redact\(full\)/.test(ai), "разбор документа обезличивается");
  ok(/restore\(/.test(ai), "ответ восстанавливается перед выдачей");

  /* Ключ российского распознавания не должен быть зашит в код. */
  const vision = read("../worker/src/vision.js");
  ok(/env\.YC_OCR_KEY/.test(vision) && !/Api-Key [A-Za-z0-9]{10}/.test(vision),
     "ключ распознавания берётся из окружения, а не из кода");
  ok(/ocr\.api\.cloud\.yandex\.net/.test(vision), "распознавание идёт на российский адрес");
}

console.log("\n— Распознавание: порядок путей —");
{
  /* Порядок решает, покидает ли фотография страну. Первые два пути
     внутри России, третий — нет, и он должен быть последним и только
     при отсутствии первых двух.

     Проверяем по коду, а не запуском: на машине разработчика ни
     ключа, ни tesseract обычно нет, и живой прогон всегда шёл бы
     третьим путём — то есть ничего не проверял бы. */
  const v = read("../worker/src/vision.js");
  const body = v.slice(v.indexOf("export async function recognize(env"));

  const posYandex = body.indexOf("ocrReady(env)");
  const posLocal = body.indexOf("localOcrReady()");

  ok(posYandex > -1 && posLocal > -1, "оба пути распознавания на месте");
  ok(posYandex < posLocal, "облачный российский — раньше локального");

  /* Третий путь есть снова, но ведёт он в Китай — государство из
     перечня, то же, что у текстовой модели и в уведомлении. Сутки
     назад его не было вовсе: он вёл в США, которых в перечне нет.

     Здесь проверяется только порядок и то, что путь под замком.
     Содержательно за списком моделей следит tests/redact.mjs. */
  const posAbroad = body.indexOf("visionModel(env)");
  ok(posAbroad > -1, "зрячая модель подключается через проверку списка");
  ok(posLocal < posAbroad, "и только после локального распознавания");

  /* Локальный результат принимается по порогу, а не по «непусто»:
     горсть мусорных символов с блика хуже, чем ничего, — по ней
     разбор выдаст уверенный ответ про документ, которого не читали. */
  ok(/text\.trim\(\)\.length >= MIN_LOCAL_CHARS/.test(body),
     "локальный путь отдаёт результат по порогу качества");

  /* Русские языковые данные проверяются отдельно: команда tesseract
     существует и без них, а результат тогда — латиница с мусором. */
  ok(/\^rus\$/m.test(v), "проверяется наличие русского языка, а не только команды");

  /* Установка на сервере. Пакет с русским языком отдельный, и в общем
     цикле его не поймать: цикл смотрит на имя команды, а команда одна
     на оба пакета. */
  const setup = read("../worker/node/server-setup/setup.sh");
  ok(/tesseract-ocr\b/.test(setup), "tesseract ставится при настройке сервера");
  ok(/tesseract-ocr-rus/.test(setup), "русские языковые данные тоже");
  ok(/--list-langs/.test(setup), "наличие русского проверяется отдельной командой");
}

console.log("\n— Персональные данные не попадают в журнал —");
{
  /* Журнал живёт дольше запроса, читается проще базы и в описи мер
     защиты обычно не значится. Разглашением это станет в тот день,
     когда логи понадобится кому-то передать: в поддержку хостинга,
     подрядчику, при разборе инцидента.

     Проверяем не догадками, а по коду: что именно уходит в
     console.error рядом с ответами внешних сервисов. */
  const dir = new URL("../worker/src/", import.meta.url);
  const bad = [];

  /* Что нельзя писать в журнал ни при каких обстоятельствах. */
  const forbidden = [
    { re: /console\.(error|log|warn)\([^)]*user\.email/, why: "почта пользователя" },
    { re: /console\.(error|log|warn)\([^)]*\bprompt\b/, why: "текст обращения" },
    { re: /console\.(error|log|warn)\([^)]*pass_hash/, why: "хэш пароля" },
    { re: /console\.(error|log|warn)\([^)]*\btoken\b/, why: "токен сессии" },
  ];

  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".js")) continue;
    const src = fs.readFileSync(new URL(f, dir), "utf8");
    for (const line of src.split("\n")) {
      /* Комментарии не считаем: в них эти слова как раз объясняют,
         почему писать нельзя. */
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
      for (const { re, why } of forbidden) {
        if (re.test(line)) bad.push(`${f}: ${why} — ${line.trim().slice(0, 70)}`);
      }
    }
  }
  ok(bad.length === 0, "почта, обращения, хэши и токены в журнал не пишутся", bad);

  /* Ответы внешних сервисов содержат данные людей: сервис ФНС
     возвращает ИНН и фамилию проверяемого, платёжный — реквизиты
     плательщика. Тело ответа в журнал не идёт. */
  const reg = read("../worker/src/registry.js");
  ok(!/console\.error\([^)]*text\.slice/.test(reg),
     "ответ сервиса ФНС не пишется в журнал целиком");
  ok(!/console\.error\([^)]*JSON\.stringify\(d\)/.test(reg),
     "и не пишется разобранным");

  const bill = read("../worker/src/billing.js");
  ok(!/console\.error\("yookassa"[^)]*JSON\.stringify\(data\)/.test(bill),
     "ответ платёжного сервиса не пишется в журнал целиком");
}

console.log("\n— Безопасность: то, что проверяется по коду —");
{
  const dir = new URL("../worker/src/", import.meta.url);
  const files = fs.readdirSync(dir).filter(f => f.endsWith(".js"));

  /* 1. Подстановка в SQL.

     Все запросы обязаны идти через prepare(...).bind(...). Шаблонная
     строка с ${} внутри prepare — прямой путь к инъекции: значение
     приходит из браузера. */
  const injections = [];
  for (const f of files) {
    const src = fs.readFileSync(new URL(f, dir), "utf8");
    src.split("\n").forEach((l, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(l)) return;
      if (/prepare\(\s*`[^`]*\$\{/.test(l)) injections.push(`${f}:${i + 1}`);
    });
  }
  ok(injections.length === 0, "нет подстановок значений прямо в SQL", injections);

  /* 2. Изоляция данных между людьми.

     Любой запрос к таблице с личными данными обязан фильтровать по
     владельцу. Забытое условие означает, что человек видит чужие
     документы или чужой учёт — это уже утечка, а не ошибка. */
  const TABLES = ["documents", "book_ops", "reminders", "counterparties", "my_orgs",
                  "saved_calcs", "ai_jobs", "progress", "clients", "point_ops",
                  "notifications", "sessions", "doc_numbers2"];
  const unscoped = [];
  for (const f of files) {
    /* Запрос часто собран из нескольких строковых кусков через «+».
       Без склейки разбор обрывается на первой закрывающей кавычке, и
       условие по владельцу, стоящее во второй строке, не видно —
       проверка ругается на исправный код. */
    const src = fs.readFileSync(new URL(f, dir), "utf8")
      .replace(/"\s*\+\s*\n?\s*"/g, " ");
    /* Пометка уровня файла: модуль целиком объясняет, почему условия
       по владельцу в нём нет нигде. Так сделано в очереди задач —
       повторять одно объяснение над семью строками значит сделать его
       незаметным. */
    if (/scope-ok \(весь файл\)/.test(src.slice(0, 2000))) continue;

    for (const m of src.matchAll(/(SELECT|UPDATE|DELETE)[\s\S]{0,400}?(?=`|"|;)/gi)) {
      const q = m[0].replace(/\s+/g, " ");
      /* Отсекаем куски кода, случайно начавшиеся со слова SELECT или
         UPDATE: настоящий запрос содержит FROM, SET или INTO в самом
         начале. Без этого проверка ругалась на обычный объект, в
         котором рядом оказалось слово из SQL. */
      if (!/^(SELECT[\s\S]{0,120}?FROM|UPDATE\s+\w+\s+SET|DELETE\s+FROM|INSERT\s+INTO)/i.test(q)) continue;
      if (!TABLES.some(t => new RegExp(`\\b${t}\\b`).test(q))) continue;
      if (/WHERE/i.test(q) && /(email|owner)\s*=/i.test(q)) continue;
      if (/reminder_id IN \(SELECT/i.test(q)) continue;
      /* Запрос без условия по владельцу допустим, но должен быть
         помечен: «scope-ok:» и причина в комментарии рядом. Без
         пометки — падаем. Так решение принимается один раз и явно,
         а не подразумевается тем, кто писал код полгода назад. */
      if (/scope-ok:/.test(src.slice(Math.max(0, m.index - 420), m.index))) continue;
      unscoped.push(`${f}: ${q.slice(0, 60)}`);
    }
  }
  ok(unscoped.length === 0,
     "каждый запрос к личным данным ограничен владельцем или помечен как проверенный",
     unscoped);

  /* 3. Вебхуки — единственные ручки мимо проверки источника, входа и
     ограничения частоты. Значит защита у них должна быть своя, и
     безусловная. */
  const tg = read("../worker/src/telegram.js");
  ok(/if \(!env\.TELEGRAM_WEBHOOK_SECRET\)/.test(tg),
     "вебхук мессенджера отклоняется, если секрет не задан");
  const bill = read("../worker/src/billing.js");
  ok(/ykFetch\(env, `\/payments\//.test(bill),
     "платёжный вебхук перепроверяет платёж у платёжного сервиса, а не верит телу запроса");

  /* 4. Доступ по ролям — в одном месте, а не в каждом обработчике. */
  const idx = read("../worker/src/index.js");
  ok(/access === "admin" && user\.role !== "admin" && user\.role !== "owner"/.test(idx),
     "права администратора проверяются централизованно");
  ok(/access === "owner" && user\.role !== "owner"/.test(idx),
     "права владельца проверяются централизованно");
  ok(/if \(!user\) return fail\(env, origin, "Требуется вход", 401\)/.test(idx),
     "без входа закрытые ручки не работают");

  /* Каждый маршрут обязан объявить уровень доступа. Забытый уровень —
     это ручка, открытая всем. */
  const routes = [...idx.matchAll(/\["(GET|POST|PUT|DELETE)",\s*"([^"]+)",\s*[\w.]+,\s*"(\w+)"\]/g)];
  const levels = new Set(routes.map(r => r[3]));
  ok([...levels].every(l => ["public", "user", "admin", "owner", "webhook"].includes(l)),
     "все уровни доступа известны", [...levels]);

  /* Ручки админки не должны оказаться публичными по недосмотру. */
  const adminPublic = routes.filter(r => r[2].startsWith("/api/admin/") && r[3] === "public");
  ok(adminPublic.length === 0, "ни одна ручка админки не открыта всем", adminPublic.map(r => r[2]));

  /* 5. Ограничение частоты на том, что подбирают. */
  ok(/"\/api\/auth\/login": "login"/.test(idx), "вход под ограничением частоты");
  ok(/"\/api\/auth\/register": "register"/.test(idx), "регистрация под ограничением");
  ok(/"\/api\/auth\/owner-recover": "recover"/.test(idx),
     "аварийный ключ владельца под самым жёстким ограничением");

  /* 6. Пароли и токены. */
  /* Хэширование живёт в lib.js, а не в auth.js: там общие
     примитивы. Проверка искала не в том файле и падала на исправном
     коде — а хуже ложной тревоги только привычка её игнорировать. */
  const lib = read("../worker/src/lib.js");
  const auth = read("../worker/src/auth.js");
  ok(/PBKDF2/i.test(lib), "пароль хранится в виде необратимого преобразования");
  ok(/PBKDF2_ITER:\s*100000/.test(lib), "итераций не меньше ста тысяч");
  ok(/sha256\(bearer\(request\)\)|sha256\(token\)/.test(auth),
     "в базе лежит хэш токена сессии, а не сам токен");

  /* 7. Резервные копии. В копии — вся база; открытая копия рядом с
     рабочей означает, что один доступ к диску отдаёт и историю. */
  const bak = read("../worker/node/server-setup/backup.sh");
  ok(/openssl enc -aes-256-cbc/.test(bak), "резервные копии шифруются");
  ok(/chmod 600/.test(bak), "права на копии ограничены");
  ok(/ЧЕСТНО ПРО ПРЕДЕЛ ЗАЩИТЫ/.test(bak),
     "предел защиты описан рядом с кодом, а не подразумевается");
}

console.log("\n— Страница не ходит на чужие адреса —");
{
  /* Что здесь на кону.

     Любой внешний ресурс на странице — шрифт, счётчик, картинка —
     заставляет браузер посетителя обратиться к чужому серверу и
     передать туда свой IP-адрес, версию браузера и адрес открытой
     страницы. IP относится к персональным данным, значит это
     передача: у всех подряд, до входа, без согласия и без
     упоминания в политике.

     Так и было со шрифтами Google на каждой странице. Заметить это
     нельзя, глядя на сайт: он работает, выглядит правильно, и
     обращение уходит молча.

     Разрешены только ссылки, по которым человек переходит сам
     (реестры ФНС, ЦБ, суды) — они срабатывают по клику, а не при
     открытии страницы. */
  const root = new URL("../", import.meta.url);

  /* Что грузится автоматически: стили, скрипты, шрифты, картинки,
     предзагрузка и предварительные соединения. */
  const AUTO = /<(?:link|script|img|iframe|source|video|audio)\b[^>]*?(?:href|src)\s*=\s*["'](https?:\/\/[^"']+)["']/gi;

  const outside = [];
  const check = (file, html) => {
    for (const m of html.matchAll(AUTO)) {
      const url = m[1];
      if (/^https?:\/\/(ecofin26\.ru|www\.ecofin26\.ru)/i.test(url)) continue;
      outside.push(`${file}: ${url.slice(0, 70)}`);
    }
    /* Предварительное соединение тоже обращается наружу, хотя ничего
       не грузит: DNS и TLS уже раскрывают, куда идёт человек. */
    for (const m of html.matchAll(/rel=["']?(?:preconnect|dns-prefetch)["']?[^>]*href=["'](https?:\/\/[^"']+)/gi)) {
      outside.push(`${file}: preconnect ${m[1].slice(0, 60)}`);
    }
  };

  for (const f of fs.readdirSync(root).filter(x => x.endsWith(".html"))) {
    check(f, fs.readFileSync(new URL(f, root), "utf8"));
  }
  const st = new URL("st/", root);
  if (fs.existsSync(st)) {
    for (const f of fs.readdirSync(st).filter(x => x.endsWith(".html")).slice(0, 5)) {
      check("st/" + f, fs.readFileSync(new URL(f, st), "utf8"));
    }
  }

  ok(outside.length === 0,
     "ни одна страница не грузит ресурсы с чужих серверов", outside.slice(0, 6));

  /* Шрифты должны лежать у нас и подключаться своим файлом. */
  const idx = read("../index.html");
  ok(/href="css\/fonts\.css/.test(idx), "шрифты подключаются своим файлом");
  ok(!/fonts\.(googleapis|gstatic)\.com/.test(idx), "обращений к Google на главной нет");

  const fontsCss = read("../css/fonts.css");
  ok(/url\(\.\.\/fonts\//.test(fontsCss), "файлы шрифтов лежат в репозитории");
  ok(!/url\(https?:/.test(fontsCss), "в описании шрифтов нет внешних адресов");

  /* Генератор статей собирает страницы сам — если Google вернётся
     туда, он тихо разойдётся по полусотне статей при первой сборке. */
  const gen = read("../build-seo.mjs");
  ok(!/fonts\.(googleapis|gstatic)\.com/.test(gen),
     "генератор статей не возвращает шрифты Google");
}

console.log("\n— Согласие и редакция политики —");
{
  /* Вместе с согласием сервер сохраняет редакцию политики: через год
     будет видно не «согласился вообще», а под каким именно текстом.
     Смысл в этом есть, только пока дата в коде и дата в политике —
     одна и та же. Разойтись они могут молча: политику правят руками,
     а константу забывают.

     Ещё здесь проверяется сама галочка: она обязательна в форме и
     ведёт на политику, а не просто стоит рядом с текстом. */

  const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня",
                  "июля", "августа", "сентября", "октября", "ноября", "декабря"];

  const lib = read("../worker/src/lib.js");
  const mv = lib.match(/POLICY_VERSION:\s*"(\d{4})-(\d{2})-(\d{2})"/);
  ok(!!mv, "в настройках задана редакция политики", mv && mv[0]);

  const legal = read("../legal.html");
  const md = legal.match(/Дата обновления политики:<\/b>\s*(\d{1,2})\s+([а-яё]+)\s+(\d{4})/i);
  ok(!!md, "в политике указана дата обновления", md && md[0]);

  if (mv && md) {
    const fromLegal = [md[3], String(MONTHS.indexOf(md[2].toLowerCase()) + 1).padStart(2, "0"),
                       md[1].padStart(2, "0")].join("-");
    ok(fromLegal === `${mv[1]}-${mv[2]}-${mv[3]}`,
       "редакция политики в коде совпадает с датой в самой политике",
       [fromLegal, mv[0]]);
  }

  const auth = read("../auth.html");
  ok(/id="regConsent"[^>]*required/.test(auth),
     "галочка согласия обязательна в форме регистрации");
  ok(/regConsent[\s\S]{0,400}legal\.html#privacy/.test(auth),
     "рядом с галочкой стоит ссылка на политику");

  /* Форма обязана передавать отметку серверу: иначе она снова
     останется украшением, а доказывать согласие будет нечем. */
  ok(/consent\s*=\s*document\.getElementById\("regConsent"\)\.checked/.test(auth),
     "форма читает галочку в переменную");
  ok(/register\([\s\S]{0,200}consent\s*\n?\s*\)/.test(auth) || /consent\s*\n\s*\);/.test(auth),
     "и передаёт её в регистрацию");

  const api = read("../js/api.js");
  ok(/register\(name,\s*email,\s*password,\s*ref,\s*consent\)/.test(api),
     "клиент шлёт согласие вместе с регистрацией");
  ok(/body:\s*{[^}]*consent[^}]*}/.test(api),
     "отметка попадает в тело запроса");

  const authSrc = read("../worker/src/auth.js");
  ok(/b\.consent\s*!==\s*true/.test(authSrc),
     "сервер отказывает, если отметки нет — а не верит браузеру");
  ok(/consent_at/.test(authSrc) && /consent_doc/.test(authSrc),
     "момент согласия и редакция политики сохраняются в базе");

  const mig = read("../worker/migrate-consent.sql");
  ok(/ALTER TABLE users ADD COLUMN consent_at/.test(mig) &&
     /ALTER TABLE users ADD COLUMN consent_doc/.test(mig),
     "под это есть миграция базы");
}

console.log("\n— Выключатели передачи за границу —");
{
  /* Смысл выключателя в том, что мимо него нельзя пройти. Если завтра
     появится второй вызов модели в обход callProvider, запрет тихо
     перестанет действовать — и никто этого не заметит, потому что
     сервис будет работать. Поэтому проверяется не наличие флага, а
     то, что дверь наружу по-прежнему одна.

     Второе, что здесь стережётся: выключенным по умолчанию всё это
     быть не должно. Флаг, случайно оставленный в положении «выкл»,
     тише всего убивает платную функцию. */

  const lib = read("../worker/src/lib.js");
  ok(/export const abroadPaused = env =>/.test(lib), "выключатель модели объявлен");
  ok(/export const telegramPaused = env =>/.test(lib), "выключатель мессенджера объявлен");
  ok(/AI_ABROAD_OFF \|\| ""\) === "1"/.test(lib) && /TELEGRAM_OFF \|\| ""\) === "1"/.test(lib),
     "выключено только при явном «1» — иначе работает");

  const ai = read("../worker/src/ai.js");

  /* Единственная дверь наружу к модели. */
  const doors = (ai.match(/fetch\(/g) || []).length;
  ok(doors === 1, `в модуле модели один вызов наружу, а не ${doors}`);
  ok(/async function callProviderOnce[\s\S]{0,400}abroadPaused\(env\)/.test(ai),
     "запрет стоит внутри callProvider — до обращения к поставщику");

  /* Ответ должен объяснять, а не сообщать о поломке: «провайдер
     недоступен» на намеренной остановке — неправда. */
  ok(/e\.message === "paused"/.test(ai) && /PAUSED_AI/.test(ai),
     "остановка отвечает объяснением, а не ошибкой поставщика");
  /* Раньше здесь требовалось слово «Роскомнадзор» в тексте для
     пользователя. Требование было неверным: человек пришёл посчитать
     налог, а не читать про наши отношения с надзором. Причина
     остановки должна быть понятна нам — она в комментарии рядом
     с самим текстом.

     Взамен стережём то, что важно человеку: текст обещает возврат,
     а не сообщает о поломке, и не называет работающую платную
     функцию «в разработке» — она работает и продана в составе
     «Про», а недоделанной её объявить значит дать неверные
     сведения об услуге (ст. 10 ЗоЗПП). */
  ok(/PAUSED_AI[\s\S]{0,240}вернём в ближайшие дни/.test(lib),
     "текст обещает возврат, а не сообщает о поломке");
  ok(!/PAUSED_AI[\s\S]{0,300}в разработке/.test(lib),
     "и не называет работающую платную функцию недоделанной");

  /* Распознавание внутри страны за границу ничего не отправляет, и
     останавливаться вместе с моделью не должно. */
  ok(/abroadPaused\(env\) && !ocrReady\(env\) && !\(await localOcrReady\(\)\)/.test(ai),
     "распознавание внутри страны продолжает работать на паузе");

  const tg = read("../worker/src/telegram.js");
  const tgDoors = (tg.match(/fetch\(/g) || []).length;
  ok(tgDoors === 1, `у мессенджера один вызов наружу, а не ${tgDoors}`);
  ok(/async function call\(env, method, payload\) {[\s\S]{0,300}!working\(env\)/.test(tg),
     "остановка перекрывает и ответы бота, и рассылку напоминаний");
  ok(/export async function webhook[\s\S]{0,1800}telegramPaused\(env\)/.test(tg),
     "на паузе не разбираются и входящие сообщения");
  ok(/paused: telegramPaused\(env\) \? PAUSED_TG : null/.test(tg),
     "страница узнаёт причину, а не просто «недоступно»");

  const dash = read("../dashboard.html");
  ok(/tg\.paused/.test(dash), "кабинет показывает причину паузы, а не прячет блок");

  /* Значения по умолчанию: включено. */
  const pub = read("../worker/node/env-public.txt");
  /* Проверяем, что оба выключателя описаны в файле настроек — чтобы
     тот, кто откроет его через полгода, понял, что они вообще есть.
     Само включённое состояние проверяется ниже, отдельно: раньше
     здесь стояло требование «ничего не выключено», и оно сломалось
     в первый же день, когда выключить понадобилось по делу. */
  ok(/^#\s*AI_ABROAD_OFF=1/m.test(pub) && /^#\s*TELEGRAM_OFF=1/m.test(pub),
     "в настройках оба выключателя описаны");
  /* Включённый выключатель — это нормально, но только осознанно.
     Флаг, забытый в положении «выкл», тихо убивает платную функцию,
     и найдётся он через месяц по жалобе. Поэтому требуем не «всё
     включено», а «выключенное объяснено»: над активной строкой должно
     стоять человеческое объяснение с датой. */
  for (const name of ["AI_ABROAD_OFF", "TELEGRAM_OFF"]) {
    const active = new RegExp("^" + name + "=1", "m").test(pub);
    if (!active) continue;
    const before = pub.slice(0, pub.search(new RegExp("^" + name + "=1", "m")));
    const tail = before.slice(-900);
    /* Требуем не конкретных слов, а двух вещей по существу: когда
       выключили и как вернуть. Первая версия проверки цеплялась к
       формулировке «выключен с датой» и упала, как только соседний
       выключатель описали словом «остановлена». Проверка, которая
       требует синонима, а не смысла, ловит только себя. */
    ok(/\d{2}\.\d{2}\.\d{4}/.test(tail),
       `${name}: рядом стоит дата, когда выключили`, tail.slice(-140));
    ok(/обратно|снять|закомментировать|вернуть|включить/i.test(tail),
       `${name}: написано, как вернуть обратно`);
  }

  const idx = read("../worker/src/index.js");
  ok(/abroadPaused: abroadPaused\(env\)/.test(idx) && /telegramPaused: telegramPaused\(env\)/.test(idx),
     "состояние видно снаружи одним запросом к health");
}

console.log("\n— Модель видит выверенные ставки —");
{
  /* Что здесь на кону.

     В подсказке консультанта стояло правило «твои знания могут
     отставать, добавляй приписку проверить актуальность». Правило
     честное и бесполезное: модель всё равно называет число, человек
     всё равно его записывает, а приписка снизу не отменяет цифру
     сверху.

     Проверено на живых вопросах 09.09.2026: лимит УСН модель назвала
     277,4 млн вместо 450 млн, ключевую ставку — 16% вместо 14%, и по
     ней же посчитала компенсацию за задержку зарплаты. Оба ответа со
     ссылками на статьи и с вежливым советом свериться.

     Теперь выверенные значения едут в подсказке. Но выжимка — копия,
     а копия отстаёт молча: поправят ставку в js/rates.js, забудут
     пересобрать, и консультант месяцами будет уверенно называть
     прошлогоднее число. Поэтому проверка собирает выжимку заново и
     сравнивает посимвольно. */

  const { buildDigest } = await import("../scripts/make-rates-digest.mjs");

  const ratesSrc = read("../js/rates.js");
  const fresh = buildDigest(ratesSrc);
  const stored = (await import("../worker/src/rates-digest.js")).RATES_DIGEST;

  ok(stored === fresh,
     "выжимка ставок собрана из нынешнего js/rates.js",
     stored === fresh ? "" : "выполните: node scripts/make-rates-digest.mjs");

  /* Выжимка должна содержать то, на чём уже спотыкались. */
  const R = load("../js/rates.js", ["RATES"]).RATES;
  ok(fresh.includes(String(R.keyRate.percent) + "%"), "в выжимке есть ключевая ставка", R.keyRate.percent);
  ok(fresh.includes(R.checkedOn), "и дата сверки", R.checkedOn);
  /* Лимит индексируется дефлятором, поэтому конкретное число здесь
     не проверяем — проверяем, что оно вообще названо и совпадает
     с файлом ставок. Раньше стояло «450 млн» жёстко, и проверка
     упала ровно тогда, когда лимит проиндексировали, — то есть
     стерегла собственную формулировку, а не смысл. */
  ok(fresh.includes(`лимит дохода ${R.usn.limit / 1e6} млн`),
     "и лимит УСН совпадает с файлом ставок", R.usn.limit);
  ok(fresh.includes(`с выручки ${R.usn.vatThreshold / 1e6} млн`),
     "и порог НДС на УСН тоже", R.usn.vatThreshold);
  /* toLocaleString ставит между разрядами неразрывный пробел, а не
     обычный. Искать «57 390» с обычным — верный способ получить
     ложную тревогу; она и случилась при первом же прогоне. */
  ok(/57\s390/.test(fresh), "и фиксированные взносы ИП");
  ok(!/∞/.test(fresh), "верхняя ступень НДФЛ записана числом, а не знаком бесконечности");

  /* Подсказка должна её действительно нести, а не просто иметь рядом. */
  const ai = read("../worker/src/ai.js");

  /* Нижняя граница лимита ответа. Выглядит как мелочь, а без неё
     думающая модель молчит: deepseek-v4-flash при max_tokens=150
     тратит 151 токен на рассуждение и возвращает пустоту. Формально
     успех, фактически ничего — и ломаются ровно те места, где мы
     экономили на длине ответа. Убрать «лишнее ограничение» легко,
     поэтому пусть падает. */
  /* Одна повторная попытка при пустом ответе. Примерно один запрос
     из полусотни возвращается пустым или пятисоткой — тот же запрос
     через секунду отрабатывает. Без повтора человек видит «ИИ вернул
     пустой ответ» и уходит, а лимит у него уже списан.

     Повтор ровно один: два складываются в минуту ожидания. И он не
     повторяет то, что повторять бессмысленно, — отклонённый ключ,
     модель вне списка, остановленную передачу. */
  ok(/async function withRetry/.test(ai), "у обращения к модели есть повторная попытка");
  ok(/const hopeless =[\s\S]{0,200}"paused"[\s\S]{0,200}"unlisted"/.test(ai),
     "и она не повторяет то, что заведомо не пройдёт");

  ok(/const MIN_TOKENS = \d+;/.test(ai), "у ответа есть нижняя граница длины");
  ok(/max_tokens: Math\.max\(maxTokens \|\| 0, MIN_TOKENS\)/.test(ai),
     "и она применяется в единственном вызове наружу");

  ok(/import \{ RATES_DIGEST \} from "\.\/rates-digest\.js"/.test(ai),
     "консультант импортирует выжимку");
  ok(/\$\{RATES_DIGEST\}/.test(ai), "и подставляет её в системную подсказку");

  /* Старое правило должно уйти: «проверьте актуальность» рядом с
     выдуманным числом — это не осторожность, а алиби. */
  ok(!/твои знания могут отставать от изменений законодательства/.test(ai),
     "правило про «знания могут отставать» заменено на справку");
  ok(/ЧИСЛА БЕРИ ИЗ СПРАВКИ НИЖЕ/.test(ai),
     "модели прямо сказано брать числа из справки, а не из памяти");

  /* Файл собран автоматически — предупреждение должно быть в нём,
     иначе однажды его поправят руками и потеряют при пересборке. */
  const dig = read("../worker/src/rates-digest.js");
  ok(/СОБРАНО АВТОМАТИЧЕСКИ/.test(dig), "в выжимке написано, что её не правят руками");
  ok(/make-rates-digest/.test(dig), "и сказано, чем пересобрать");
}

console.log("\n— Шаблоны документов —");
{
  /* Шаблон уходит человеку в руки как готовый документ. Ошибка здесь
     дороже, чем в статье: статью прочитают и забудут, а шаблон
     распечатают, подпишут и приложат к делу.

     Два свойства, которые нельзя ломать. */

  const { TEMPLATES } = load("../js/templates.js", ["TEMPLATES"]);
  const names = Object.keys(TEMPLATES);
  ok(names.length >= 50, `шаблонов: ${names.length}`);

  /* ПЕРВОЕ: поля и подстановки должны совпадать.

     Поле без подстановки — человек заполняет то, что никуда не
     попадёт. Подстановка без поля — в документе остаётся
     «{{address}}» вместо адреса, и это уходит контрагенту. */
  const broken = [];
  for (const [name, t] of Object.entries(TEMPLATES)) {
    const holes = [...new Set([...(t.body || "").matchAll(/\{\{(\w+)\}\}/g)].map(m => m[1]))];
    const fields = (t.fields || []).map(f => f[0]);
    const noField = holes.filter(h => !fields.includes(h));
    const noHole = fields.filter(f => !holes.includes(f));
    if (noField.length || noHole.length) broken.push(`${name}: ${noField.join()} / ${noHole.join()}`);
  }
  ok(broken.length === 0, "во всех шаблонах поля и подстановки совпадают", broken.slice(0, 3));

  /* ВТОРОЕ: согласие на обработку данных — по составу закона.

     Часть 4 статьи 9 152-ФЗ перечисляет, что обязано быть в согласии.
     В нашем шаблоне не хватало адреса субъекта, реквизитов документа,
     удостоверяющего личность, и сведений о том, кому поручается
     обработка. Согласие без них дефектно: доказать им получение
     согласия нельзя.

     Это ровно та беда, которую сервис весь день чинил у себя — только
     тут её собирал бы каждый, кто взял наш шаблон. */
  const consent = TEMPLATES["Согласие на обработку персональных данных"];
  ok(!!consent, "шаблон согласия на месте");
  const cf = (consent.fields || []).map(f => f[0]);
  for (const need of ["person", "address", "passport", "operator", "purpose", "list", "processor"]) {
    ok(cf.includes(need), `в согласии есть поле «${need}»`, cf.join());
  }
  ok(/часть 4 статьи 9|части 4 статьи 9/i.test(consent.body),
     "в согласии названа норма, задающая его состав");
  ok(/ОТДЕЛЬНЫМ документом/.test(consent.body),
     "и сказано, что согласие не подшивается в договор");
}

console.log("\n— Отдельные страницы калькуляторов —");
{
  /* У каждого калькулятора из calc-pages.mjs должна быть собранная
     страница: со своей панелью и полем результата, своим адресом, в карте
     сайта и со ссылкой с общей страницы. Иначе страница есть в плане, но
     её не видит ни человек, ни поисковик. */
  const { CALC_PAGES } = await import("../calc-pages.mjs");
  const calcJs = read("../js/calc.js");
  const hub = read("../calc.html");
  const sitemap = read("../sitemap.xml");
  const outs = Object.fromEntries(
    [...calcJs.matchAll(/^\s+(\w+):\s*\{\s*out:\s*"(\w+)"/gm)].map(m => [m[1], m[2]]));

  ok(CALC_PAGES.length >= 6, `страниц калькуляторов: ${CALC_PAGES.length}`);
  for (const p of CALC_PAGES) {
    const file = new URL(`../calc/${p.slug}.html`, import.meta.url);
    const built = fs.existsSync(file);
    ok(built, `calc/${p.slug}.html собрана`);
    if (!built) continue;
    const html = fs.readFileSync(file, "utf8");
    ok(Boolean(outs[p.kind]) && html.includes(`id="${p.panel}"`) && html.includes(`id="${outs[p.kind]}"`),
       `${p.slug}: на странице панель ${p.panel} и поле результата ${outs[p.kind]}`);
    ok(html.includes(`<link rel="canonical" href="https://ecofin26.ru/calc/${p.slug}.html">`),
       `${p.slug}: свой канонический адрес`);
    ok(/src="\.\.\/js\/rates\.js\?v=\d+"/.test(html) && /src="\.\.\/js\/calc\.js\?v=\d+"/.test(html),
       `${p.slug}: подключены rates.js и calc.js`);
    /* Шаблон с опечаткой в имени ставки молча печатает «undefined»
       прямо в тексте для человека. */
    ok(!/undefined|NaN|\[object /.test(html), `${p.slug}: в тексте нет undefined и NaN`);
    ok(sitemap.includes(`https://ecofin26.ru/calc/${p.slug}.html`), `${p.slug}: есть в карте сайта`);
    ok(hub.includes(`href="calc/${p.slug}.html"`), `${p.slug}: общая страница ведёт на неё`);
  }

  /* Код калькуляторов обслуживает и общую страницу, и отдельные. Вызов
     расчёта без отступа выполняется сразу при загрузке и на странице,
     где его панели нет, роняет весь скрипт. */
  const bare = calcJs.split("\n")
    .filter(l => /^(calc\w+|render\w+|initTaxCal|KEYRATE\.init)\s*\(|^document\.getElementById/.test(l));
  ok(bare.length === 0, "в js/calc.js нет безусловных расчётов при загрузке", bare.slice(0, 3));
  ok(!/function calcTax\s*\(/.test(hub), "код калькуляторов не встроен в calc.html");
}

console.log("\n— Витрины по аудитории —");
{
  /* Сайт рос разделами по виду инструмента, а человек приходит со своей
     ролью. Витрины собираются из разметки audience.mjs, и главное здесь —
     чтобы разметку нельзя было забыть: материал без метки не попадёт ни
     на одну витрину и потеряется молча. */
  const { AUDIENCES, ARTICLE_AUDIENCE, CALC_AUDIENCE } = await import("../audience.mjs");
  const hub = read("../calc.html");
  const sitemap = read("../sitemap.xml");
  const panels = [...hub.matchAll(/data-panel="(\w+)"/g)].map(m => m[1]);

  const noMark = ARTICLES.filter(a => !ARTICLE_AUDIENCE[a.title]).map(a => a.title);
  ok(noMark.length === 0, "у каждой статьи указана аудитория", noMark.slice(0, 3).join("; "));
  const extra = Object.keys(ARTICLE_AUDIENCE).filter(t => !ARTICLES.some(a => a.title === t));
  ok(extra.length === 0, "в разметке нет статей, которых больше нет", extra.join("; "));

  const noCalc = panels.filter(p => !CALC_AUDIENCE[p]);
  ok(noCalc.length === 0, "у каждого калькулятора указана аудитория", noCalc.join("; "));

  const values = [...Object.values(ARTICLE_AUDIENCE), ...Object.values(CALC_AUDIENCE)];
  ok(values.every(v => ["biz", "person", "both"].includes(v)), "метки только из трёх допустимых");

  for (const who of Object.keys(AUDIENCES)) {
    const a = AUDIENCES[who];
    const page = read(`../${a.slug}.html`);
    ok(page.includes(`<link rel="canonical" href="https://ecofin26.ru/${a.slug}.html">`),
       `${a.slug}: свой канонический адрес`);
    ok((page.match(/<a /g) || []).length > 20, `${a.slug}: витрина не пустая`);
    ok(!/undefined|NaN/.test(page), `${a.slug}: в тексте нет undefined`);
    ok(sitemap.includes(`https://ecofin26.ru/${a.slug}.html`), `${a.slug}: есть в карте сайта`);
    ok(read("../index.html").includes(`${a.slug}.html`), `${a.slug}: на главной есть вход по роли`);
  }

  /* Ссылки calc.html#tab=6 из раздела «Что делать» годами вели в никуда:
     обработчика якоря не было. */
  ok(/#tab=/.test(read("../js/calc.js")), "страница калькуляторов открывает вкладку из адреса");
}

console.log("\n— Восстановление доступа —");
{
  /* Страница выросла из вопроса владельца: на других сервисах висит
     уведомление «вход через Google и Apple ID недоступен». У нас такого
     входа не было, поэтому копировать слово в слово нечего — но сказать,
     как войти и что делать, если не получается, нужно во всех местах,
     где человек об это спотыкается. */
  const rec = read("../recovery.html");
  const auth = read("../auth.html");
  const faq = read("../faq.html");
  const app = read("../js/app.js");

  ok(/href="recovery\.html"/.test(auth), "со страницы входа есть ссылка на восстановление");
  ok(/Google/.test(auth) && /Apple/.test(auth), "на странице входа сказано про Google и Apple ID");
  ok(/recovery\.html/.test(faq), "в вопросах и ответах есть ссылка на восстановление");
  ok(/recovery\.html#email/.test(app), "в кабинете смена почты ведёт на инструкцию");
  ok(read("../about.html").includes("recovery.html"), "раздел «Связаться» ведёт на инструкцию");
  ok(read("../sitemap.xml").includes("https://ecofin26.ru/recovery.html"), "страница есть в карте сайта");

  /* Контакты — из одного места: переписанные руками однажды устареют
     ровно там, куда человек приходит за помощью. */
  ok(/id="contactCard"/.test(rec) && /contacts\.js/.test(rec),
     "контакты на странице берутся из js/contacts.js");

  /* Почты на своём домене ещё нет, сброс делает администратор вручную.
     Обещать письмо со ссылкой — значит обещать то, чего сервис не умеет. */
  ok(!/ссылк[ауи] для сброса|письмо со сбросом|сброс пароля по почте/i.test(rec),
     "страница не обещает сброс пароля письмом");
  ok(/никогда не просим/i.test(rec), "есть предупреждение о том, чего мы никогда не спрашиваем");

  /* Сброс по коду написан, но работает только с настроенной почтой.
     Поэтому на странице он описан условно, а форма на входе показывается
     лишь после ответа сервера, что письма он слать умеет. */
  ok(/Если на странице входа есть ссылка/.test(rec),
     "сброс по коду описан условно — он зависит от того, настроена ли почта");
  ok(/id="resetForm"/.test(auth) && /id="resetLink" style="display:none"/.test(auth),
     "форма сброса на странице входа скрыта, пока сервер не подтвердит почту");
}

console.log(`\nИТОГО: ${pass} пройдено, ${fail} провалено\n`);
process.exit(fail ? 1 : 0);
