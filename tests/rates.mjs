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

  /* Делитель среднего заработка — календарные дни расчётного периода
     (ч. 3.1 ст. 14 255-ФЗ): в 2024–2025 их 731, потому что 2024 год
     високосный. Ровно 730 закон оставляет только потолку и минимуму.
     Раньше здесь везде стояло 730, и проверки закрепляли ошибку расчёта
     вместо того, чтобы её ловить. */
  const periodDays = s.baseYears.reduce((n, y) => n + (y % 4 === 0 ? 366 : 365), 0);
  ok(s.baseYears.join() !== "2024,2025" || periodDays === 731,
     `в периоде ${s.baseYears.join("–")} — ${periodDays} дней`);

  const hi = R.maternityPay({ pay1: 9e6, pay2: 9e6, days: 140 });
  ok(hi.atMax, "очень высокий заработок упирается в потолок");
  ok(near(hi.daily, Math.min((s.bases[0] + s.bases[1]) / periodDays, maxDaily), 0.01),
     `дневное по предельным базам: ${Math.round(hi.daily)}`);
  ok(hi.daily <= maxDaily + 1e-9, "дневное пособие не выше потолка");

  /* С исключёнными днями знаменатель меньше — и дневное упирается
     именно в потолок, посчитанный через 730. */
  const hiEx = R.maternityPay({ pay1: 9e6, pay2: 9e6, days: 140, excluded: 30 });
  ok(near(hiEx.daily, maxDaily, 0.01), `потолок в день: ${Math.round(maxDaily)}`);
  ok(near(hiEx.birth, maxDaily * 140, 1), `максимум за 140 дней: ${Math.round(hiEx.birth)}`);

  const lo = R.maternityPay({ pay1: 50000, pay2: 50000, days: 140 });
  ok(lo.atMin, "маленький заработок поднимается до минимума");
  ok(near(lo.daily, s.minWageMonth * 24 / s.days, 0.01), "минимум считается из МРОТ");

  const mid = R.maternityPay({ pay1: 900000, pay2: 1100000, days: 140 });
  ok(!mid.atMax && !mid.atMin, "обычный заработок — без границ");
  ok(near(mid.daily, 2e6 / periodDays, 0.01), `дневное: 2 000 000 ÷ ${periodDays} = ${Math.round(mid.daily)}`);
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
  /* Два месяца без работы — это пособие за первый и заработок за
     второй. Раньше здесь ждали три заработка, и проверка закрепляла
     ошибку калькулятора вместо того, чтобы её ловить. */
  ok(a.forSearch === 60000, "за время поиска — только второй месяц", a.forSearch);
  ok(a.total === 120000, "два месяца без работы — два заработка, не три", a.total);

  const one = R.severancePay({ avgMonth: 60000, monthsUnemployed: 1 });
  ok(one.total === 60000, "устроился в первый месяц — только пособие", one.total);

  const half = R.severancePay({ avgMonth: 60000, monthsUnemployed: 1.5 });
  ok(half.forSearch === 30000, "за неполный второй месяц — пропорционально", half.forSearch);

  const three = R.severancePay({ avgMonth: 60000, monthsUnemployed: 3 });
  ok(three.total === 180000, "с третьим месяцем по решению службы занятости — три", three.total);

  /* Больше трёх заработков закон не даёт ни при каких условиях. */
  const b = R.severancePay({ avgMonth: 60000, monthsUnemployed: 5 });
  ok(b.extraMonths === 2, "сверх третьего месяца не считаем", b.extraMonths);

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


