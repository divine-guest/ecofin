/* ============ ЭкоФин — письма людям ============

   mail.js умеет одно: отправить такой-то текст на такой-то адрес. Здесь
   лежит всё, что вокруг: кому вообще можно писать, как человек
   отказывается от писем и чем заканчивается каждое письмо.

   Писем два вида, и правила у них разные.

   Обычные — напоминание о сроке и сводка недели. Их можно отключить:
   галкой в кабинете или ссылкой из самого письма, без входа. Отключивший
   не получает ни тех, ни других: «отключить письма» должно значить
   именно это, а не «отключить один из трёх видов».

   Служебные — код для смены пароля и предупреждение о списании. Они
   приходят независимо от галки: человек, отказавшийся от напоминаний,
   не отказывался знать, что с его карты спишут деньги.

   Чего в письмах нет — предложений купить. Реклама по почте допускается
   только с предварительного согласия (ст. 18 закона «О рекламе»), а его
   у нас никто не давал: человек ставил себе срок, а не подписывался на
   предложения. Поэтому в письме — его собственные сроки и его подписка,
   и ничего сверх этого.                                               */

import { json, fail } from "./lib.js";
import { mailReady, sendMail, canMailTo } from "./mail.js";
import { logAction } from "./auth.js";

const siteOf = env => String(env.SITE_URL || "https://ecofin26.ru").replace(/\/+$/, "");

/* Ключ ссылки «отключить письма». Заводится при первом письме, а не при
   регистрации: у большинства он не понадобится никогда. */
async function tokenFor(env, user) {
  if (user.mail_token) return user.mail_token;
  const token = [...crypto.getRandomValues(new Uint8Array(18))]
    .map(b => b.toString(16).padStart(2, "0")).join("");
  /* Условие в запросе — на случай двух писем одному человеку в одну
     секунду: ключ останется тот, что записался первым. */
  await env.DB.prepare(
    "UPDATE users SET mail_token = ? WHERE email = ? AND (mail_token IS NULL OR mail_token = '')"
  ).bind(token, user.email).run();
  const row = await env.DB.prepare("SELECT mail_token FROM users WHERE email = ?")
    .bind(user.email).first();
  return (row && row.mail_token) || token;
}

/* Письмо человеку. user — строка из users: нужны email, name, mail_off,
   mail_token. Возвращает { ok } или { ok: false, reason } и не бросает.

     subject  тема
     lines    строки письма, без приветствия и подписи
     link     страница сайта, куда вести («dashboard.html#reminders»)
     service  служебное: приходит и тем, кто отключил письма            */
export async function sendLetter(env, user, { subject, lines, link = "", linkLabel = "", service = false }) {
  if (!mailReady(env)) return { ok: false, reason: "not_configured" };
  if (!user || !canMailTo(env, user.email)) return { ok: false, reason: "foreign" };
  if (!service && user.mail_off) return { ok: false, reason: "off" };

  const site = siteOf(env);
  const text = [`Здравствуйте${user.name ? ", " + user.name : ""}.`, "", ...lines];
  if (link) text.push("", `${linkLabel || "Открыть в ЭкоФине"}: ${site}/${link}`);
  text.push("");

  let headers;
  if (service) {
    text.push("Это служебное письмо о вашей подписке. Оно приходит независимо",
              "от настроек уведомлений.");
  } else {
    const token = await tokenFor(env, user).catch(() => "");
    /* Без ключа письмо не шлём вовсе: письмо, от которого нельзя
       отказаться, хуже ненаписанного. */
    if (!token) return { ok: false, reason: "no_token" };
    text.push("Вы получаете напоминания ЭкоФина, потому что зарегистрированы в сервисе.",
              `Отключить письма: ${site}/unsubscribe.html#${token}`);
    /* Кнопка «Отписаться» в самих почтовых сервисах. Они нажимают её
       запросом POST, а ссылки из писем заранее открывают только GET —
       поэтому случайной отписки от проверки письма не случится. */
    headers = {
      "List-Unsubscribe": `<${site}/api/mail/unsubscribe?t=${token}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    };
  }
  text.push("", "ЭкоФин — финансы, налоги и право", site);

  return sendMail(env, { to: user.email, subject: String(subject).slice(0, 150), text: text.join("\n"), headers });
}

/* GET /api/mail — что с письмами у этого человека. */
export async function status(request, env, origin, user) {
  return json(env, origin, {
    /* Придут ли письма вообще: почта подключена и адрес российский. */
    enabled: mailReady(env) && canMailTo(env, user.email),
    /* Адрес зарубежный — причина, которую человек может устранить сам. */
    foreign: !canMailTo(env, user.email),
    off: Boolean(user.mail_off),
    address: user.email,
  });
}

/* POST /api/mail {off} — включить или выключить письма из кабинета. */
export async function setMail(request, env, origin, user) {
  const b = await request.json().catch(() => ({}));
  const off = b.off ? 1 : 0;
  await env.DB.prepare("UPDATE users SET mail_off = ? WHERE email = ?")
    .bind(off, user.email).run();
  await logAction(env, user.email, off ? "Письма на почту отключены" : "Письма на почту включены");
  return json(env, origin, { off: Boolean(off) });
}

/* POST /api/mail/unsubscribe — отказ от писем по ссылке, без входа.

   Ключ приходит в теле (со страницы unsubscribe.html) или в адресе
   (кнопка «Отписаться» почтового сервиса). Тем же ключом письма можно
   вернуть — на случай, если нажали по ошибке. Больше ключ не открывает
   ничего: ни адреса, ни имени в ответе нет.                           */
export async function unsubscribe(request, env, origin) {
  const url = new URL(request.url);
  const b = await request.json().catch(() => ({}));
  const token = String(url.searchParams.get("t") || (b && b.token) || "").trim().toLowerCase();
  const stale = "Ссылка устарела или скопирована не полностью. Отключить письма можно в кабинете: «Настройки» → «Уведомления»";
  if (!/^[0-9a-f]{36}$/.test(token)) return fail(env, origin, stale, 400);

  const row = await env.DB.prepare("SELECT email FROM users WHERE mail_token = ?").bind(token).first();
  if (!row) return fail(env, origin, stale, 404);

  const on = Boolean(b && b.on === true);
  await env.DB.prepare("UPDATE users SET mail_off = ? WHERE email = ?")
    .bind(on ? 0 : 1, row.email).run();
  await logAction(env, row.email, on ? "Письма включены по ссылке из письма" : "Письма отключены по ссылке из письма")
    .catch(() => {});
  return json(env, origin, { off: !on });
}
