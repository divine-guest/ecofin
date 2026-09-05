/* ============ ЭкоФин — локальный стенд ============

   Один адрес для страниц и для API — ровно так, как на боевом сервере
   делает nginx: /api уходит в Node, остальное отдаётся с диска.

   Зачем это нужно. До сих пор проверить кабинет можно было только на
   боевом сервере: страницы открывались со статического сервера, а API
   жил по другому адресу, и войти было нельзя. Из-за этого проверки
   заводили аккаунты в живой базе — рядом с настоящими людьми и их
   деньгами. Здесь база временная, ломать в ней нечего.

   Запуск:
       node worker/node/dev-server.mjs
   Порт — из PORT (по умолчанию 8770), файл базы — из DB_FILE.
   Каталог со страницами — из SITE (по умолчанию корень репозитория).

   Это инструмент разработки. На боевом сервере он не запускается:
   там раздачей занимается nginx, и делать это дважды незачем.       */

import "./polyfill.mjs";

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { dirname, join, normalize, resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(process.env.SITE || join(HERE, "..", ".."));
const PORT = Number(process.env.PORT || 8770);
const API_PORT = Number(process.env.API_PORT || 8771);

/* API поднимаем как отдельный процесс в этом же файле: сервер из
   server.mjs слушает свой порт, а мы просто переправляем ему всё,
   что начинается с /api. Так его код остаётся нетронутым — то же
   самое, что работает на Cloudflare и на боевой машине. */
process.env.PORT = String(API_PORT);
await import("./server.mjs");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
};

/* Путь с диска — только внутри каталога сайта. Без этой проверки
   «..» в адресе отдал бы что угодно с машины, включая worker/.env
   с ключами. Стенд локальный, но привычка должна быть одна. */
function safePath(url) {
  const clean = decodeURIComponent(url.split("?")[0].split("#")[0]);
  const rel = normalize(clean).replace(/^([/\\])+/, "");
  const full = resolve(SITE, rel);
  return full.startsWith(SITE) ? full : null;
}

async function serveFile(res, file) {
  try {
    const info = await stat(file);
    if (info.isDirectory()) return serveFile(res, join(file, "index.html"));
    const body = await readFile(file);
    res.writeHead(200, {
      "Content-Type": TYPES[extname(file).toLowerCase()] || "application/octet-stream",
      /* Ничего не кешируем: стенд существует ровно затем, чтобы
         правка была видна сразу. */
      "Cache-Control": "no-store",
    });
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

createServer(async (req, res) => {
  if (req.url.startsWith("/api")) {
    /* Переправляем как есть, включая тело и заголовки. */
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;

    const headers = { ...req.headers };
    delete headers.host;
    delete headers["content-length"];

    try {
      const up = await fetch(`http://127.0.0.1:${API_PORT}${req.url}`, {
        method: req.method,
        headers,
        body: ["GET", "HEAD"].includes(req.method) ? undefined : body,
      });
      const out = Buffer.from(await up.arrayBuffer());
      const pass = {};
      up.headers.forEach((v, k) => { if (k !== "content-encoding" && k !== "content-length") pass[k] = v; });
      res.writeHead(up.status, pass);
      res.end(out);
    } catch (e) {
      res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Стенд: API не ответил — " + e.message }));
    }
    return;
  }

  const file = safePath(req.url === "/" ? "/index.html" : req.url);
  if (file && await serveFile(res, file)) return;

  /* Своя страница 404 — та же, что увидит человек на боевом. */
  if (await serveFile(res, join(SITE, "404.html"))) return;
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Не найдено");
}).listen(PORT, "127.0.0.1", () => {
  console.log(`\nСтенд ЭкоФин: http://127.0.0.1:${PORT}`);
  console.log(`  страницы: ${SITE}`);
  console.log(`  API внутри, на порту ${API_PORT}`);
});
