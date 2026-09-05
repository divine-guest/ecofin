/* Содержание не разошлось со ставками и не устарело молча.

   Самый опасный вид поломки в справочном сервисе — не сбой, а тихое
   устаревание. Ставки меняются каждый год. Числа вынесены в rates.js
   и меняются в одном месте, но внутри 49 статей они написаны словами:
   «фиксированные взносы 57 390 ₽», «лимит УСН 450 млн». Поменяв
   константу, про статьи забывают.

   Сайт при этом продолжает работать и выглядеть исправным. Человек
   получает неверную цифру, считает по ней налог и узнаёт об ошибке от
   налоговой. Ни один обычный тест такого не ловит: с точки зрения кода
   всё в порядке.

   Поэтому проверяем не поведение, а согласованность: числа в текстах
   обязаны совпадать с теми, что считает калькулятор.                */
import fs from "node:fs";

const read = p => fs.readFileSync(new URL(p, import.meta.url), "utf8");

let pass = 0, fail = 0;
const ok = (c, label, got = "") => {
  c ? (pass++, console.log("  ✓", label)) : (fail++, console.log("  ✗", label, "→", String(got).slice(0, 200)));
};

/* --- Загружаем ставки и статьи --- */
const box = {};
new Function("box", read("../js/rates.js").replace(/^const RATES/m, "box.RATES = globalThis.RATES") + "\nbox.RATES = RATES;")(box);
const R = box.RATES;

const abox = {};
new Function("box", read("../js/knowledge.js") + "\nbox.A = ARTICLES;")(abox);
const ARTICLES = abox.A;

const allText = ARTICLES.map(a => JSON.stringify(a)).join("\n");

/* Форматируем как в текстах: 57 390 с неразрывным или обычным пробелом. */
const ru = n => n.toLocaleString("ru-RU").replace(/ /g, " ");

console.log("\n— Ставки в текстах совпадают с расчётными —");
{
  /* Взносы ИП. Число называется в статьях прямо и меняется ежегодно —
     это первый кандидат разойтись с калькулятором. */
  const fixed = R.ipContributions.fixed;
  const shown = ru(fixed);
  const wrongYears = [53658, 49500, 45842].filter(v => v !== fixed);
  const stale = wrongYears.filter(v => allText.includes(ru(v)));
  ok(stale.length === 0,
     `в статьях нет прошлогодних взносов ИП (текущие ${shown} ₽)`,
     stale.map(ru).join(", "));

  /* Лимит НПД. */
  const npdMln = R.npd.limit / 1e6;
  const npdText = String(npdMln).replace(".", ",");
  ok(!/(?<!\d)(2,4|2\.4)\s*млн/.test(allText) || allText.includes(npdText + " млн"),
     `лимит самозанятости в текстах — ${npdText} млн`);

  /* Порог НДС на УСН и предел применения УСН. */
  const vatMln = R.usn.vatThreshold / 1e6;
  const limMln = R.usn.limit / 1e6;
  ok(allText.includes(vatMln + " млн"), `порог НДС на УСН (${vatMln} млн) встречается в статьях`);
  ok(allText.includes(limMln + " млн"), `предел УСН (${limMln} млн) встречается в статьях`);

  /* Ставки в процентах. */
  ok(allText.includes(Math.round(R.usn.incomeRate * 100) + "%"), "ставка УСН «Доходы» упоминается");
  ok(allText.includes(Math.round(R.npd.rateCompanies * 100) + "%"), "ставка НПД с юрлиц упоминается");
}

console.log("\n— Материалы не отстают от календаря —");
{
  const nowYear = new Date().getFullYear();

  /* Дата сверки. Ставки сверяют раз в год; если отметке больше полутора
     лет, значит их не пересматривали — и цифры уже могли смениться. */
  const checked = new Date(R.checkedOn);
  const months = (Date.now() - checked.getTime()) / (1000 * 60 * 60 * 24 * 30.4);
  ok(months < 18,
     `ставки сверялись не позже полутора лет назад (${R.checkedOn}, прошло ${Math.round(months)} мес.)`,
     R.checkedOn);

  /* Год в rates.js не должен отставать от календарного больше чем на
     год: в январе он естественно отстаёт, в декабре — уже нет. */
  ok(nowYear - R.year <= 1,
     `год ставок (${R.year}) не отстаёт от календарного (${nowYear})`,
     R.year);

  /* Обещание на витрине не должно называть прошедшие годы: «сверено
     с законодательством на 2025–2026» через два года читается как
     «мы забросили сайт». */
  const faq = read("../faq.html");
  const promised = [...faq.matchAll(/на (\d{4})[–-](\d{4}) год/g)].map(m => Number(m[2]));
  ok(promised.every(y => y >= nowYear),
     "обещание актуальности в вопросах не называет прошедший год",
     promised.join(", "));
}

console.log("\n— Ссылки на нормы выглядят живыми —");
{
  /* Не проверяем содержание норм — только что ссылка оформлена так,
     что её можно проверить: без номера статьи «по закону» в тексте
     ничего не стоит. */
  const withLaw = ARTICLES.filter(a => /ст\.\s*\d+|статья\s*\d+|№\s*\d+-ФЗ/i.test(JSON.stringify(a)));
  ok(withLaw.length >= ARTICLES.length * 0.6,
     `на нормы ссылается большинство статей (${withLaw.length} из ${ARTICLES.length})`,
     withLaw.length);
}

console.log(`\nИТОГО: ${pass} пройдено, ${fail} провалено`);
process.exit(fail ? 1 : 0);
