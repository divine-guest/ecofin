/* Личный налоговый календарь: подбор сроков и вычисление дат.

   Проверка офлайн — ни базы, ни сети не требует: pickPresets и dueFor
   чистые функции. Это важно, потому что ошибка здесь тихая: человек
   получит чужие сроки или дату на год мимо и узнает об этом от ФНС.  */
import { CALENDAR_PRESETS, pickPresets, dueFor, nextDue, addDays, localDay }
  from "../worker/src/reminders.js";

let pass = 0, fail = 0;
const ok = (c, label, got = "") => {
  c ? (pass++, console.log("  ✓", label)) : (fail++, console.log("  ✗", label, "→", JSON.stringify(got)));
};
const ids = list => list.map(p => p.id);

console.log("\n— Сам список сроков цел —");
{
  const seen = new Set();
  const dup = CALENDAR_PRESETS.filter(p => (seen.has(p.id) ? true : (seen.add(p.id), false)));
  ok(dup.length === 0, "нет двух сроков с одинаковым id", ids(dup));

  const REPEATS = ["once", "monthly", "quarterly", "yearly"];
  const badRepeat = CALENDAR_PRESETS.filter(p => !REPEATS.includes(p.repeat));
  ok(badRepeat.length === 0, "у каждого срока понятное правило повтора", ids(badRepeat));

  /* Месячные записаны днём («28»), остальные — месяцем и днём («04-28»).
     Перепутать эти два вида легко, а последствие тихое: срок уедет на
     несуществующую дату и не сработает вовсе. */
  const badDue = CALENDAR_PRESETS.filter(p =>
    p.repeat === "monthly" ? !/^\d{1,2}$/.test(String(p.due)) : !/^\d{2}-\d{2}$/.test(String(p.due)));
  ok(badDue.length === 0, "формат даты соответствует правилу повтора", ids(badDue));

  const noTitle = CALENDAR_PRESETS.filter(p => !p.title || p.title.length < 8);
  ok(noTitle.length === 0, "у каждого срока внятное название", ids(noTitle));
}

console.log("\n— Каждому свои сроки, и только свои —");
{
  const ipUsn = pickPresets({ who: "ip", mode: "usn", staff: false, sphere: "services" });
  ok(ids(ipUsn).includes("usn-q1"), "ИП на УСН видит авансы по УСН");
  ok(ids(ipUsn).includes("vznosy"), "ИП видит свои фиксированные взносы");
  ok(!ids(ipUsn).includes("persons"), "без работников отчётности за людей нет");
  ok(!ids(ipUsn).includes("nds-decl"), "на УСН декларации по НДС нет");
  ok(!ids(ipUsn).includes("usn-year-ooo"), "ИП не получает срок декларации ООО");

  /* Шесть сроков маркетплейса шли каждому подряд, и личный календарь
     переставал быть личным — ровно то, ради чего он делается. */
  ok(!ids(ipUsn).some(i => i.startsWith("mp-")), "тому, кто не торгует, ритм площадки не нужен");
  const trade = pickPresets({ who: "ip", mode: "usn", staff: false, sphere: "trade" });
  ok(ids(trade).some(i => i.startsWith("mp-")), "торгующему сроки площадки приходят");

  const staff = pickPresets({ who: "ooo", mode: "usn", staff: true, sphere: "services" });
  ok(ids(staff).includes("persons") && ids(staff).includes("rsv"),
     "у работодателя появляются персонифицированные сведения и РСВ");
  ok(ids(staff).includes("salary") && ids(staff).includes("salary-adv"),
     "зарплата и аванс — тоже срок: ТК ст. 136");

  const self = pickPresets({ who: "self", mode: "npd", staff: false, sphere: "services" });
  ok(ids(self).includes("npd"), "самозанятому — налог на профдоход");
  ok(!ids(self).some(i => i.startsWith("usn")), "самозанятому не подсовываем УСН");
  ok(!ids(self).includes("vznosy"), "у самозанятого нет фиксированных взносов");

  const person = pickPresets({ who: "person", mode: "none", staff: false, sphere: "" });
  ok(ids(person).includes("prop-tax"), "физлицу — налог на квартиру и машину");
  ok(person.length <= 4, `физлицу приходит немного сроков: ${person.length}`, person.length);
  ok(!ids(person).some(i => i.startsWith("mp-") || i.startsWith("usn")),
     "физлицу не приходит ничего предпринимательского");

  const osno = pickPresets({ who: "ooo", mode: "osno", staff: false, sphere: "services" });
  ok(ids(osno).includes("nds-decl") && ids(osno).includes("profit"),
     "на общем режиме появляются НДС и налог на прибыль");
  ok(!ids(osno).includes("usn-q1"), "на общем режиме авансов по УСН нет");

  const psn = pickPresets({ who: "ip", mode: "patent", staff: false, sphere: "services" });
  ok(ids(psn).includes("psn-1") && ids(psn).includes("psn-2"), "патент оплачивается в два срока");
  ok(ids(psn).includes("vznosy"), "взносы за себя платят и на патенте");

  /* Пустой набор — это тоже ответ, но он не должен получаться у людей,
     которые чем-то занимаются. */
  for (const who of ["ip", "ooo", "self", "person"]) {
    const list = pickPresets({ who, mode: who === "self" ? "npd" : who === "person" ? "none" : "usn",
                               staff: false, sphere: "services" });
    ok(list.length > 0, `${who}: сроки нашлись (${list.length})`, list.length);
  }
}

