/* ============ ЭкоФин — партнёрские предложения ============

   Что здесь решается.

   Ссылка партнёра, наименование рекламодателя и токен маркировки erid
   лежали прямо в js/partners.js. Чтобы включить партнёрку, владельцу
   нужно было открыть файл с кодом, вписать три поля и выкатить сайт.
   Он не разработчик — значит отложит, и заготовка останется
   заготовкой. А это единственный доход, который не требует ни
   подписчиков, ни его времени: банк платит за одного приведённого ИП
   больше, чем стоит годовая подписка.

   Тексты предложений остаются в коде — они часть содержания сайта.
   Здесь только то, что приходит из партнёрского договора: ссылка,
   рекламодатель, маркировка, включено или нет.

   ПРО МАРКИРОВКУ. Партнёрская ссылка — это реклама по 38-ФЗ, и с
   2022 года интернет-реклама подлежит маркировке: креатив
   регистрируется у оператора рекламных данных, тот выдаёт токен erid.
   Штраф за рекламу без маркировки — до 500 000 ₽ (ст. 14.3 КоАП).
   Поэтому предложение не показывается, пока не заполнены все три
   поля, и проверяет это сервер, а не браузер.                       */

import { json, fail, now } from "./lib.js";
import { logAction } from "./auth.js";

const MAX_LEN = 500;

/* Токен erid выдаёт ОРД, и выглядит он всегда одинаково: буквы,
   цифры и дефисы. Проверка не подтверждает подлинность — она ловит
   опечатку и вставленный кусок ссылки вместо токена. */
const ERID_OK = /^[A-Za-z0-9_-]{6,64}$/;

const out = r => ({
  id: r.id,
  url: r.url,
  advertiser: r.advertiser,
  erid: r.erid,
  enabled: Boolean(r.enabled),
  ready: Boolean(r.url && r.advertiser && r.erid),
  clicks: r.clicks || 0,
  shows: r.shows || 0,
});

/* GET /api/partners — что показывать посетителю.

   Отдаём только полностью готовые и включённые: решение о показе
   принимает сервер. В браузере это правило можно обойти правкой в
   консоли, а цена ошибки — штраф за рекламу без маркировки. */
export async function list(request, env, origin) {
  const rows = await env.DB.prepare(
    "SELECT * FROM partner_offers WHERE enabled = 1 AND url != '' AND advertiser != '' AND erid != ''"
  ).all();
  return json(env, origin, {
    offers: (rows.results || []).map(r => ({
      id: r.id, url: r.url, advertiser: r.advertiser, erid: r.erid,
    })),
  });
}

/* POST /api/partners/click {id} — переход по ссылке.

   Без счётчика владелец не может ни поговорить с партнёром о ставке,
   ни понять, работает ли предложение вообще. Считаем на сервере:
   счётчик в браузере не переживает закрытие вкладки.

   Ответ пустой и быстрый — переход не должен ждать записи. */
export async function click(request, env, origin) {
  const b = await request.json().catch(() => ({}));
  const id = String(b.id || "").slice(0, 40);
  if (!id) return json(env, origin, { ok: true });
  await env.DB.prepare(
    "UPDATE partner_offers SET clicks = clicks + 1 WHERE id = ?"
  ).bind(id).run();
  return json(env, origin, { ok: true });
}

/* POST /api/partners/shown {ids:[…]} — блок показан.

   Нужен, чтобы считать не только переходы, но и отношение переходов
   к показам: два перехода из десяти показов и два из тысячи — разные
   новости, и разговор с партнёром о них разный. */
export async function shown(request, env, origin) {
  const b = await request.json().catch(() => ({}));
  const ids = Array.isArray(b.ids) ? b.ids.slice(0, 20) : [];
  for (const raw of ids) {
    const id = String(raw || "").slice(0, 40);
    if (id) await env.DB.prepare("UPDATE partner_offers SET shows = shows + 1 WHERE id = ?").bind(id).run();
  }
  return json(env, origin, { ok: true });
}

/* GET /api/admin/partners — всё, включая незаполненное. */
export async function adminList(request, env, origin) {
  const rows = await env.DB.prepare("SELECT * FROM partner_offers ORDER BY id").all();
  return json(env, origin, { offers: (rows.results || []).map(out) });
}

/* POST /api/admin/partners {id, url, advertiser, erid, enabled} */
export async function adminSave(request, env, origin, admin) {
  const b = await request.json().catch(() => ({}));
  const id = String(b.id || "").trim().slice(0, 40);
  if (!id) return fail(env, origin, "Не указано, какое предложение сохраняем");

  const url = String(b.url || "").trim().slice(0, MAX_LEN);
  const advertiser = String(b.advertiser || "").trim().slice(0, MAX_LEN);
  const erid = String(b.erid || "").trim().slice(0, 64);
  const enabled = b.enabled ? 1 : 0;

  /* Ссылка обязана быть внешней и по https: партнёрские ссылки
     всегда такие, а http внутри страницы по https просто не
     откроется — человек увидит пустую вкладку и решит, что сломано. */
  if (url && !/^https:\/\/\S+$/i.test(url))
    return fail(env, origin, "Ссылка должна начинаться с https://");

  if (erid && !ERID_OK.test(erid))
    return fail(env, origin, "Токен erid выглядит неверно: ожидаются буквы, цифры и дефисы");

  /* Включить можно только полностью заполненное. Это не придирка:
     показ рекламы без маркировки стоит до 500 000 ₽, и запрет должен
     стоять на сервере, а не в форме, где его видно только глазами. */
  if (enabled && !(url && advertiser && erid)) {
    return fail(env, origin,
      "Чтобы включить показ, нужны все три поля: ссылка, рекламодатель и токен erid. " +
      "Реклама без маркировки — штраф до 500 000 ₽ по ст. 14.3 КоАП");
  }

  await env.DB.prepare(
    "INSERT INTO partner_offers (id, url, advertiser, erid, enabled, updated_at)" +
    " VALUES (?1, ?2, ?3, ?4, ?5, ?6)" +
    " ON CONFLICT(id) DO UPDATE SET url = ?2, advertiser = ?3, erid = ?4," +
    "                               enabled = ?5, updated_at = ?6"
  ).bind(id, url, advertiser, erid, enabled, now()).run();

  await logAction(env, admin.email,
    `${enabled ? "Включено" : "Сохранено"} партнёрское предложение: ${id}`);

  const row = await env.DB.prepare("SELECT * FROM partner_offers WHERE id = ?").bind(id).first();
  return json(env, origin, { offer: out(row) });
}
