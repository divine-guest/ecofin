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

console.log(`\nИТОГО: ${pass} пройдено, ${fail} провалено\n`);
process.exit(fail ? 1 : 0);