console.log("\n— Вычеты по НДФЛ: как складываются лимиты —");
{
  const D = R.deductions;

  /* Социальные вычеты упираются в ОДИН общий потолок на все виды
     вместе, а не в потолок на каждый. Ошибка ровно наоборот —
     самая частая: человек считает, что за лечение вернут 19 500 и
     столько же за фитнес. */
  const many = R.deductionPlan({
    spent: { treatment: 100000, study: 100000, sport: 50000 },
    ndfl: 500000,
  });
  ok(many.base === D.socialLimit, `250 000 расходов обрезаны до ${D.socialLimit}`, many.base);
  ok(many.back === Math.round(D.socialLimit * 0.13), `вернут ${many.back}`, many.back);
  ok(many.over.length === 1 && /социальные/.test(many.over[0]),
     "сказано, что именно не поместилось", many.over);

  /* Дорогостоящее лечение — код 02 в справке — не ограничено вовсе,
     и в общий потолок не входит. */
  const big = R.deductionPlan({ spent: { treatmentBig: 800000 }, ndfl: 500000 });
  ok(big.base === 800000, "дорогостоящее лечение без лимита", big.base);
  ok(big.back === 104000, `вернут 13% со всей суммы: ${big.back}`, big.back);

  const both = R.deductionPlan({
    spent: { treatment: 200000, treatmentBig: 300000 }, ndfl: 500000,
  });
  ok(both.base === D.socialLimit + 300000,
     "дорогостоящее не съедает общий потолок", both.base);

  /* Обучение детей: лимит на КАЖДОГО ребёнка отдельно. */
  const kid1 = R.deductionPlan({ spent: { studyChild: 200000 }, ndfl: 500000, children: 1 });
  ok(kid1.base === D.educationChild, "на одного ребёнка — свой лимит", kid1.base);
  const kid2 = R.deductionPlan({ spent: { studyChild: 200000 }, ndfl: 500000, children: 2 });
  ok(kid2.base === 200000, "на двоих детей лимит вдвое больше", kid2.base);

  /* Обучение детей не входит в общий социальный потолок. */
  const mix = R.deductionPlan({
    spent: { treatment: 150000, studyChild: 110000 }, ndfl: 500000, children: 1,
  });
  ok(mix.base === D.socialLimit + D.educationChild,
     "обучение ребёнка считается сверх социального потолка", mix.base);

  /* Имущественные: свои потолки. */
  const buy = R.deductionPlan({ spent: { buy: 5000000 }, ndfl: 500000 });
  ok(buy.base === D.propertyBuy, "покупка жилья обрезана до 2 млн", buy.base);
  ok(buy.back === 260000, `максимум по покупке — 260 000: ${buy.back}`, buy.back);

  const mort = R.deductionPlan({ spent: { mortgage: 5000000 }, ndfl: 500000 });
  ok(mort.back === 390000, `максимум по процентам — 390 000: ${mort.back}`, mort.back);

  const iis = R.deductionPlan({ spent: { iis: 1000000 }, ndfl: 500000 });
  ok(iis.back === 52000, `максимум по ИИС — 52 000: ${iis.back}`, iis.back);
}

console.log("\n— Больше уплаченного НДФЛ не вернут —");
{
  /* Это главная причина разочарований: «обещали 260 тысяч, вернули 40».
     Вернули столько, сколько удержали. */
  const r = R.deductionPlan({ spent: { buy: 2000000 }, ndfl: 40000 });
  ok(r.wanted === 260000, "положено по лимиту", r.wanted);
  ok(r.back === 40000, "вернут не больше удержанного", r.back);
  ok(r.capped === true, "и об этом сказано прямо", r.capped);

  /* Остаток имущественного не сгорает — переносится на следующие годы.
     Об этом почти не знают и подают один раз. */
  ok(r.carry === 220000, `остаток переносится: ${r.carry}`, r.carry);

  /* А социальный — сгорает: переносить его закон не разрешает,
     и обещать обратное было бы враньём. */
  const soc = R.deductionPlan({ spent: { treatment: 150000 }, ndfl: 5000 });
  ok(soc.carry === 0, "социальный вычет не переносится", soc.carry);

  const none = R.deductionPlan({ spent: { treatment: 100000 }, ndfl: 0 });
  ok(none.back === 0, "без удержанного НДФЛ возвращать нечего", none.back);

  const empty = R.deductionPlan({ spent: {}, ndfl: 100000 });
  ok(empty.base === 0 && empty.back === 0, "пустые расходы не ломают расчёт", empty);
  ok(R.deductionPlan().back === 0, "вызов без данных не роняет");
}

console.log("\n— Документы и срок давности —");
{
  const r = R.deductionPlan({ spent: { treatment: 50000, mortgage: 100000 }, ndfl: 100000 });
  ok(r.need.length === 2, "перечислены документы по каждому вычету", r.need);
  ok(r.need.some(t => /справка об оплате медуслуг/.test(t)), "для лечения — справка из клиники");
  ok(r.need.some(t => /справка банка/.test(t)), "для ипотеки — справка банка");

  const у = R.deductionYears(new Date("2026-09-05"));
  ok(у.years.join() === "2025,2024,2023", "три года назад, не считая текущего", у.years);
  ok(у.expiring === 2023, "первым сгорает самый ранний", у.expiring);
  ok(у.lastCall === "31.12.2026", "срок подачи за него — конец этого года", у.lastCall);

  const y2 = R.deductionYears(new Date("2027-01-02"));
  ok(y2.years.join() === "2026,2025,2024", "в новом году окно сдвигается", y2.years);
}

