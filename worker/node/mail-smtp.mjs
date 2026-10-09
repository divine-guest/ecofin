/* ============ Отправка писем через обычный почтовый ящик ============

   Второй путь доставки писем, рядом с сервисом рассылок из
   worker/src/mail.js. Появился в октябре 2026-го: владелец спросил, нельзя
   ли обойтись почтой рег.ру, где уже лежат и домен, и сервер. Можно.

   Чем этот путь хорош: один кабинет вместо двух, ящик заодно принимает
   ответы, записи домена хостинг ставит сам, а суточного лимита обычного
   ящика (у рег.ру — около трёх тысяч писем) хватает и на сброс паролей,
   и на напоминания для первых сотен людей.

   Чем он хуже: это почтовый ящик, а не служба рассылок. Когда писем
   станут тысячи в день, почтовые сервисы начнут придерживать их как
   рассылку с чужого адреса. Тогда — сервис рассылок; mail.js умеет оба
   пути, и переключение — это замена ключей, а не кода.

   Почему файл лежит здесь, а не в worker/src. Там код, который не знает,
   где он запущен, и обходится одним fetch. SMTP — это сетевые соединения
   Node и отдельная библиотека. Сервер при запуске собирает из настроек
   функцию отправки и кладёт её в окружение под именем MAIL_SEND; mail.js
   видит функцию и зовёт её, не зная, что внутри.

   Настройки (в /opt/pravofin/env на сервере, кладутся vps-secret.sh):

     MAIL_SMTP_HOST   сервер исходящей почты — из настроек ящика у хостера
     MAIL_SMTP_PORT   465 (по умолчанию) или 587
     MAIL_SMTP_USER   адрес ящика целиком
     MAIL_SMTP_PASS   пароль ящика. Секрет
     MAIL_FROM        от чьего имени письмо; по умолчанию — сам ящик
     MAIL_REPLY_TO    куда придёт ответ человека, если не в тот же ящик  */

export function smtpConfigured(cfg) {
  return Boolean(cfg && cfg.MAIL_SMTP_HOST && cfg.MAIL_SMTP_USER && cfg.MAIL_SMTP_PASS);
}

/* Возвращает функцию отправки. Она никогда не бросает: отвечает
   { ok } или { ok: false, reason } — так же, как отправка через сервис. */
export function makeSmtpSender(cfg) {
  let transport = null;

  /* Соединение создаём при первом письме, а не при запуске сервера.
     Библиотека подгружается здесь же: если она не установилась, сервис
     поднимется и будет работать без писем, а не упадёт целиком. */
  async function getTransport() {
    if (transport) return transport;
    const mod = await import("nodemailer");
    const createTransport = (mod.default || mod).createTransport;
    const port = Number(cfg.MAIL_SMTP_PORT || 465);
    /* MAIL_SMTP_INSECURE — только для проверок: подставной почтовый
       сервер шифрования не умеет. На боевом сервере не задаётся. */
    const plain = String(cfg.MAIL_SMTP_INSECURE || "") === "1";
    transport = createTransport({
      host: cfg.MAIL_SMTP_HOST,
      port,
      secure: !plain && port === 465,       // 465 — шифрование с первого байта
      requireTLS: !plain && port !== 465,   // 587 — обязательный переход на шифрование
      ignoreTLS: plain,
      auth: { user: cfg.MAIL_SMTP_USER, pass: cfg.MAIL_SMTP_PASS },
      /* Письмо не должно держать запрос человека дольше полминуты:
         он ждёт у формы «пришлём код». */
      connectionTimeout: 15000,
      greetingTimeout: 15000,
      socketTimeout: 20000,
    });
    return transport;
  }

  return async function send({ to, subject, text, headers }) {
    try {
      const t = await getTransport();
      const from = cfg.MAIL_FROM || cfg.MAIL_SMTP_USER;
      await t.sendMail({
        from: { name: cfg.MAIL_FROM_NAME || "ЭкоФин", address: from },
        to,
        subject,
        text,
        ...(cfg.MAIL_REPLY_TO ? { replyTo: cfg.MAIL_REPLY_TO } : {}),
        ...(headers && typeof headers === "object" ? { headers } : {}),
      });
      return { ok: true };
    } catch (e) {
      /* В журнал — код ошибки и ответ почтового сервера цифрой, но не
         адрес и не текст письма: журналы читают шире, чем почту. */
      console.error("mail: smtp", e && e.code ? e.code : "", e && e.responseCode ? e.responseCode : "");
      /* Соединение могло умереть — в следующий раз откроем новое. */
      transport = null;
      const auth = e && (e.code === "EAUTH" || e.responseCode === 535);
      return { ok: false, reason: auth ? "auth" : "provider" };
    }
  };
}
