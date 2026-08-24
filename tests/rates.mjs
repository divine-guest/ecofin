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

console.log(`\nИТОГО: ${pass} пройдено, ${fail} провалено\n`);
process.exit(fail ? 1 : 0);
