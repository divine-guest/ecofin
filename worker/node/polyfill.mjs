/* Различия между Cloudflare Workers и Node, которые надо закрыть до
   того, как загрузится код сервера.

   Их немного, но каждое всплывает не при запуске, а при первом живом
   запросе — и выглядит как «внутренняя ошибка сервера» без объяснений.

   crypto. В Workers это глобальный объект. В Node он стал глобальным
   только с двадцатой версии, а до неё лежал в node:crypto под именем
   webcrypto. На нём держатся пароли (PBKDF2), токены сессий и номера
   платежей — то есть регистрация просто падала бы.

   Файл подключается ПЕРВЫМ, до импорта воркера: модули выполняются
   в порядке импорта, и к моменту загрузки worker/src всё уже на месте. */

import { webcrypto } from "node:crypto";

if (!globalThis.crypto) {
  globalThis.crypto = webcrypto;
}

/* На всякий случай проверяем то, чем реально пользуется код. Лучше
   не запуститься с понятной причиной, чем упасть на первом посетителе. */
const need = [
  ["crypto.subtle", () => globalThis.crypto?.subtle],
  ["crypto.getRandomValues", () => globalThis.crypto?.getRandomValues],
  ["crypto.randomUUID", () => globalThis.crypto?.randomUUID],
  ["fetch", () => globalThis.fetch],
  ["Request", () => globalThis.Request],
  ["Response", () => globalThis.Response],
  ["Headers", () => globalThis.Headers],
  ["btoa", () => globalThis.btoa],
  ["atob", () => globalThis.atob],
  ["AbortSignal.timeout", () => globalThis.AbortSignal?.timeout],
];

const missing = need.filter(([, get]) => !get()).map(([name]) => name);
if (missing.length) {
  console.error(
    "В этой версии Node не хватает: " + missing.join(", ") +
    "\nНужен Node 18 или новее (на сервере ставим 22)."
  );
  process.exit(1);
}
