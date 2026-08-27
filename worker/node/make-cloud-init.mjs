/* Готовит файл, который владелец вставляет при создании машины.

   Зачем отдельный скрипт: в настройку надо положить секреты — ключ ИИ,
   токен Telegram, ключи ЮKassa. В репозиторий их класть нельзя, а
   просить человека вписывать вручную — значит гарантированно получить
   опечатку в ключе и полдня поисков.

   Поэтому: образец лежит в репозитории открыто, а этот скрипт
   подставляет в него содержимое worker/.env и кладёт результат рядом,
   в файл, который в git не попадает.

   Запуск:
       node worker/node/make-cloud-init.mjs
   Результат:
       worker/node/cloud-init.ready.yaml   — открыть, скопировать целиком
                                             и вставить в поле метаданных   */

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKER = join(HERE, "..");

const template = await readFile(join(HERE, "cloud-init.yaml"), "utf8");

let env;
try {
  env = await readFile(join(WORKER, ".env"), "utf8");
} catch {
  console.error("Не нашёл worker/.env — без него сервер запустится без ключей.");
  process.exit(1);
}

const lines = env
  .replace(/\r\n?/g, "\n")
  .split("\n")
  .map(l => l.trimEnd())
  .filter(l => l && !l.startsWith("#") && /^[A-Z][A-Z0-9_]*=/.test(l));

/* Ключи уходят в base64, а не текстом.

   Не ради скрытности — файл всё равно лежит только на самой машине с
   правами 600. Ради сохранности: по дороге через YAML и cloud-init текст
   может пострадать. Мы это уже видели — из настройки nginx исчезла
   переменная $uri, и сервер не запустился. В значении ключа доллар или
   обратная косая вполне могут встретиться, и тогда сломался бы вход
   в кабинет, а понять почему было бы почти невозможно.

   В base64 нет ни долларов, ни кавычек, ни кириллицы — портить нечего.
   Разворачивает обратно сама машина, первой же командой. */
const packed = Buffer.from(lines.join("\n") + "\n", "utf8").toString("base64");
const wrapped = (packed.match(/.{1,76}/g) || [])
  .map(l => "      " + l).join("\n").trimStart();

const out = template.replace("      __WORKER_ENV_B64__", "      " + wrapped);

const file = join(HERE, "cloud-init.ready.yaml");
await writeFile(file, out, "utf8");

const names = lines.map(l => l.split("=")[0]);
console.log("Готово:", file);
console.log("Переменных внутри:", names.length);
console.log("  " + names.join(", "));
console.log("\nЧто дальше:");
console.log("  1. Откройте этот файл и скопируйте его целиком.");
console.log("  2. При создании машины в Yandex Cloud раскройте «Метаданные».");
console.log("  3. Вставьте в поле user-data и создайте машину.");
console.log("\nФайл содержит ключи — не пересылайте его и не кладите в репозиторий.");
console.log("В .gitignore он уже закрыт.");
