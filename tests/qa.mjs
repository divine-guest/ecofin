/* Публичная лента вопросов.

   Проходим весь путь: вопрос → согласие автора → проверка владельцем →
   публикация. И границы: чужой ответ не предложить, до проверки лента
   пуста, «помогло» не накрутить, почта автора наружу не уходит. */

/* Адрес сервера можно подменить: так один и тот же набор проверок
   гоняется и по боевому Cloudflare, и по новому серверу до переезда.
   API_URL=http://127.0.0.1:8080 node tests/run-all.mjs */
const API = process.env.API_URL || "https://pravofin-api.pravofin.workers.dev";
const O = "https://divine-guest.github.io";
import { makeAdmin, cleanup, sql } from "./_admin.mjs";

const rf = globalThis.fetch;
globalThis.fetch = async (u, i) => {
  let last;
  for (let n = 0; n < 4; n++) {
    try { return await rf(u, i); }
    catch (e) { last = e; await new Promise(r => setTimeout(r, 1500 * (n + 1))); }
  }
  throw last;
};

let pass = 0, fail = 0;
const ok = (c, label, extra = "") => {
  c ? (pass++, console.log("  ✓", label)) : (fail++, console.log("  ✗", label, extra));
};

async function call(path, { method = "GET", body, token } = {}) {
  const r = await fetch(API + path, {
    method,
    headers: {
      Origin: O,
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
}

const st = Date.now();
const em = `qa${st}@test.ru`;

console.log("\n— Автор задаёт вопрос —");
const reg = await call("/api/auth/register", {
  method: "POST", body: { name: "Автор Вопроса", email: em, password: "parol12345" },
});
const t = reg.data.token;
const asked = await call("/api/ai/ask", {
  method: "POST", token: t,
  body: { kind: "chat", prompt: "Нужна ли онлайн-касса самозанятому?", maxTokens: 300 },
});
const jobId = asked.data.id;
ok(Boolean(jobId), "вопрос принят в работу");

let done = null;
for (let i = 0; i < 30; i++) {
  await new Promise(r => setTimeout(r, 2000));
  const s = await call("/api/ai/job?id=" + jobId, { token: t });
  if (s.data.job && s.data.job.status !== "pending") { done = s.data.job; break; }
}
ok(done?.status === "done", `ответ получен: ${done?.status}`, done?.error || "");

console.log("\n— Предложить можно только свой ответ —");
const other = await call("/api/auth/register", {
  method: "POST", body: { name: "Чужой", email: `oth${st}@test.ru`, password: "parol12345" },
});
const steal = await call("/api/qa/offer", {
  method: "POST", token: other.data.token, body: { jobId, topic: "Налоги" },
});
ok(steal.status === 404, `чужой ответ предложить нельзя, код ${steal.status}`);

const anon = await call("/api/qa/offer", { method: "POST", body: { jobId } });
ok(anon.status === 401, "без входа предложить нельзя");

console.log("\n— Автор соглашается опубликовать —");
const offered = await call("/api/qa/offer", {
  method: "POST", token: t, body: { jobId, topic: "Самозанятость" },
});
ok(offered.status === 200 && offered.data.pending, "разбор отправлен на проверку");

const again = await call("/api/qa/offer", {
  method: "POST", token: t, body: { jobId, topic: "Самозанятость" },
});
ok(again.data.already === true, "повторно тот же разбор не дублируется");

console.log("\n— До проверки в ленте пусто —");
const feed0 = await call("/api/qa");
const mineInFeed = (feed0.data.items || []).some(x => x.question.includes("онлайн-касса самозанятому"));
ok(!mineInFeed, "непроверенный разбор в ленту не попал");

console.log("\n— Владелец проверяет —");
const admin = await makeAdmin(call);
const queue = await call("/api/admin/qa", { token: admin.token });
const mine = (queue.data.items || []).find(x => x.question.includes("онлайн-касса самозанятому"));
ok(Boolean(mine), "разбор виден в очереди");
ok(mine?.email === em, "владельцу видно, кто предложил");

const asUser = await call("/api/admin/qa", { token: t });
ok(asUser.status === 403, "обычный пользователь очередь не видит");

/* Формулировку правим под то, как ищут. */
const decided = await call("/api/admin/qa", {
  method: "POST", token: admin.token,
  body: { id: mine.id, action: "publish",
          question: "Нужна ли касса самозанятому в 2026 году?", topic: "Самозанятость" },
});
ok(decided.status === 200 && decided.data.status === "published", "опубликовано");

console.log("\n— Лента отдаёт разбор всем —");
const feed = await call("/api/qa");
const pub = (feed.data.items || []).find(x => x.id === mine.id);
ok(Boolean(pub), "разбор виден в ленте без входа");
ok(pub?.question === "Нужна ли касса самозанятому в 2026 году?", "правка формулировки применилась");
ok(pub && !("email" in pub), "почта автора наружу не уходит");
ok((pub?.answer || "").length > 30, "ответ отдаётся целиком");

const byTopic = await call("/api/qa?topic=Самозанятость");
ok((byTopic.data.items || []).some(x => x.id === mine.id), "фильтр по теме находит");

const bySearch = await call("/api/qa?q=касса");
ok((bySearch.data.items || []).some(x => x.id === mine.id), "поиск по слову находит");

const empty = await call("/api/qa?q=zzznesushchestvuet");
ok((empty.data.items || []).length === 0, "поиск без совпадений возвращает пусто");

console.log("\n— «Помогло» не накрутить —");
const v1 = await call("/api/qa/useful", { method: "POST", token: t, body: { id: mine.id } });
ok(v1.status === 200, "голос учтён");
const v2 = await call("/api/qa/useful", { method: "POST", token: t, body: { id: mine.id } });
ok(v2.data.already === true, "второй раз тем же человеком не считается");

const counted = await sql(`SELECT useful FROM public_qa WHERE id = ${mine.id}`);
ok(Number(counted[0].useful) === 1, `счётчик равен 1: ${counted[0].useful}`);

const anonVote = await call("/api/qa/useful", { method: "POST", body: { id: mine.id } });
ok(anonVote.status === 401, "без входа голосовать нельзя");

console.log("\n— Отклонённый разбор в ленту не попадает —");
const asked2 = await call("/api/ai/ask", {
  method: "POST", token: t, body: { kind: "chat", prompt: "Что такое ОКВЭД?", maxTokens: 120 },
});
for (let i = 0; i < 30; i++) {
  await new Promise(r => setTimeout(r, 2000));
  const s = await call("/api/ai/job?id=" + asked2.data.id, { token: t });
  if (s.data.job?.status !== "pending") break;
}
await call("/api/qa/offer", { method: "POST", token: t, body: { jobId: asked2.data.id } });
const q2 = await call("/api/admin/qa", { token: admin.token });
const second = (q2.data.items || []).find(x => x.question.includes("ОКВЭД"));
if (second) {
  await call("/api/admin/qa", { method: "POST", token: admin.token,
    body: { id: second.id, action: "reject" } });
  const feed2 = await call("/api/qa");
  ok(!(feed2.data.items || []).some(x => x.id === second.id), "отклонённый в ленту не попал");
} else {
  ok(false, "второй разбор не дошёл до очереди");
}

/* Убираем за собой. */
await sql(`DELETE FROM qa_useful WHERE email LIKE '%${st}@test.ru'`);
await sql(`DELETE FROM public_qa WHERE email LIKE '%${st}@test.ru'`);
await sql(`DELETE FROM ai_jobs WHERE email LIKE '%${st}@test.ru'`);
await cleanup(admin.email);

console.log(`\nИТОГО: ${pass} пройдено, ${fail} провалено\n`);
process.exit(fail ? 1 : 0);
