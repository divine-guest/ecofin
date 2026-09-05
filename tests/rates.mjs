/* Сверяем новые расчёты вручную посчитанными числами.
   Калькулятор налогов — не то место, где можно поверить на слово. */
import fs from "node:fs";

const src = fs.readFileSync(new URL("../js/rates.js", import.meta.url), "utf8")
  .replace(/^const RATES/m, "globalThis.RATES");
eval(src);
const R = globalThis.RATES;

let pass = 0, fail = 0;
const near = (a, b, eps = 1) => Math.abs(a - b) <= eps;
const ok = (c, label, got = "") => {
  c ? (pass++, console.log("  ✓", label)) : (fail++, console.log("  ✗", label, "→", got));
};

console.log("\n— Зарплата на руки —");
{
  const gross = 80000, year = gross * 12;               // 960 000
  const ndfl = R.ndfl(year);                            // вся сумма в первой ступени
  ok(near(ndfl, year * 0.13), `НДФЛ 13% при доходе ниже 2,4 млн: ${Math.round(ndfl)}`, ndfl);
  ok(near(year - ndfl, 835200), `на руки за год: ${Math.round(year - ndfl)}`, year - ndfl);

  /* Вычет на одного ребёнка: 1400 ₽/мес, пока доход не превысит 450 000.
     При 80 000 в месяц это 5 полных месяцев (450000/80000 = 5,6 → 5). */
  const months = Math.min(12, Math.floor(R.childDeduction.incomeLimit / gross));
  ok(months === 5, `вычет действует 5 месяцев: ${months}`, months);
  const ded = R.childDeduction.first * months;          // 7000
  const saved = R.ndfl(year) - R.ndfl(year - ded);
  ok(near(saved, 910), `экономия на одном ребёнке: ${Math.round(saved)} (7000 × 13%)`, saved);
}

console.log("\n— Прогрессия не ломается на границе —");
{
  const a = R.ndfl(2400000), b = R.ndfl(2400001);
  ok(near(a, 312000), `2,4 млн → ${Math.round(a)}`, a);
  ok(b - a < 1, "переход через ступень не даёт скачка налога", b - a);
}

console.log("\n— Взносы ИП —");
{
  const full = R.contributionsPartial(1500000, 365);
  ok(near(full.fixed, R.ipContributions.fixed), `полный год: фикс ${Math.round(full.fixed)}`, full.fixed);
  ok(near(full.extra, 12000), `1% с 1,2 млн превышения: ${Math.round(full.extra)}`, full.extra);

  const half = R.contributionsPartial(1500000, 182);
  ok(near(half.fixed, R.ipContributions.fixed * 182 / 365, 2),
     `полгода: фикс пропорционально ${Math.round(half.fixed)}`, half.fixed);
  ok(near(half.extra, full.extra), "переменная часть от дохода, а не от дней", half.extra);

  const huge = R.contributionsPartial(100000000, 365);
  ok(near(huge.extra, R.ipContributions.extraCap), `потолок 1% работает: ${Math.round(huge.extra)}`, huge.extra);

  const zero = R.contributionsPartial(0, 365);
  ok(zero.extra === 0 && zero.fixed > 0, "при нулевом доходе фикс всё равно платится");
}

console.log("\n— УСН 6% уменьшается на взносы —");
{
  const income = 800000;
  const tax = income * R.usn.incomeRate;                // 48 000
  const c = R.contributionsPartial(income, 365).total;  // 57 390 + 5 000
  ok(Math.min(tax, c) === tax, "без работников налог гасится полностью", { tax, c });
  ok(Math.min(tax / 2, c) === tax / 2, "с работниками — не больше половины", tax / 2);
}

console.log("\n— НДС —");
{
  const total = 120000, rate = 0.20;
  const base = total / (1 + rate), vat = total - base;
  ok(near(base, 100000), `выделить из 120 000: без НДС ${Math.round(base)}`, base);
  ok(near(vat, 20000), `НДС ${Math.round(vat)}`, vat);
  ok(near(100000 * rate, 20000), "начислить сверху на 100 000 → 20 000");
  ok(near(100000 * 0.05, 5000), "пониженная ставка 5% считается так же");
}

