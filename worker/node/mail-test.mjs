/* ============ Пробное письмо с сервера ============

     node worker/node/mail-test.mjs /opt/pravofin/env [кому]
     … | node worker/node/mail-test.mjs - [кому]

   Отвечает одной строкой: MAIL_OK, MAIL_FAIL причина или NOT_CONFIGURED.

   Зачем. Пароль от почтового ящика владелец кладёт на сервер со своего
   компьютера (vps-secret.sh). Неверный пароль на сервере хуже, чем
   никакого: сайт покажет форму «пришлём код», а письмо не уйдёт. Поэтому
   настройки проверяются ДО сохранения — настоящим письмом с этого же
   сервера, в сам ящик.

   Первый способ читает сохранённый файл настроек, второй (с дефисом) —
   настройки из потока, ещё не сохранённые. Разбор строк тот же, что у
   сервера (server.mjs, loadEnvFile): проверка должна видеть значение
   ровно таким, каким его потом увидит сервис. */

import { readFile } from "node:fs/promises";
import { smtpConfigured, makeSmtpSender } from "./mail-smtp.mjs";

const [source = "", to = ""] = process.argv.slice(2);

async function text() {
  if (source !== "-") return readFile(source, "utf8");
  let all = "";
  for await (const chunk of process.stdin) all += chunk;
  return all;
}

let cfg = {};
try {
  cfg = Object.fromEntries(
    (await text()).split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => l && !l.startsWith("#"))
      .map(l => {
        const i = l.indexOf("=");
        return i < 0 ? null : [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
      })
      .filter(Boolean)
  );
} catch {
  console.log("NOT_CONFIGURED");
  process.exit(2);
}

if (!smtpConfigured(cfg)) {
  console.log("NOT_CONFIGURED");
  process.exit(2);
}

const send = makeSmtpSender(cfg);
const r = await send({
  to: to || cfg.MAIL_SMTP_USER,
  subject: "ЭкоФин: почта подключена",
  text: [
    "Это пробное письмо с сервера ЭкоФина.",
    "",
    "Раз вы его читаете, сервис может отправлять письма: код для смены",
    "забытого пароля теперь придёт человеку на почту.",
    "",
    "Отвечать на это письмо не нужно.",
  ].join("\n"),
});

console.log(r.ok ? "MAIL_OK" : "MAIL_FAIL " + (r.reason || "provider"));
process.exit(r.ok ? 0 : 1);