console.log("\n— Льгота МСП по взносам —");
{
  /* С 2026 года изменилось два условия сразу, и оба легко откатить
     обратно по невнимательности.

     Первое: льготный тариф применяется к части выплаты свыше ПОЛУТОРА
     МРОТ, а не свыше одного. С той половины, что добавилась, теперь
     берётся 30%, и раньше мы её считали по 15% — то есть занижали.

     Второе: льгота положена не всем МСП, а только приоритетным видам
     деятельности. Сервис ОКВЭД не знает, поэтому по умолчанию считает
     по общему тарифу. Значение по умолчанию здесь — не стиль, а
     защита: заниженный расчёт взносов человек примет с радостью и
     узнает правду от инспекции. */
  const mrot = R.sickLeave.minWageMonth;

  ok(R.payrollContrib.smallMrotFactor === 1.5,
     "порог льготы — полтора МРОТ", R.payrollContrib.smallMrotFactor);

  /* Зарплата ровно на пороге: всё должно идти по полному тарифу. */
  const atThreshold = mrot * 1.5 * 12;
  const full = atThreshold * R.payrollContrib.rate;
  const got = R.employerContrib(atThreshold, { small: true, injury: 0 });
  ok(Math.abs(got - full) < 1,
     "на пороге вся сумма идёт по общему тарифу", [Math.round(got), Math.round(full)]);

  /* Рубль сверх порога — по льготному. */
  const above = R.employerContrib(atThreshold + 1200, { small: true, injury: 0 });
  const delta = above - got;
  ok(Math.abs(delta - 1200 * R.payrollContrib.smallRateOverMrot) < 1,
     "сверх порога — льготные 15%", Math.round(delta));

  /* По умолчанию льготы нет: сервис не знает ОКВЭД работодателя. */
  const byDefault = R.employerContrib(atThreshold * 2, { injury: 0 });
  const asBig = R.employerContrib(atThreshold * 2, { small: false, injury: 0 });
  ok(byDefault === asBig,
     "по умолчанию считается общий тариф, а не льготный");
}


console.log("\n— Налог с процентов по вкладам —");
{
  /* Необлагаемая сумма — миллион, умноженный на МАКСИМАЛЬНУЮ ключевую
     ставку из действовавших на первое число каждого месяца года
     (п. 1 ст. 214.2 НК РФ). Не на текущую.

     Разница появляется при снижении ставки, и она появилась: в 2026
     максимум на первое число 16%, а к сентябрю ставка 14%. По текущей
     вычет вышел бы 140 000 вместо 160 000 — лишние двадцать тысяч
     в базе и около 2 600 рублей лишнего налога. */
  const d = R.deposits;

  ok(d.maxKeyRateYear >= R.keyRate.percent,
     "максимум ставки за год не ниже текущей", [d.maxKeyRateYear, R.keyRate.percent]);

  const byDefault = R.depositTax({ interest: 300000 });
  ok(byDefault.free === d.base * d.maxKeyRateYear / 100,
     "по умолчанию вычет считается по максимуму за год", byDefault.free);

  /* Проценты меньше вычета — налога нет вовсе. */
  ok(R.depositTax({ interest: byDefault.free - 1 }).tax === 0,
     "до необлагаемой суммы налога нет");

  /* Ставка НДФЛ применяется к превышению, а не ко всей сумме. */
  const over = R.depositTax({ interest: byDefault.free + 100000 });
  ok(Math.abs(over.tax - 100000 * 0.13) < 1,
     "налог берётся только с превышения", Math.round(over.tax));

  /* Явно переданная ставка перекрывает умолчание: год закрывается,
     и человек может знать максимум точнее нас. */
  ok(R.depositTax({ interest: 300000, maxKeyRate: 21 }).free === d.base * 0.21,
     "переданная вручную ставка учитывается");
}