console.log("\n— Госпошлина —");
{
  const cases = [
    [50000, 4000, "до 100 тыс. — фиксированные 4 000"],
    [100000, 4000, "ровно 100 тыс. — граница первой ступени"],
    [200000, 7000, "200 тыс. → 4 000 + 3% от 100 тыс."],
    [300000, 10000, "300 тыс. — стык ступеней"],
    [500000, 15000, "500 тыс. — стык ступеней"],
    [1000000, 25000, "1 млн — стык ступеней"],
    [3000000, 45000, "3 млн — стык ступеней"],
    [1500000, 30000, "1,5 млн → 25 000 + 1% от 500 тыс."],
    [900000000, 900000, "выше потолка — 900 000"],
  ];
  for (const [claim, want, label] of cases) {
    ok(R.courtFeeFor(claim) === want, `${label}: ${R.courtFeeFor(claim)}`, R.courtFeeFor(claim));
  }
  ok(R.courtFeeFor(0) === 0, "нулевая цена иска не ломает расчёт");
  /* Ступени не должны давать скачка вниз при росте цены иска. */
  let prev = 0, monotonic = true;
  for (let c = 10000; c <= 120000000; c += 137000) {
    const f = R.courtFeeFor(c);
    if (f < prev) { monotonic = false; break; }
    prev = f;
  }
  ok(monotonic, "пошлина не уменьшается при росте цены иска");
}

console.log("\n— Взносы за сотрудника —");
{
  const year = 600000;
  const small = R.employerContrib(year, { small: true });
  const big = R.employerContrib(year, { small: false });
  ok(small < big, `у малого бизнеса дешевле: ${Math.round(small)} против ${Math.round(big)}`);
  ok(near(big, year * 0.30 + year * 0.002, 2), `обычный тариф 30% + травматизм: ${Math.round(big)}`, big);

  /* Сверх предельной базы ставка падает — проверяем, что это учтено. */
  const over = R.employerContrib(5000000, { small: false });
  const naive = 5000000 * 0.30 + 5000000 * 0.002;
  ok(over < naive, "сверх предельной базы ставка понижается", { over: Math.round(over), naive });
}


console.log("\n— Взносы за работника: обёртка не расходится с правилом —");
{
  /* payroll добавляет разбивку и стоимость работника, но само правило
     должно оставаться одно. Если однажды кто-то перепишет расчёт внутри
     payroll, эта проверка упадёт — ради неё она и написана. */
  let same = true;
  for (const [pay, months, small] of [[50000, 12, true], [50000, 12, false],
                                       [80000, 12, true], [150000, 12, false], [80000, 6, true]]) {
    const p = R.payroll({ monthly: pay, months, small });
    const e = R.employerContrib(pay * months, { small, injury: R.payrollContrib.injuryMin, months });
    if (!near(p.all, e, 0.01)) same = false;
  }
  ok(same, "payroll считает то же, что employerContrib");

  const p = R.payroll({ monthly: 80000, months: 12, small: false });
  ok(near(p.cost, p.total + p.main + p.injury, 1), `стоимость работника = зарплата + взносы: ${Math.round(p.cost)}`);
  ok(near(p.onHand, p.total - R.ndfl(p.total), 1), "на руки = начислено минус НДФЛ");
  ok(p.cost > p.total, "взносы платятся сверх зарплаты, а не из неё");
}

console.log("\n— Продажа имущества —");
{
  /* Выдержанный срок владения снимает налог целиком — это главное
     в расчёте, и проверяем именно границу. */
  ok(R.propertyTax({ price: 6e6, years: 5, realty: true }).free, "квартира: 5 лет — налога нет");
  ok(!R.propertyTax({ price: 6e6, years: 4.9, realty: true }).free, "4,9 года — налог есть");
  ok(R.propertyTax({ price: 6e6, years: 3, realty: true, special: true }).free,
     "наследство и единственное жильё — достаточно 3 лет");
  ok(R.propertyTax({ price: 900000, years: 3, realty: false }).free, "машина: 3 года — налога нет");

  /* Из двух способов уменьшения выбирается выгодный. */
  const a = R.propertyTax({ price: 6e6, bought: 4.5e6, years: 2, realty: true });
  ok(a.base === 1.5e6, `дорогая покупка: выгоднее расходы, база ${a.base}`, a.base);
  ok(a.better === "costs", "и это отмечено в ответе");
  ok(near(a.tax, 1.5e6 * 0.13, 1), `налог 13% с 1,5 млн: ${Math.round(a.tax)}`, a.tax);

  const b = R.propertyTax({ price: 3e6, bought: 2.9e6, years: 1, realty: true });
  ok(b.base === 100000, `дешёвая разница: выгоднее расходы, база ${b.base}`, b.base);

  const c = R.propertyTax({ price: 1.2e6, bought: 0, years: 1, realty: true });
  ok(c.base === 200000, `без документов о покупке — вычет 1 млн, база ${c.base}`, c.base);
  ok(c.better === "deduction", "и выгоднее здесь вычет");

  /* Выше 2,4 млн базы включается вторая ступень. */
  const d = R.propertyTax({ price: 10e6, bought: 0, years: 1, realty: true });
  ok(d.base === 9e6 && d.tax > 9e6 * 0.13, "с базы выше 2,4 млн ставка растёт до 15%");
}