console.log("\n— Даты считаются вперёд, а не в прошлое —");
{
  const today = "2026-09-05";
  const byId = id => CALENDAR_PRESETS.find(p => p.id === id);

  /* Аванс за I квартал 28 апреля в этом году уже прошёл — значит
     следующий в апреле будущего. Год не хранится в самом сроке
     намеренно: иначе список пришлось бы править каждый январь. */
  ok(dueFor(byId("usn-q1"), today) === "2027-04-28",
     "прошедший годовой срок уезжает на следующий год", dueFor(byId("usn-q1"), today));
  ok(dueFor(byId("vznosy"), today) === "2026-12-28",
     "ещё не наступивший остаётся в этом году", dueFor(byId("vznosy"), today));
  ok(dueFor(byId("npd"), today) === "2026-09-28",
     "месячный срок 28-го — в этом же месяце", dueFor(byId("npd"), today));
  ok(dueFor(byId("salary"), today) === "2026-09-10",
     "месячный срок 10-го ещё впереди — остаётся в этом месяце", dueFor(byId("salary"), today));
  ok(dueFor(byId("salary"), "2026-09-20") === "2026-10-10",
     "он же после 10-го — уходит на следующий месяц", dueFor(byId("salary"), "2026-09-20"));

  /* Квартальные записаны датой первого квартала. Сдвигать их надо на
     квартал, а не на год: иначе РСВ за III квартал показался бы
     январём будущего года. */
  const rsv = dueFor(byId("rsv"), today);
  ok(rsv === "2026-10-25", "квартальный срок сдвигается на квартал, а не на год", rsv);
  ok(rsv > today, "и всегда оказывается в будущем", rsv);

  /* Ни один срок ни для кого не должен получиться в прошлом. */
  const combos = [];
  for (const who of ["ip", "ooo", "self", "person"])
    for (const mode of ["usn", "patent", "npd", "osno", "ausn", "none"])
      for (const staff of [false, true])
        combos.push({ who, mode, staff, sphere: "trade" });
  const past = [];
  for (const day of ["2026-01-01", "2026-06-15", "2026-09-05", "2026-12-31"])
    for (const c of combos)
      for (const p of pickPresets(c))
        if (dueFor(p, day) < day) past.push(`${p.id} при ${day} → ${dueFor(p, day)}`);
  ok(past.length === 0, "ни одна дата не оказывается в прошлом", past.slice(0, 5));
}

console.log("\n— Повторы и сдвиги дат —");
{
  ok(nextDue("2026-01-31", "monthly") === "2026-02-28",
     "31 января ежемесячно не уезжает в март", nextDue("2026-01-31", "monthly"));
  ok(nextDue("2026-11-30", "quarterly") === "2027-02-28",
     "квартал от 30 ноября — конец февраля", nextDue("2026-11-30", "quarterly"));
  ok(nextDue("2026-02-28", "yearly") === "2027-02-28", "год от 28 февраля");
  ok(nextDue("2026-05-10", "once") === null, "разовый срок не повторяется");
  ok(addDays("2026-12-31", 1) === "2027-01-01", "переход через новый год");
  ok(addDays("2026-03-01", -1) === "2026-02-28", "шаг назад через конец месяца");
  ok(localDay(3, Date.UTC(2026, 8, 4, 22, 0)) === "2026-09-05",
     "в Москве после 21:00 UTC уже следующий день", localDay(3, Date.UTC(2026, 8, 4, 22, 0)));
}

console.log(`\nИТОГО: ${pass} пройдено, ${fail} провалено\n`);
process.exit(fail ? 1 : 0);
