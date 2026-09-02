/* ============ ЭкоФин — «Моё дело» ============

   Раздел, в который заходят не с вопросом, а по привычке.

   Всё остальное на сайте отвечает разово: посчитал налог — ушёл, прочитал
   статью — ушёл. Здесь лежат собственные деньги человека, и каждое новое
   поступление меняет три числа, которые ему важны прямо сейчас: сколько
   заработано, сколько отложить на налог и сколько осталось до лимита.

   Все ставки берутся из js/rates.js — единственного места, где они
   записаны. Ни одного числа налогового законодательства в этом файле нет
   намеренно: второе место для таких чисел неизбежно разойдётся с первым.

   Расчёт честно называется оценкой. Он не заменяет декларацию: не знает
   про торговый сбор, региональные ставки УСН, НДС и взносы за работников.
   Об этом сказано в интерфейсе, а не спрятано в сноске.                */

const BOOK = (() => {

  const RUB = n => Math.round(n).toLocaleString("ru-RU") + " ₽";

  /* Русское склонение: «1 день», «2 дня», «5 дней». Без этого текст
     выглядит машинным, а раздел, который человек открывает каждый день,
     машинным выглядеть не должен. */
  function plural(n, one, few, many) {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  }

  /* ---------- Что за режим и что он о себе знает ---------- */

  const REGIMES = {
    npd:   { title: "НПД (самозанятость)", forms: ["ip", "self"] },
    usn6:  { title: "УСН «Доходы» 6%",     forms: ["ip", "ooo"] },
    usn15: { title: "УСН «Доходы минус расходы» 15%", forms: ["ip", "ooo"] },
    psn:   { title: "Патент (ПСН)",        forms: ["ip"] },
    ausn:  { title: "АУСН",                forms: ["ip", "ooo"] },
    eshn:  { title: "ЕСХН",                forms: ["ip", "ooo"] },
    osno:  { title: "ОСНО",                forms: ["ip", "ooo"] },
  };

  /* Годовой лимит выручки и чем грозит его превышение. Не «правило ради
     правила»: слёт с режима задним числом означает пересчёт налога
     с начала квартала, и человек должен увидеть приближение заранее,
     а не узнать о нём от инспекции. */
  function limitOf(regime) {
    const R = RATES;
    switch (regime) {
      case "npd":  return { max: R.npd.limit,
        what: "Сверх лимита самозанятость слетает с того дня, когда он превышен. " +
              "Дальше — либо ИП на УСН, либо НДФЛ 13% со всего, что сверху." };
      case "psn":  return { max: R.psn.incomeLimit,
        what: "Сверх лимита патент теряется с начала того периода, на который он куплен, " +
              "и налог пересчитывается по УСН или ОСНО." };
      case "ausn": return { max: R.ausn.incomeLimit,
        what: "Сверх лимита АУСН прекращается с начала месяца превышения." };
      case "usn6":
      case "usn15": return { max: R.usn.limit, soft: R.usn.vatThreshold,
        what: "Сверх лимита право на упрощёнку теряется с начала квартала.",
        softWhat: "С этого дохода на УСН появляется НДС — его надо начать считать и платить." };
      case "eshn": return { max: Infinity, soft: R.eshn.vatExemptUpTo,
        softWhat: "Выше этого дохода освобождение от НДС на ЕСХН больше не действует." };
      default: return { max: Infinity };
    }
  }

  /* ---------- Взносы ИП «за себя» ---------- */
  function ownContributions(profile, income) {
    /* Платят только ИП, и только не на НПД и не на АУСН: там взносов
       за себя нет вовсе — это и есть их главное преимущество. */
    if (profile.form !== "ip") return 0;
    if (profile.regime === "npd" || profile.regime === "ausn") return 0;
    const C = RATES.ipContributions;
    const extra = Math.min(C.extraCap, Math.max(0, income - C.extraThreshold) * C.extraRate);
    return C.fixed + extra;
  }

  /* ---------- Оценка налога за год ----------

     Возвращает не только сумму, но и пояснение: человеку важнее понять,
     из чего она вышла, чем увидеть красивое число. И список того, что
     в оценку не вошло, — чтобы он не принял её за декларацию.          */
  function estimate(profile, year) {
    const R = RATES;
    const income = year.income || 0;
    const expense = year.expense || 0;
    const fromPersons = year.incomeFromPersons || 0;
    const fromCompanies = Math.max(0, income - fromPersons);
    const own = ownContributions(profile, income);
    const notCounted = [];

    let tax = 0, how = "";

    switch (profile.regime) {
      case "npd": {
        tax = fromPersons * R.npd.ratePersons + fromCompanies * R.npd.rateCompanies;
        how = `${RUB(fromPersons)} от физлиц по 4% и ${RUB(fromCompanies)} от компаний по 6%. `
            + `Взносов за себя на НПД нет.`;
        notCounted.push("вычет 10 000 ₽, который даётся один раз при регистрации");
        break;
      }
      case "usn6": {
        const raw = income * R.usn.incomeRate;
        /* Взносы уменьшают налог: без работников — полностью, с работниками
           — не больше чем вдвое. Это самая частая недоплата и переплата
           одновременно: половина людей не уменьшает налог вообще. */
        const cut = profile.workers > 0 ? Math.min(raw / 2, own) : Math.min(raw, own);
        tax = Math.max(0, raw - cut);
        how = `6% с ${RUB(income)} — это ${RUB(raw)}, минус взносы ${RUB(cut)}`
            + (profile.workers > 0 ? " (с работниками налог уменьшается не более чем вдвое)." : ".");
        if (income > R.usn.vatThreshold) notCounted.push("НДС — он появляется с этого уровня дохода");
        if (profile.workers > 0) notCounted.push("взносы за работников");
        break;
      }
      case "usn15": {
        const base = Math.max(0, income - expense);
        const normal = base * R.usn.profitRate;
        const minimal = income * R.usn.minTaxRate;
        tax = Math.max(normal, minimal);
        how = normal >= minimal
          ? `15% с прибыли ${RUB(base)}.`
          : `Прибыль мала, поэтому платится минимальный налог — 1% с выручки. Так велит НК РФ.`;
        notCounted.push("взносы за себя здесь не уменьшают налог, а входят в расходы");
        if (income > R.usn.vatThreshold) notCounted.push("НДС");
        break;
      }
      case "psn": {
        tax = (profile.psn || 0) * R.psn.rate;
        how = profile.psn
          ? `Патент считается не от выручки, а от потенциального дохода ${RUB(profile.psn)}: 6% с него.`
          : `Укажите потенциальный доход по патенту — без него стоимость патента не посчитать. `
            + `Точную цифру даёт калькулятор ФНС.`;
        notCounted.push("взносы за себя — они уменьшают стоимость патента");
        break;
      }
      case "ausn": {
        tax = income * R.ausn.incomeRate;
        how = `8% с ${RUB(income)}. Взносов за себя и за работников на АУСН нет — `
            + `вместо них фиксированный взнос на травматизм ${RUB(R.ausn.injuryFixed)} за год.`;
        break;
      }
      case "eshn": {
        tax = Math.max(0, income - expense) * R.eshn.rate;
        how = `6% с прибыли ${RUB(Math.max(0, income - expense))}.`;
        break;
      }
      case "osno": {
        if (profile.form === "ooo") {
          tax = Math.max(0, income - expense) * R.osno.profitTaxRate;
          how = `25% с прибыли ${RUB(Math.max(0, income - expense))}.`;
        } else {
          /* У ИП на ОСНО база — доход минус расходы, но если расходы не
             подтверждены, закон разрешает вычесть 20% дохода. Берём
             вариант выгоднее — так поступил бы и бухгалтер. */
          const byDocs = Math.max(0, income - expense);
          const byNorm = income * (1 - R.osno.proDeduction);
          const base = Math.min(byDocs, byNorm);
          tax = ndfl(base);
          how = byNorm < byDocs
            ? `Расходов подтверждено мало, поэтому выгоднее профвычет 20%: НДФЛ с ${RUB(base)}.`
            : `НДФЛ по шкале с ${RUB(base)}.`;
        }
        notCounted.push("НДС — на ОСНО он есть почти всегда");
        break;
      }
      default:
        return { known: false };
    }

    if (own > 0) notCounted.push(`взносы за себя ${RUB(own)} — их платят отдельно от налога`);

    return { known: true, tax, own, how, notCounted, income, expense };
  }

  /* НДФЛ по пятиступенчатой шкале: каждая ступень облагается своей
     ставкой, а не вся сумма по ставке верхней ступени. Это путают чаще
     всего, поэтому считаем именно так. */
  function ndfl(base) {
    let left = base, prev = 0, sum = 0;
    for (const step of RATES.ndflScale) {
      const part = Math.max(0, Math.min(left, step.upTo - prev));
      sum += part * step.rate;
      left -= part; prev = step.upTo;
      if (left <= 0) break;
    }
    return sum;
  }

  /* ---------- Лимит и прогноз ----------

     Главное, ради чего сюда возвращаются. Одно дело знать, что лимит
     самозанятого 2,4 млн, и совсем другое — видеть «при вашем темпе
     упрётесь 14 ноября». Второе заставляет что-то сделать заранее.   */
  function limitState(profile, year, yearNumber) {
    const lim = limitOf(profile.regime);
    const income = year.income || 0;
    if (!isFinite(lim.max) && !lim.soft) return null;

    const now = new Date();
    const isThisYear = yearNumber === now.getFullYear();
    const dayOfYear = Math.floor((now - new Date(yearNumber, 0, 1)) / 86400000) + 1;
    const perDay = isThisYear && dayOfYear > 0 ? income / dayOfYear : 0;

    /* Порог, до которого считаем «осталось». Мягкий порог (НДС) наступает
       раньше жёсткого и практичнее: до 450 млн большинство не дойдёт
       никогда, а до 60 млн — вполне. */
    const target = lim.soft && income < lim.soft ? lim.soft : lim.max;
    const targetWhat = lim.soft && income < lim.soft ? lim.softWhat : lim.what;
    if (!isFinite(target)) return null;

    const left = Math.max(0, target - income);
    const share = Math.min(1, income / target);

    /* Прогноз показываем, только если он попадает в этот же год: лимит
       считается за год, и «упрётесь в 2031» — не предупреждение, а шум.

       Но и молчать нельзя. Раньше во всех случаях без прогноза выводилось
       «темп пока не сложился» — и человек с девятью записями видел, будто
       сервис их не заметил. Поэтому различаем два разных «прогноза нет»:
       данных ещё мало — и данных хватает, просто до лимита в этом году
       не дотянуть. Второе само по себе хорошая новость, и сказать её
       надо словами. */
    let forecast = null, why = "none";
    if (perDay <= 0) {
      why = "no-data";
    } else if (left > 0) {
      const daysLeft = Math.ceil(left / perDay);
      const when = new Date(now.getTime() + daysLeft * 86400000);
      if (when.getFullYear() === yearNumber) forecast = { when, daysLeft };
      else why = "safe";
    }

    return { target, left, share, forecast, why, what: targetWhat, over: income > target };
  }

  /* ---------- Сроки: что и когда платить ----------

     Не полный календарь — он уже есть в калькуляторах. Здесь только то,
     что вытекает из внесённых сумм: ближайший платёж и сколько он
     составит по текущим данным.                                       */
  function nextPayments(profile, year, est) {
    const out = [];
    const y = new Date().getFullYear();
    const d = (m, day) => new Date(y, m - 1, day);

    if (profile.regime === "npd") {
      const now = new Date();
      const due = new Date(now.getFullYear(), now.getMonth(), 28);
      if (due < now) due.setMonth(due.getMonth() + 1);
      out.push({ when: due, what: "Налог на профдоход за прошлый месяц",
                 note: "Сумму считает приложение «Мой налог» — здесь оценка за год целиком" });
    }

    if (profile.regime === "usn6" || profile.regime === "usn15") {
      for (const [m, day, label] of [[4, 28, "I квартал"], [7, 28, "полугодие"], [10, 28, "9 месяцев"]]) {
        const when = d(m, day);
        if (when > new Date()) { out.push({ when, what: `Авансовый платёж по УСН за ${label}` }); break; }
      }
      out.push({ when: d(12, 28), what: "Взносы ИП «за себя», фиксированная часть",
                 note: profile.form === "ip" ? `Ориентир: ${RUB(RATES.ipContributions.fixed)}` : "" });
    }

    if (profile.form === "ip" && profile.regime !== "npd" && profile.regime !== "ausn") {
      const income = year.income || 0;
      if (income > RATES.ipContributions.extraThreshold) {
        const extra = Math.min(RATES.ipContributions.extraCap,
          (income - RATES.ipContributions.extraThreshold) * RATES.ipContributions.extraRate);
        out.push({ when: new Date(y + 1, 6, 1), what: "1% с дохода свыше 300 000 ₽",
                   note: `По текущим данным — ${RUB(extra)}` });
      }
    }

    return out.filter(p => p.when > new Date()).sort((a, b) => a.when - b.when).slice(0, 3);
  }

  return { REGIMES, estimate, limitState, nextPayments, ownContributions, plural, RUB };
})();

if (typeof window !== "undefined") window.BOOK = BOOK;
if (typeof module !== "undefined" && module.exports) module.exports = BOOK;