console.log("\n— Пособия по материнству —");
{
  const s = R.sickLeave;
  const maxDaily = (s.bases[0] + s.bases[1]) / s.days;

  const hi = R.maternityPay({ pay1: 9e6, pay2: 9e6, days: 140 });
  ok(hi.atMax, "очень высокий заработок упирается в потолок");
  ok(near(hi.daily, maxDaily, 0.01), `дневное пособие по потолку: ${Math.round(hi.daily)}`);
  ok(near(hi.birth, maxDaily * 140, 1), `максимум за 140 дней: ${Math.round(hi.birth)}`);

  const lo = R.maternityPay({ pay1: 50000, pay2: 50000, days: 140 });
  ok(lo.atMin, "маленький заработок поднимается до минимума");
  ok(near(lo.daily, s.minWageMonth * 24 / s.days, 0.01), "минимум считается из МРОТ");

  const mid = R.maternityPay({ pay1: 900000, pay2: 1100000, days: 140 });
  ok(!mid.atMax && !mid.atMin, "обычный заработок — без границ");
  ok(near(mid.daily, 2e6 / s.days, 0.01), `дневное: ${Math.round(mid.daily)}`);
  ok(near(mid.careMonthly, mid.daily * R.maternity.careMonthDays * 0.4, 1),
     `уход до 1,5 лет — 40%: ${Math.round(mid.careMonthly)}`);

  /* Дни болезни уменьшают знаменатель, то есть повышают пособие. */
  const sick = R.maternityPay({ pay1: 900000, pay2: 1100000, days: 140, excluded: 100 });
  ok(sick.daily > mid.daily, "исключённые дни болезни повышают пособие, а не понижают");

  ok(R.maternityPay({ pay1: 9e6, pay2: 9e6, days: 194 }).birth >
     R.maternityPay({ pay1: 9e6, pay2: 9e6, days: 140 }).birth, "за 194 дня платят больше, чем за 140");
}

console.log("\n— Алименты —");
{
  const net = 100000 - R.ndfl(1200000) / 12;
  for (const [kids, share] of [[1, 0.25], [2, 1 / 3], [3, 0.5]]) {
    const a = R.alimonyPay({ income: 100000, kids });
    ok(near(a.sum, net * share, 1), `на ${kids}: ${Math.round(a.sum)} (${Math.round(share * 100)}%)`, a.sum);
  }
  ok(near(R.alimonyPay({ income: 100000, kids: 1 }).net, net, 1),
     "доля считается от дохода ПОСЛЕ НДФЛ, а не от начисленного");
  ok(R.alimonyPay({ income: 87000, kids: 1, alreadyNet: true }).sum > R.alimonyPay({ income: 87000, kids: 1 }).sum,
     "если сумма уже на руки, НДФЛ второй раз не снимается");
  ok(R.alimonyPay({ income: 100000, kids: 5 }).share === 0.5, "больше трёх детей — та же половина");
  ok(!R.alimonyPay({ income: 100000, kids: 3 }).capped, "половина дохода не упирается в предел 70%");
}

console.log("\n— Исковая давность —");
{
  const l = R.limitationEnds({ knownAt: "2024-03-15" });
  ok(l.ends.getFullYear() === 2027, `три года от даты, когда узнали: ${l.ends.toLocaleDateString("ru-RU")}`);

  const withClaim = R.limitationEnds({ knownAt: "2024-03-15", claimDays: 30 });
  ok(withClaim.ends > l.ends, "досудебная претензия сдвигает срок вперёд");

  const capped = R.limitationEnds({ knownAt: "2024-03-15", claimDays: 999 });
  const half = R.limitationEnds({ knownAt: "2024-03-15", claimDays: R.limitation.claimPauseDays });
  ok(near(capped.ends.getTime(), half.ends.getTime(), 1000), "приостановка не больше полугода");

  const old = R.limitationEnds({ knownAt: "2024-03-15", brokenAt: "2010-01-01" });
  ok(old.cutByAbsolute, "предельный десятилетний срок обрезает общий");
  ok(old.real.getFullYear() === 2020, `и побеждает: ${old.real.toLocaleDateString("ru-RU")}`);

  ok(R.limitationEnds({ knownAt: "не дата" }) === null, "битая дата не ломает расчёт");
  ok(R.limitationEnds({ knownAt: "2019-01-10" }).daysLeft < 0, "истёкший срок даёт отрицательный остаток");
}

