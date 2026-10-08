/* ============ ЭкоФин — отправка писем ============

   Почему провайдер обязан быть российским.

   Адрес человека — персональные данные. Отправить письмо через
   SendGrid, Resend или Mailgun значит передать их в США, то есть
   совершить трансграничную передачу. Уведомление в Роскомнадзор подано
   по одному направлению и только для языковой модели; почта в него не
   входит. Поэтому здесь российский сервис, а адрес API вынесен в
   настройки: сменить провайдера можно выкладкой, не трогая код.

   Модуль намеренно ничего не знает про пароли и коды: он умеет только
   «отправь такой-то текст на такой-то адрес». Письмо с кодом и письмо
   с напоминанием идут одной дорогой, и чинить её потом придётся в одном
   месте, а не в двух.

   Настройки живут в worker/.env на сервере:

     MAIL_API_KEY    ключ провайдера. Секрет: в репозиторий не попадает
                     никогда, кладётся на машину отдельно.
     MAIL_FROM       адрес отправителя на нашем домене
     MAIL_FROM_NAME  подпись отправителя, по умолчанию «ЭкоФин»
     MAIL_API_URL    адрес API, по умолчанию Unisender Go

   Второй путь — обычный почтовый ящик на нашем домене (SMTP). Его
   собирает сервер при запуске и кладёт в окружение готовой функцией
   MAIL_SEND: этот файл не знает про сетевые соединения и библиотеки и
   знать не должен. Подробности — в worker/node/mail-smtp.mjs. Если заданы
   оба пути, выбирается ящик: он настраивается осознанно и позже.

   Пока нет ни ключа, ни ящика, mailReady() отвечает «нет», и сервис ведёт себя так,
   будто почты не существует: показывать форму «пришлём код», после
   которой ничего не приходит, хуже, чем честно отправить человека к
   ручному восстановлению.                                            */

/* Unisender Go: российский сервис, письма уходят с наших серверов
   через их API. Ключ выдаётся в личном кабинете, раздел безопасности. */
const DEFAULT_URL = "https://goapi.unisender.ru/ru/transactional/api/v1/email/send.json";

export function mailReady(env) {
  if (!env) return false;
  if (typeof env.MAIL_SEND === "function") return true;
  return Boolean(env.MAIL_API_KEY && env.MAIL_FROM);
}

/* Возвращает { ok } и никогда не бросает: письмо — не та вещь, из-за
   которой должен падать запрос целиком. Решение, что делать с неудачей,
   принимает вызывающий: коду сброса пароля молчать нельзя, а
   напоминанию — можно. */
export async function sendMail(env, { to, subject, text }) {
  if (!mailReady(env)) return { ok: false, reason: "not_configured" };

  /* Почтовый ящик. Функция сама ловит свои ошибки, но страхуемся:
     письмо не должно уронить запрос, каким бы путём оно ни шло. */
  if (typeof env.MAIL_SEND === "function") {
    try {
      const r = await env.MAIL_SEND({ to, subject, text });
      return r && r.ok ? { ok: true } : { ok: false, reason: (r && r.reason) || "provider" };
    } catch (e) {
      console.error("mail: отправка через ящик", e && e.message ? e.message : "");
      return { ok: false, reason: "provider" };
    }
  }

  const payload = {
    message: {
      recipients: [{ email: to }],
      subject,
      body: { plaintext: text },
      from_email: env.MAIL_FROM,
      from_name: env.MAIL_FROM_NAME || "ЭкоФин",
      /* Письмо служебное — ответ на действие самого человека, а не
         рассылка. Отписки у него быть не должно: отписавшийся от
         рассылки не сможет восстановить пароль. */
      skip_unsubscribe: 1,
    },
  };

  try {
    const r = await fetch(env.MAIL_API_URL || DEFAULT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": env.MAIL_API_KEY,
      },
      body: JSON.stringify(payload),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || (data.status && data.status !== "success")) {
      /* В журнал — код и сообщение провайдера, но не адрес и не текст
         письма: журналы читают шире, чем почту. */
      console.error("mail: провайдер отказал", r.status, data.message || data.status || "");
      return { ok: false, reason: "provider" };
    }
    return { ok: true };
  } catch (e) {
    console.error("mail: сеть", e.message);
    return { ok: false, reason: "network" };
  }
}
