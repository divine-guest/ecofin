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

const tplCount = Object.keys(load("../js/templates.js", ["TEMPLATES"]).TEMPLATES).length;
ok(heroNum("шаблон") === tplCount,
   `шаблонов: на главной ${heroNum("шаблон")}, в templates.js ${tplCount}`);

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

console.log(`\nИТОГО: ${pass} пройдено, ${fail} провалено\n`);
process.exit(fail ? 1 : 0);