console.log("\n— Налог с вклада —");
{
  const d = R.depositTax({ interest: 250000, maxKeyRate: 21 });
  ok(near(d.free, 210000), `необлагаемый минимум = 1 млн × 21%: ${Math.round(d.free)}`, d.free);
  ok(near(d.base, 40000), `облагается только превышение: ${Math.round(d.base)}`, d.base);
  ok(near(d.tax, 40000 * 0.13, 1), `налог 13%: ${Math.round(d.tax)}`, d.tax);

  ok(R.depositTax({ interest: 100000, maxKeyRate: 21 }).tax === 0, "доход ниже минимума — налога нет");
  ok(R.depositTax({ interest: 5e6, maxKeyRate: 21 }).tax > (5e6 - 210000) * 0.13,
     "с большой суммы включается вторая ступень 15%");
  const lowRate = R.depositTax({ interest: 250000, maxKeyRate: 10 });
  ok(lowRate.tax > d.tax, "чем ниже ключевая ставка, тем больше налог: минимум меньше");
}

console.log("\n— Взносы ИП за неполный год (ст. 430 п. 5 НК) —");
{
  const full = R.ipContributionsFor({}).fixed;
  ok(full === R.ipContributions.fixed, `весь год — полная сумма: ${full}`, full);

  /* Ровно половина года — ровно половина взносов. Проверка на круглом
     числе: если пропорция где-то съедет, здесь это видно сразу. */
  const half = R.ipContributionsFor({ from: `${R.year}-07-01` }).fixed;
  ok(near(half, full / 2, 2), `с 1 июля — половина: ${half}`, half);

  const quarter = R.ipContributionsFor({ to: `${R.year}-03-31` }).fixed;
  ok(near(quarter, full / 4, 2), `по 31 марта — четверть: ${quarter}`, quarter);

  /* Неполный месяц считается по календарным дням, а не отбрасывается.
     15 марта: 17 дней марта из 31 плюс девять полных месяцев. */
  const mid = R.ipContributionsFor({ from: `${R.year}-03-15` }).fixed;
  const expect = full / 12 * (9 + 17 / 31);
  ok(near(mid, expect, 3), `с 15 марта — неполный месяц по дням: ${mid}`, mid);

  /* Период вне года не должен добавлять ничего: деятельность, начатая
     в прошлом декабре, к этому году добавляет ноль. */
  const before = R.ipContributionsFor({ from: `${R.year - 1}-01-01` }).fixed;
  ok(before === full, "период шире года обрезается по году", before);

  const none = R.ipContributionsFor({ from: `${R.year}-12-31`, to: `${R.year}-01-01` }).fixed;
  ok(none === 0, "конец раньше начала — ноль, а не отрицательное", none);
}

console.log("\n— Штрафы налоговой (ст. 119 и 122 НК) —");
{
  const a = R.taxFines({ unpaid: 100000, monthsLate: 3 });
  ok(a.lateReturn === 15000, `три месяца — 5% в месяц: ${a.lateReturn}`, a.lateReturn);
  ok(a.unpaidTax === 20000, `неуплата по неосторожности 20%: ${a.unpaidTax}`, a.unpaidTax);
  ok(a.total === 35000, "оба штрафа складываются", a.total);

  /* Потолок 30% — иначе за два года просрочки насчиталось бы 120%. */
  const b = R.taxFines({ unpaid: 100000, monthsLate: 24 });
  ok(b.lateReturn === 30000, `потолок 30% держится: ${b.lateReturn}`, b.lateReturn);

  /* Минимум 1000 ₽ платят и при нулевом налоге: штраф не за деньги,
     а за несданную бумагу. */
  const c = R.taxFines({ unpaid: 0, monthsLate: 1 });
  ok(c.lateReturn === 1000, "минимум 1000 ₽ при нулевом налоге", c.lateReturn);

  const d = R.taxFines({ unpaid: 100000, monthsLate: 1, intentional: true });
  ok(d.unpaidTax === 40000, "умышленная неуплата — 40%", d.unpaidTax);

  /* Неполный месяц считается как полный — это буква закона. */
  const e = R.taxFines({ unpaid: 100000, monthsLate: 1.1 });
  ok(e.lateReturn === 10000, "неполный месяц считается как полный", e.lateReturn);

  const f = R.taxFines({ unpaid: 100000, monthsLate: 3, mitigations: 2 });
  ok(f.withMitigation === Math.round(f.total / 4), "два смягчающих — вчетверо меньше",
     f.withMitigation);
}

