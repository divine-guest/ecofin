/* Реквизиты, контрагенты и нумерация документов.

   Проверять здесь надо жёстче обычного: всё это уезжает в бумагу,
   которую человек подпишет и отнесёт в банк или налоговую. Ошибку в
   реквизитах находят через месяцы — при сверке или на проверке.

   Три вещи, за которыми следим особенно:
     — контрольные суммы ИНН и ОГРН отклоняют неверное, а не «поправляют»;
     — чужие реквизиты и контрагенты недоступны никаким способом;
     — номер документа никогда не повторяется, даже при гонке запросов.  */
import { cleanup, sql } from "./_admin.mjs";

const API = process.env.API_URL || "https://pravofin-api.pravofin.workers.dev";
const O = "https://divine-guest.github.io";

let pass = 0, fail = 0;
const ok = (c, label, got = "") => {
  c ? (pass++, console.log("  ✓", label)) : (fail++, console.log("  ✗", label, "→", JSON.stringify(got)));
};

async function call(path, { method = "GET", token, body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      Origin: O,
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function register(tag) {
  const email = `req${tag}${Date.now()}@test.ru`;
  const r = await call("/api/auth/register", {
    method: "POST", body: { name: "Проверка", email, password: "parol12345" },
  });
  return { email, token: r.data.token };
}

const me = await register("a");
const other = await register("b");

console.log("\n— Свои реквизиты —");
{
  const empty = await call("/api/requisites", { token: me.token });
  ok(empty.data.requisites?.name === "", "у нового аккаунта реквизиты пусты");
  ok(empty.data.ready === false, "и признак заполненности — нет");

  const good = await call("/api/requisites", {
    method: "POST", token: me.token,
    body: {
      name: "ИП Калайтанова Оксана Алексеевна", inn: "262300558403",
      ogrn: "324265100146987", address: "Ставрополь",
      bank: "АО «Банк»", bik: "044525225", account: "40802810000000000001",
    },
  });
  ok(good.status === 200, "верные реквизиты сохраняются", good.data);
  ok(good.data.ready === true, "и считаются заполненными");

  const back = await call("/api/requisites", { token: me.token });
  ok(back.data.requisites.inn === "262300558403", "читаются обратно теми же");
}

console.log("\n— Контрольные суммы отклоняют неверное —");
{
  const badInn = await call("/api/requisites", {
    method: "POST", token: me.token, body: { name: "Тест", inn: "262300558404" },
  });
  ok(badInn.status === 400, "ИНН с испорченной цифрой не сохраняется", badInn);

  const badOgrn = await call("/api/requisites", {
    method: "POST", token: me.token, body: { name: "Тест", inn: "", ogrn: "324265100146986" },
  });
  ok(badOgrn.status === 400, "ОГРН с испорченной цифрой не сохраняется", badOgrn);

  /* И, что важнее, отказ НЕ затирает прежние верные реквизиты: иначе
     одна опечатка стирала бы то, что человек вводил десять минут. */
  const still = await call("/api/requisites", { token: me.token });
  ok(still.data.requisites.inn === "262300558403", "после отказа прежние реквизиты целы",
     still.data.requisites.inn);

  const orgInn = await call("/api/requisites", {
    method: "POST", token: me.token,
    body: { name: "ООО «Ромашка»", inn: "7707083893", ogrn: "1027700132195" },
  });
  ok(orgInn.status === 200, "десятизначный ИНН и тринадцатизначный ОГРН тоже проходят", orgInn.data);

  /* Возвращаем как было — дальше проверяем на них. */
  await call("/api/requisites", {
    method: "POST", token: me.token,
    body: { name: "ИП Калайтанова Оксана Алексеевна", inn: "262300558403" },
  });
}

console.log("\n— Несколько своих организаций —");
let orgIp = 0, orgOoo = 0;
{
  /* Прежние одиночные реквизиты должны сами стать первой организацией:
     человек, вводивший их до появления списка, не должен вводить заново
     — иначе улучшение ощущается как поломка. */
  const first = await call("/api/orgs", { token: me.token });
  ok(first.data.orgs.length === 1, "прежние реквизиты стали первой организацией",
     first.data.orgs.length);
  orgIp = first.data.orgs[0]?.id || 0;
  ok(first.data.active === orgIp, "и сразу выбраны для подстановки", first.data.active);

  const add = await call("/api/orgs", {
    method: "POST", token: me.token,
    body: { label: "ООО", name: "ООО «Ромашка»", inn: "7707083893", kpp: "770701001" },
  });
  orgOoo = add.data.id;
  ok(orgOoo > 0, "вторая организация добавляется", add.data);

  const bad = await call("/api/orgs", {
    method: "POST", token: me.token, body: { name: "Кривая", inn: "262300558404" },
  });
  ok(bad.status === 400, "организация с неверным ИНН не сохраняется");

  const noName = await call("/api/orgs", {
    method: "POST", token: me.token, body: { name: "  " },
  });
  ok(noName.status === 400, "и без наименования тоже");
}

console.log("\n— Нумерация ведётся по организации —");
{
  await call("/api/orgs/active", { method: "POST", token: me.token, body: { id: orgIp } });
  const a = await call("/api/docnumber", { method: "POST", token: me.token, body: { kind: "dogovor" } });
  const b = await call("/api/docnumber", { method: "POST", token: me.token, body: { kind: "dogovor" } });
  ok(a.data.number === 1 && b.data.number === 2, "у первой организации 1 и 2",
     [a.data.number, b.data.number]);

  await call("/api/orgs/active", { method: "POST", token: me.token, body: { id: orgOoo } });
  const c = await call("/api/docnumber", { method: "POST", token: me.token, body: { kind: "dogovor" } });
  /* Это главное в разделении: общая нумерация двух своих фирм выглядит
     для налоговой как пропущенные документы. */
  ok(c.data.number === 1, "у второй нумерация своя, с единицы", c.data.number);
}

console.log("\n— Закрытая фирма уходит в архив, а не пропадает —");
{
  await call("/api/orgs/active", { method: "POST", token: me.token, body: { id: orgOoo } });
  const arch = await call("/api/orgs/archive", { method: "POST", token: me.token, body: { id: orgOoo } });
  ok(arch.status === 200, "убирается в архив");

  /* Выбор обязан сам перейти на живую: иначе подстановка молча
     перестаёт работать, и причину человек не найдёт. */
  ok(arch.data.active === orgIp, "выбор сам перешёл на оставшуюся", arch.data.active);

  const pick = await call("/api/orgs/active", { method: "POST", token: me.token, body: { id: orgOoo } });
  ok(pick.status === 400, "архивную нельзя выбрать", pick.status);

  const req = await call("/api/requisites", { token: me.token });
  ok(req.data.requisites.inn === "262300558403", "подставляются реквизиты оставшейся",
     req.data.requisites.inn);
  ok(req.data.orgs.every(o => o.id !== orgOoo), "архивная не предлагается в документах");

  const back = await call("/api/orgs/archive", {
    method: "POST", token: me.token, body: { id: orgOoo, restore: true },
  });
  ok(back.status === 200, "возвращается из архива");

  /* Номера после возврата продолжаются, а не начинаются заново: иначе
     человек выставит документ с номером, который у него уже был. */
  await call("/api/orgs/active", { method: "POST", token: me.token, body: { id: orgOoo } });
  const n = await call("/api/docnumber", { method: "POST", token: me.token, body: { kind: "dogovor" } });
  ok(n.data.number === 2, "нумерация после архива продолжается", n.data.number);

  await call("/api/orgs/active", { method: "POST", token: me.token, body: { id: orgIp } });
}

console.log("\n— Чужие организации недоступны —");
{
  const theirs = await call("/api/orgs", { token: other.token });
  ok(theirs.data.orgs.length === 0, "чужой не видит моих организаций", theirs.data.orgs.length);

  const grab = await call("/api/orgs/active", { method: "POST", token: other.token, body: { id: orgIp } });
  ok(grab.status === 404, "и не может выбрать мою");

  const edit = await call("/api/orgs", {
    method: "POST", token: other.token, body: { id: orgIp, name: "Подмена", inn: "" },
  });
  ok(edit.status === 404, "и не может переписать мою");

  const arch = await call("/api/orgs/archive", { method: "POST", token: other.token, body: { id: orgIp } });
  ok(arch.status === 404, "и не может убрать мою в архив");
}

console.log("\n— Контрагенты —");
let cpId = 0;
{
  const noName = await call("/api/counterparties", {
    method: "POST", token: me.token, body: { name: "   " },
  });
  ok(noName.status === 400, "без наименования не сохраняется");

  const badInn = await call("/api/counterparties", {
    method: "POST", token: me.token, body: { name: "Кто-то", inn: "7707083890" },
  });
  ok(badInn.status === 400, "контрагент с неверным ИНН не сохраняется");

  const add = await call("/api/counterparties", {
    method: "POST", token: me.token,
    body: { name: "ООО «Ромашка»", inn: "7707083893", address: "Москва" },
  });
  cpId = add.data.id;
  ok(cpId > 0, "контрагент добавляется", add.data);

  const list = await call("/api/counterparties", { token: me.token });
  ok(list.data.counterparties.length === 1, "и виден в списке");
  ok(list.data.counterparties[0].inn === "7707083893", "с сохранённым ИНН");

  const edit = await call("/api/counterparties", {
    method: "POST", token: me.token, body: { id: cpId, name: "ООО «Ромашка» (новое имя)", inn: "7707083893" },
  });
  ok(edit.status === 200, "изменяется по номеру");
  const after = await call("/api/counterparties", { token: me.token });
  ok(after.data.counterparties.length === 1, "и не задваивается при изменении",
     after.data.counterparties.length);
}

console.log("\n— Чужое недоступно —");
{
  const theirReq = await call("/api/requisites", { token: other.token });
  ok(theirReq.data.requisites.name === "", "чужой не видит моих реквизитов",
     theirReq.data.requisites.name);

  const theirList = await call("/api/counterparties", { token: other.token });
  ok(theirList.data.counterparties.length === 0, "и не видит моих контрагентов",
     theirList.data.counterparties.length);

  await call("/api/counterparties/delete", { method: "POST", token: other.token, body: { id: cpId } });
  const mine = await call("/api/counterparties", { token: me.token });
  ok(mine.data.counterparties.length === 1, "и не может удалить моего контрагента",
     mine.data.counterparties.length);

  const hijack = await call("/api/counterparties", {
    method: "POST", token: other.token, body: { id: cpId, name: "Подмена" },
  });
  ok(hijack.status === 404, "и не может переписать моего под своим номером", hijack);

  const anon = await call("/api/requisites", {});
  ok(anon.status === 401, "без входа реквизиты не отдаются", anon.status);
}

console.log("\n— Номера документов —");
{
  const a = await call("/api/docnumber", { method: "POST", token: me.token, body: { kind: "schet" } });
  const b = await call("/api/docnumber", { method: "POST", token: me.token, body: { kind: "schet" } });
  const c = await call("/api/docnumber", { method: "POST", token: me.token, body: { kind: "schet" } });
  ok(a.data.number === 1 && b.data.number === 2 && c.data.number === 3,
     "растут подряд и не повторяются", [a.data.number, b.data.number, c.data.number]);

  const n = await call("/api/docnumber", { method: "POST", token: me.token, body: { kind: "nakladnaya" } });
  ok(n.data.number === 1, "у каждого вида документа своя нумерация", n.data.number);

  const theirs = await call("/api/docnumber", { method: "POST", token: other.token, body: { kind: "schet" } });
  ok(theirs.data.number === 1, "и у каждого человека своя", theirs.data.number);

  const bad = await call("/api/docnumber", { method: "POST", token: me.token, body: { kind: "выдумка" } });
  ok(bad.status === 400, "неизвестный вид документа отклоняется");

  /* Гонка: десять одновременных запросов не должны выдать один номер
     дважды. Именно так это и происходит в жизни — человек нетерпеливо
     жмёт кнопку несколько раз подряд. */
  const race = await Promise.all(Array.from({ length: 10 }, () =>
    call("/api/docnumber", { method: "POST", token: me.token, body: { kind: "akt" } })));
  const nums = race.map(r => r.data.number);
  ok(new Set(nums).size === nums.length, "десять одновременных запросов дали разные номера",
     nums.join(","));
}

console.log("\n— Удаление аккаунта уносит реквизиты —");
{
  const email = me.email;
  const del = await call("/api/auth/delete", { method: "POST", token: me.token, body: { password: "parol12345" } });
  ok(del.status === 200, "аккаунт удаляется", del);

  const left = await sql(`SELECT COUNT(*) AS n FROM counterparties WHERE email='${email}'`);
  ok(Number(left[0]?.n ?? left[0]?.["COUNT(*)"] ?? 0) === 0, "контрагенты удалены вместе с аккаунтом", left);

  const nums = await sql(`SELECT COUNT(*) AS n FROM doc_numbers2 WHERE email='${email}'`);
  ok(Number(nums[0]?.n ?? 0) === 0, "и нумерация документов тоже", nums);

  const orgs = await sql(`SELECT COUNT(*) AS n FROM my_orgs WHERE email='${email}'`);
  ok(Number(orgs[0]?.n ?? 0) === 0, "и свои организации", orgs);
}

await cleanup(other.email);

console.log(`\nИТОГО: ${pass} пройдено, ${fail} провалено`);
process.exit(fail ? 1 : 0);
