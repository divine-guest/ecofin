/* Собирает ОДНУ строку, которую можно вставить в Cloud Shell.

   Зачем. Многострочная вставка в терминал ненадёжна: часть строк
   теряется молча, и файл ключей выходит пустым или обрезанным. А
   загрузки файлов в Cloud Shell может не быть вовсе.

   Одна строка вставляется нормально. Поэтому ключи упаковываются
   в base64 — там нет ни переносов, ни кавычек, ни кириллицы, — и
   получается готовая команда, которая сама разложит их обратно
   и сразу покажет, сколько получилось.

   Запуск:
       node worker/node/make-oneliner.mjs
   Результат:
       worker/node/oneliner.txt   — открыть, скопировать целиком (Ctrl+A,
                                    Ctrl+C) и вставить в Cloud Shell        */

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKER = join(HERE, "..");

let env;
try {
  env = await readFile(join(WORKER, ".env"), "utf8");
} catch {
  console.error("Не нашёл worker/.env");
  process.exit(1);
}

/* Оставляем только строки вида КЛЮЧ=значение: комментарии и пустые
   строки на сервере не нужны, а размер строки лучше не раздувать. */
const lines = env
  .replace(/\r\n?/g, "\n")
  .split("\n")
  .map(l => l.trim())
  .filter(l => l && !l.startsWith("#") && /^[A-Z][A-Z0-9_]*=/.test(l));

const packed = Buffer.from(lines.join("\n") + "\n", "utf8").toString("base64");

/* Готовая команда: разложить обратно, проверить и сразу сказать,
   сколько ключей получилось. Если число не сойдётся — видно сразу,
   а не через пять минут на неработающей машине. */
const command =
  `echo '${packed}' | base64 -d > ~/pravofin.env && ` +
  `echo "ключей получилось: $(grep -c = ~/pravofin.env)"`;

const file = join(HERE, "oneliner.txt");
await writeFile(file, command + "\n", "utf8");

console.log("Готово:", file);
console.log("Ключей упаковано:", lines.length);
console.log("Длина строки:", command.length, "символов");
console.log("");
console.log("Что дальше:");
console.log("  1. Откройте этот файл, выделите всё (Ctrl+A) и скопируйте.");
console.log("  2. Вставьте в Cloud Shell одной строкой и нажмите Enter.");
console.log(`  3. Должно ответить: ключей получилось: ${lines.length}`);
console.log("");
console.log("Файл содержит ключи — не пересылайте его. В .gitignore он закрыт.");