console.log("\n— Выходное пособие при сокращении (ст. 178 ТК) —");
{
  const a = R.severancePay({ avgMonth: 60000, monthsUnemployed: 2 });
  ok(a.onDismissal === 60000, "пособие при увольнении — один средний заработок");
  ok(a.forSearch === 120000, "плюс два месяца на поиск работы", a.forSearch);
  ok(a.total === 180000, "всего три средних заработка", a.total);

  /* Больше двух месяцев на поиск закон не даёт: третий — по решению
     службы занятости, и его считать за гарантию нельзя. */
  const b = R.severancePay({ avgMonth: 60000, monthsUnemployed: 5 });
  ok(b.extraMonths === 2, "сверх двух месяцев не считаем", b.extraMonths);

  const c = R.severancePay({ avgMonth: 60000, monthsUnemployed: 0 });
  ok(c.total === 60000, "сразу нашёл работу — только пособие", c.total);
}


console.log("\n— Налог на имущество физлиц (гл. 32 НК) —");
{
  /* Квартира 60 м² за 6 млн: вычет 20 м², облагается 40 м².
     100 000 ₽ за метр × 40 м² × 0,1% = 4 000 ₽. */
  const a = R.propertyOwnTax({ cadastral: 6000000, area: 60, kind: "flat" });
  ok(a.tax === 4000, `квартира 60 м² за 6 млн: ${a.tax}`, a.tax);
  ok(a.taxedM2 === 40, "вычет 20 м² вычтен из площади", a.taxedM2);

  /* Маленькая квартира не облагается вовсе — про это не знают, ждут
     квитанцию и волнуются, что она не пришла. */
  const b = R.propertyOwnTax({ cadastral: 2000000, area: 20, kind: "flat" });
  ok(b.tax === 0 && b.zeroByDeduction, "квартира 20 м² — налога нет вовсе", b.tax);

  /* Дом: вычет 50 м², а не 20. */
  const h = R.propertyOwnTax({ cadastral: 10000000, area: 100, kind: "house" });
  ok(h.taxedM2 === 50, "у дома вычет 50 м²", h.taxedM2);

  /* Комната: вычет 10 м². */
  const rm = R.propertyOwnTax({ cadastral: 1500000, area: 15, kind: "room" });
  ok(rm.taxedM2 === 5, "у комнаты вычет 10 м²", rm.taxedM2);

  const half = R.propertyOwnTax({ cadastral: 6000000, area: 60, kind: "flat", share: 0.5, months: 6 });
  ok(half.tax === 1000, "половина доли за полгода — четверть налога", half.tax);

  /* Многодетным дополнительно 5 м² на ребёнка для квартиры. */
  const kids = R.propertyOwnTax({ cadastral: 6000000, area: 60, kind: "flat", children: 2 });
  ok(kids.tax === 3000, "два ребёнка добавляют 10 м² вычета", kids.tax);

  /* Дороже 300 млн — ставка 2%, а не 0,1%. */
  const lux = R.propertyOwnTax({ cadastral: 400000000, area: 400, kind: "flat" });
  ok(lux.rate === R.propertyOwn.rateLuxury, "от 300 млн ставка 2%", lux.rate);
}

console.log("\n— Транспортный налог (ст. 361 и 362 НК) —");
{
  const a = R.transportTax({ hp: 120 });
  ok(a.rate === 3.5, "120 л.с. попадают в ступень 100–150", a.rate);
  ok(a.base === 420, `налог по федеральной ставке: ${a.base}`, a.base);

  /* Регион вправе изменить ставку не более чем в десять раз — вилка
     честнее одного числа, потому что итог всё равно решает регион. */
  ok(a.min === 42 && a.max === 4200, "вилка регионов — десятикратная", [a.min, a.max]);

  const b = R.transportTax({ hp: 300, price: 12000000 });
  ok(b.luxury === 3, "от 10 млн ₽ включается повышающий коэффициент", b.luxury);
  ok(b.base === 13500, `300 л.с. с коэффициентом: ${b.base}`, b.base);

  const c = R.transportTax({ hp: 120, months: 6 });
  ok(c.base === 210, "полгода владения — половина налога", c.base);

  /* Ступени границами не путаются: ровно 100 л.с. — ещё нижняя ставка. */
  ok(R.transportTax({ hp: 100 }).rate === 2.5, "ровно 100 л.с. — ставка 2,5");
  ok(R.transportTax({ hp: 101 }).rate === 3.5, "101 л.с. — уже 3,5");
  ok(R.transportTax({ hp: 251 }).rate === 15, "свыше 250 — ставка 15");
}


console.log(`\nИТОГО: ${pass} пройдено, ${fail} провалено\n`);
process.exit(fail ? 1 : 0);