console.log("\n— У ставок есть срок годности —");
{
  /* Почему это отдельная проверка.

     Сегодня нашлись две устаревшие ставки. Ключевая была 16% при
     настоящих 14 — по ней считаются пеня, неустойка по ст. 395 ГК и
     проценты за задержку зарплаты по ст. 236 ТК, то есть человек
     получал завышенную сумму и шёл с ней к контрагенту. Предельная
     база взносов стояла прошлогодняя.

     Обе ошибки невидимы: калькулятор работает, число выглядит
     правдоподобно, никто не жалуется. Единственное, что их ловит, —
     календарь.

     Проверка не может знать настоящую ставку. Но может требовать,
     чтобы значение пересматривали, и падать, когда срок вышел. */

  const day = 24 * 60 * 60 * 1000;
  const since = d => Math.floor((Date.now() - Date.parse(d)) / day);

  ok(R.checkedOn, "у набора ставок есть дата сверки", R.checkedOn);
  const age = since(R.checkedOn);

  /* Девяносто дней: за квартал успевают поменяться лимиты, пороги и
     размеры пособий, и к концу квартала значения пора смотреть
     заново. */
  ok(age <= 90,
     `ставки сверялись ${age} дн. назад — пора проверить лимиты и пороги`, R.checkedOn);

  /* Ключевая ставка меняется восемь раз в год, поэтому у неё свой,
     более короткий срок: сорок пять дней — чуть больше промежутка
     между заседаниями Банка России. */
  ok(R.keyRate && R.keyRate.checkedOn, "у ключевой ставки своя дата сверки", R.keyRate);
  const keyAge = since(R.keyRate.checkedOn);
  ok(keyAge <= 45,
     `ключевая ставка сверялась ${keyAge} дн. назад — между заседаниями ЦБ проходит меньше`,
     R.keyRate.checkedOn);

  ok(R.keyRate.source && /cbr\.ru/.test(R.keyRate.source),
     "рядом со ставкой стоит ссылка на первоисточник", R.keyRate.source);

  /* Год в наборе должен совпадать с текущим: иначе лимиты и пороги
     заведомо прошлогодние. */
  ok(R.year === new Date().getFullYear(),
     `набор ставок заявлен на ${R.year} год`, R.year);

  /* Базы для больничного — ДВА предшествующих года, а не текущий.
     Их легко перепутать с предельной базой взносов, и один раз уже
     перепутали: в предельной базе стояло значение прошлого года. */
  const nowY = new Date().getFullYear();
  ok(R.sickLeave.baseYears.join() === [nowY - 2, nowY - 1].join(),
     "базы больничного — за два предшествующих года", R.sickLeave.baseYears);
  ok(R.payrollContrib.base !== R.sickLeave.bases[1],
     "предельная база взносов не равна прошлогодней базе больничного",
     [R.payrollContrib.base, R.sickLeave.bases[1]]);
}

console.log("\n— Юнит-экономика маркетплейса —");
{
  const base = { price: 2000, cost: 700, commission: 20, delivery: 80,
                 backDelivery: 50, storage: 15, ads: 100, buyout: 70 };

  const u = R.marketplaceUnit({ ...base, regime: "usn6" });
  ok(near(u.fee, 400, 0.01), "комиссия считается от цены покупателя");

  /* При выкупе 70% на одну продажу приходится 1/0,7 отправления
     и 0,43 возврата: обратная дорога тоже за счёт продавца. */
  ok(near(u.logistics, 80 / 0.7 + 50 * (1 / 0.7 - 1), 0.01),
     `логистика с возвратами: ${Math.round(u.logistics)} вместо 80`);
  ok(near(R.marketplaceUnit({ ...base, buyout: 100 }).logistics, 80, 0.01),
     "при полном выкупе обратной логистики нет");

  /* Главная ошибка продавцов: налог на «Доходах» берётся со всей цены,
     комиссия его не уменьшает. */
  ok(near(u.tax, 2000 * R.usn.incomeRate, 0.01),
     "на «Доходах» налог со всей цены, а не с того, что перечислила площадка");
  ok(u.taxOnFull, "расчёт сам говорит, что налог взят со всей цены");

  const p = R.marketplaceUnit({ ...base, regime: "usn15" });
  ok(near(p.tax, Math.max((2000 - p.spend) * R.usn.profitRate, 2000 * R.usn.minTaxRate), 0.01),
     "на «Доходах минус расходах» налог с разницы, но не меньше минимального");
  ok(p.profit > u.profit, "на этих числах «Доходы минус расходы» выгоднее");

  /* В точке безубыточности прибыль ровно ноль — иначе это не она. */
  const zero = R.marketplaceUnit({ ...base, price: u.breakEven, regime: "usn6" });
  ok(Math.abs(zero.profit) < 1, `ноль при цене ${Math.round(u.breakEven)} ₽`);
  ok(R.marketplaceUnit({ ...base, price: 900 }).profit < 0, "ниже этой цены — убыток");
}

