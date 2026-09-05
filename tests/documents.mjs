/* Мои документы: история бумаг и её связь с учётом.

   Почему проверка тут особенно нужна. Отметка «оплачен» заносит
   поступление в «Моё дело», а оттуда сумма идёт в расчёт налога.
   Ошибка здесь тихая и дорогая: задвоенная выручка обнаружится
   не в кабинете, а в декларации.

   Тест поднимается против ЛОКАЛЬНОГО сервера с временной базой, а не
   против боевого: он создаёт и удаляет записи учёта, и делать это
   в живых данных нельзя.

   Запуск:
     DB_FILE=<временный файл> PORT=8099 node worker/node/server.mjs
     API_URL=http://127.0.0.1:8099 node tests/documents.mjs           */

import { cleanup, sql } from "./_admin.mjs";

const API = process.env.API_URL || "http://127.0.0.1:8770";

let pass = 0, fail = 0;
const ok = (c, label, got = "") => {
  c ? (pass++, console.log("  ✓", label)) : (fail++, console.log("  ✗", label, "→", JSON.stringify(got)));
};

async function call(path, { method = "GET", token, body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: {
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

/* Счётчик попыток регистрации выбирается за пару прогонов, и дальше
   всё выглядит как провал тестов при исправном сервере. Чистим его
   перед стартом — как это делает общий запуск. */
try { await sql("DELETE FROM ratelimit"); } catch {}

const accounts = [];

async function register(tag) {
  const email = `doc${tag}${Date.now()}@test.ru`;
  accounts.push(email);
  const r = await call("/api/auth/register", {
    method: "POST", body: { name: "Проверка", email, password: "parol12345" },
  });
  if (!r.data.token) throw new Error("не удалось завести аккаунт: " + JSON.stringify(r.data));
  return { email, token: r.data.token };
}

const A = await register("a");

console.log("\n— Документ сохраняется со своими полями —");
{
  const r = await call("/api/documents", {
    method: "POST", token: A.token,
    body: {
      kind: "invoice", title: "Счёт", number: "17", date: "2026-09-01",
      party: "ООО «Ромашка»", amount: 120000.5, status: "issued",
      content: "СЧЁТ № 17",
    },
  });
  ok(r.status === 201 && r.data.id, "счёт создан", r.data);
  A.invoice = r.data.id;

  const list = await call("/api/documents", { token: A.token });
  const d = list.data.documents.find(x => x.id === A.invoice);
  ok(Boolean(d), "счёт виден в списке");
  ok(d.number === "17" && d.party === "ООО «Ромашка»", "номер и контрагент сохранены", d);

  /* Копейки: сумма хранится целым числом, потому что дробные рубли
     копят ошибку округления и годовой итог расходится с ручным
     подсчётом. Проверяем, что обратно приходит ровно то же. */
  ok(d.amount === 120000.5, "сумма вернулась без потери копеек", d.amount);
  ok(d.status === "issued", "состояние сохранено", d.status);

  ok(list.data.owed === 120000.5, "«ждёт оплаты» считается по выставленным", list.data.owed);

  /* Содержимое в списке не приходит: пятьдесят документов по паре
     десятков килобайт — это мегабайт на каждое открытие кабинета. */
  ok(d.content === undefined, "текст документа в списке не отдаётся");
  const one = await call("/api/documents/one?id=" + A.invoice, { token: A.token });
  ok(one.data.document.content === "СЧЁТ № 17", "текст приходит по отдельному запросу");
}

console.log("\n— Оплата заносит поступление в «Моё дело» —");
{
  const before = await call("/api/book", { token: A.token });
  const wasOps = (before.data.ops || []).length;

  const r = await call("/api/documents/status", {
    method: "POST", token: A.token, body: { id: A.invoice, status: "paid" },
  });
  ok(r.data.bookOpAdded === true, "поступление создано", r.data);

  const after = await call("/api/book", { token: A.token });
  const ops = after.data.ops || [];
  ok(ops.length === wasOps + 1, `в учёте стало на одну запись больше: ${ops.length}`, ops.length);

  const op = ops.find(o => String(o.note || "").includes("17"));
  ok(Boolean(op), "запись учёта ссылается на номер счёта", ops.map(o => o.note));
  ok(op && op.amount === 120000.5, "сумма поступления совпала со счётом", op && op.amount);
  ok(op && op.kind === "income", "это поступление, а не трата", op && op.kind);
  /* «ООО» в названии — значит платит компания. Для самозанятого это
     6% вместо 4%, то есть прямые деньги. */
  ok(op && op.payer === "company", "плательщик определён как организация", op && op.payer);

  /* Повторная отметка не должна задваивать выручку. */
  const again = await call("/api/documents/status", {
    method: "POST", token: A.token, body: { id: A.invoice, status: "paid" },
  });
  ok(again.data.unchanged === true, "повторная отметка ничего не делает", again.data);
  const after2 = await call("/api/book", { token: A.token });
  ok((after2.data.ops || []).length === ops.length, "выручка не удвоилась", (after2.data.ops || []).length);
}

console.log("\n— Снятая оплата убирает запись учёта —");
{
  const r = await call("/api/documents/status", {
    method: "POST", token: A.token, body: { id: A.invoice, status: "issued" },
  });
  ok(r.data.bookOpRemoved === true, "поступление убрано", r.data);

  const book = await call("/api/book", { token: A.token });
  const still = (book.data.ops || []).find(o => String(o.note || "").includes("17"));
  ok(!still, "записи по этому счёту в учёте больше нет");

  /* И назад: отметили снова — запись появляется, но одна. */
  await call("/api/documents/status", { method: "POST", token: A.token, body: { id: A.invoice, status: "paid" } });
  const book2 = await call("/api/book", { token: A.token });
  const hits = (book2.data.ops || []).filter(o => String(o.note || "").includes("17"));
  ok(hits.length === 1, "после повторной оплаты запись ровно одна", hits.length);
}

console.log("\n— Удаление документа не крадёт деньги из учёта —");
{
  /* Деньги пришли на самом деле. Убрать документ можно, а вычеркнуть
     поступление из книги учёта задним числом — нельзя: это уже
     доход, с которого считается налог. */
  const r = await call("/api/documents/delete", {
    method: "POST", token: A.token, body: { id: A.invoice },
  });
  ok(r.data.bookOpKept === true, "поступление осталось", r.data);

  const book = await call("/api/book", { token: A.token });
  ok((book.data.ops || []).some(o => String(o.note || "").includes("17")),
     "запись учёта на месте после удаления документа");

  const list = await call("/api/documents", { token: A.token });
  ok(!list.data.documents.some(d => d.id === A.invoice), "документа в списке больше нет");
}

console.log("\n— Нулевая сумма записи не создаёт —");
{
  const c = await call("/api/documents", {
    method: "POST", token: A.token,
    body: { kind: "act", title: "Акт без суммы", content: "АКТ", status: "issued" },
  });
  const before = (await call("/api/book", { token: A.token })).data.ops.length;
  const r = await call("/api/documents/status", {
    method: "POST", token: A.token, body: { id: c.data.id, status: "paid" },
  });
  ok(r.data.bookOpAdded !== true, "ноль в книгу доходов не заносится", r.data);
  const after = (await call("/api/book", { token: A.token })).data.ops.length;
  ok(after === before, "число записей учёта не изменилось", [before, after]);

  const list = await call("/api/documents", { token: A.token });
  ok(list.data.documents.find(d => d.id === c.data.id).status === "paid",
     "но сам документ всё равно стал оплаченным");
}

console.log("\n— Чужие документы недоступны —");
{
  const B = await register("b");
  const mine = await call("/api/documents", {
    method: "POST", token: A.token, body: { title: "Мой договор", content: "тайна" },
  });

  const peek = await call("/api/documents/one?id=" + mine.data.id, { token: B.token });
  ok(peek.status === 404, "чужой документ не открывается", peek.status);

  const steal = await call("/api/documents/status", {
    method: "POST", token: B.token, body: { id: mine.data.id, status: "paid" },
  });
  ok(steal.status === 404, "чужой документ нельзя отметить оплаченным", steal.status);

  const wipe = await call("/api/documents/delete", {
    method: "POST", token: B.token, body: { id: mine.data.id },
  });
  ok(wipe.status === 404, "чужой документ нельзя удалить", wipe.status);

  const bList = await call("/api/documents", { token: B.token });
  ok(!bList.data.documents.some(d => d.id === mine.data.id), "и в списке его не видно");

  const anon = await call("/api/documents");
  ok(anon.status === 401, "без входа список не отдаётся", anon.status);
}

console.log("\n— Правка сохранённого —");
{
  const c = await call("/api/documents", {
    method: "POST", token: A.token,
    body: { title: "Черновик", content: "первый вариант", amount: 100 },
  });
  const upd = await call("/api/documents", {
    method: "POST", token: A.token,
    body: { id: c.data.id, title: "Договор аренды", content: "второй вариант", amount: 250.75 },
  });
  ok(upd.data.updated === true, "правка не создаёт второй документ", upd.data);

  const one = await call("/api/documents/one?id=" + c.data.id, { token: A.token });
  ok(one.data.document.title === "Договор аренды", "название обновилось");
  ok(one.data.document.amount === 250.75, "сумма обновилась", one.data.document.amount);
  ok(one.data.document.content === "второй вариант", "текст обновился");
}

console.log("\n— Бесплатный тариф: вытеснение вместо отказа —");
{
  const C = await register("c");
  /* Отказ «у вас лимит» ровно в момент нажатия «сохранить» означает
     потерю только что сделанной работы. Вместо этого вытесняем самый
     старый черновик — выставленные и оплаченные не трогаем. */
  const ids = [];
  for (let i = 0; i < 22; i++) {
    const r = await call("/api/documents", {
      method: "POST", token: C.token, body: { title: "Черновик " + i, content: "x" },
    });
    ok(r.status === 201 || i < 20, `сохранение №${i + 1} не отказало`, r.data);
    if (r.data.id) ids.push({ i, id: r.data.id, evicted: r.data.evicted });
  }
  const list = await call("/api/documents", { token: C.token });
  ok(list.data.documents.length === 20, `хранится ровно предел: ${list.data.documents.length}`,
     list.data.documents.length);
  ok(!list.data.documents.some(d => d.title === "Черновик 0"), "вытеснился самый старый");
  ok(list.data.documents.some(d => d.title === "Черновик 21"), "последний сохранён");
  ok(list.data.limit === 20, "предел показан честно", list.data.limit);
}

/* Убираем за собой: тест заводит счета и записи учёта, и оставлять
   их в базе нельзя — даже в тестовой они мешают следующему прогону. */
for (const acc of accounts) await cleanup(acc);

console.log(`\nИТОГО: ${pass} пройдено, ${fail} провалено\n`);
process.exit(fail ? 1 : 0);