console.log("\n— Стоимость участия в тендере —");
{
  const base = { nmck: 3000000, cost: 2100000, bidPct: 1, oikPct: 10, months: 6,
                 guaranteeRate: 5, moneyRate: 18, byGuarantee: true, smp: true,
                 regime: "usn6" };

  /* Всё обеспечение считается от начальной цены закупки. Снижение
     уменьшает выручку и не уменьшает обеспечение — на этом и теряют. */
  const a = R.tenderCost({ ...base, price: 2600000 });
  ok(near(a.oik, 300000, 0.01), "обеспечение контракта считается от НМЦК, а не от вашей цены");
  ok(near(a.bid, 30000, 0.01), "обеспечение заявки — тоже от НМЦК");
  ok(a.dumping === false, "снижение 13% антидемпинг не включает");

  /* Антидемпинг, ст. 37: снижение на четверть и больше — обеспечение
     в полтора раза, но не меньше 10% НМЦК. */
  const b = R.tenderCost({ ...base, price: 2200000 });
  ok(b.dumping && near(b.oik, 450000, 0.01),
     `снижение ${(b.cut * 100).toFixed(1)}% поднимает обеспечение до ${Math.round(b.oik)}`);
  const low = R.tenderCost({ ...base, price: 2200000, oikPct: 5 });
  ok(near(low.oik, 300000, 0.01),
     "полуторный размер не может быть меньше 10% НМЦК", Math.round(low.oik));

  /* До 15 млн повышенное обеспечение заменяет подтверждение опыта. */
  const good = R.tenderCost({ ...base, price: 2200000, goodFaith: true });
  ok(good.relief && near(good.oik, 300000, 0.01), "добросовестность снимает повышение до 15 млн");
  const big = R.tenderCost({ ...base, nmck: 20000000, price: 14000000, goodFaith: true });
  ok(big.dumping && !big.relief, "свыше 15 млн подтверждение добросовестности не спасает");

  /* Плата площадке: 1% НМЦК с потолком, и у закупок для СМП он ниже. */
  ok(near(a.fee, 2000, 0.01), "плата площадке в закупке для СМП — не более 2000 ₽");
  ok(near(R.tenderCost({ ...base, price: 2600000, smp: false }).fee, 5000, 0.01),
     "в обычной закупке потолок 5000 ₽");
  ok(R.tenderCost({ ...base, nmck: 900000, price: 800000 }).bidRequired === false,
     "при НМЦК до миллиона обеспечение заявки не требуется");

  /* Налог — со всей цены контракта: обеспечение его не уменьшает. */
  ok(near(a.tax, 2600000 * R.usn.incomeRate, 0.01), "на «Доходах» налог со всей цены контракта");
  ok(a.taxOnFull, "расчёт сам предупреждает, что налог взят со всей цены");

  /* Своими деньгами дороже гарантии, когда деньги стоят дороже комиссии. */
  const own = R.tenderCost({ ...base, price: 2600000, byGuarantee: false });
  ok(own.frozenCost > a.guarantee, "заморозить свои под 18% дороже гарантии под 5%");
  ok(near(own.frozen, 330000, 0.01), "из оборота выведены обеспечение и заявка");

  /* В точке безубыточности ровно ноль — иначе это не она. */
  const zero = R.tenderCost({ ...base, price: a.breakEven });
  ok(Math.abs(zero.profit) < 1, `ноль при цене ${Math.round(a.breakEven)} ₽`);
  ok(R.tenderCost({ ...base, price: 1800000 }).profit < 0, "ниже этой цены — убыток");
}

console.log("\n— НДС на упрощёнке —");
{
  /* Границу пониженных ставок берём с дефлятором: 272,5 млн, а не голые
     250 млн из кодекса. Здесь стояло 250 млн, и при доходе 260 млн
     расчёт показывал 7% вместо 5% — почти вдвое больше налога. */
  ok(R.usnVat({ income: 260e6 }).reducedRate === 0.05,
     "при 260 млн ставка 5%: граница проходит по 272,5 млн");
  ok(R.usnVat({ income: 300e6 }).reducedRate === 0.07, "при 300 млн — 7%");
  ok(R.usnVat({ income: 10e6 }).exempt === true, "до порога НДС нет вовсе");
  ok(R.usnVat({ income: 100e6, inputVat: 0 }).generalRate === R.vatRate,
     `обычная ставка берётся из справочника: ${R.vatRate * 100}%`);
}

console.log(`\nИТОГО: ${pass} пройдено, ${fail} провалено\n`);
process.exit(fail ? 1 : 0);
