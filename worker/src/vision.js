/* ============ ЭкоФин — распознавание документов ============

   Зачем этот модуль появился.

   Фотографии документов уходили в зарубежную зрячую модель. Это самый
   чувствительный канал сервиса: там паспорта, требования из налоговой,
   чужие договоры — и именно его нельзя защитить маскированием, потому
   что маскирование работает с текстом запроса и внутрь изображения не
   заглядывает. Поставщик пишет об этом прямо.

   Поэтому распознавание переезжает в Россию: Yandex Vision OCR стоит
   в том же облаке, что и сервер, и специализирован на документах —
   понимает строки, блоки и таблицы. Дальше распознанный текст
   разбирает обычная текстовая модель, и к ней уже применимо
   маскирование.

   Побочная выгода: так дешевле. Зрячая модель тарифицируется как
   большой запрос за каждую страницу, OCR — как страница.

   ТРИ ПУТИ, В ЭТОМ ПОРЯДКЕ:

     1. Yandex Vision OCR — если выдан ключ. Точнее всех на кривых
        снимках, понимает структуру документа.
     2. Tesseract на самом сервере — если установлен. Ключей не
        требует, данные не покидают даже машину.
     3. Зарубежная зрячая модель — последней и только если первых
        двух нет.

   Первые два оба внутри России, и второй работает без единого
   действия владельца. То есть по умолчанию изображение страну не
   покидает, а Vision остаётся улучшением, а не условием.           */

import { OCR_SYSTEM } from "./ai.js";
import { VISION_ALLOWED } from "./lib.js";

/* Часть распознавания, которую видит остальной код. */
export function ocrReady(env) {
  return Boolean(env.YC_OCR_KEY && env.YC_FOLDER_ID);
}

/* «data:image/png;base64,AAA...» → { mime, data }.

   Yandex OCR ждёт чистый base64 и отдельным полем тип содержимого,
   а браузер присылает единой строкой. */
function splitDataUrl(url) {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(String(url || ""));
  if (!m) return null;
  return { mime: m[1], data: m[3] };
}

/* Тип содержимого в том виде, в каком его принимает Yandex OCR.
   PDF он читает сам, без превращения в картинки. */
function ocrMime(mime) {
  if (/pdf/i.test(mime)) return "application/pdf";
  if (/png/i.test(mime)) return "image/png";
  return "image/jpeg";
}

/* Одна страница. Синхронная ручка отвечает сразу и подходит нам:
   страниц немного, а ждать результата человек всё равно будет.     */
async function recognizePage(env, dataUrl) {
  const parsed = splitDataUrl(dataUrl);
  if (!parsed) throw new Error("Некорректный формат изображения");

  const res = await fetch("https://ocr.api.cloud.yandex.net/ocr/v1/recognizeText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      /* Ключ сервисного аккаунта, а не IAM-токен: IAM живёт двенадцать
         часов и требует обновления по расписанию, а ключ — нет. */
      Authorization: "Api-Key " + env.YC_OCR_KEY,
      "x-folder-id": env.YC_FOLDER_ID,
      "x-data-logging-enabled": "false",
    },
    body: JSON.stringify({
      content: parsed.data,
      mimeType: ocrMime(parsed.mime),
      languageCodes: ["ru", "en"],
      /* «page» — обычная страница текста. Для бланков и таблиц у
         сервиса есть отдельные модели, но они узкие: документы к нам
         приходят разные, и универсальная модель ошибётся реже, чем
         специализированная не на том виде бумаги. */
      model: "page",
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw Object.assign(new Error("ocr: " + body.slice(0, 200)), { status: res.status });
  }

  const out = await res.json();
  /* Ответ приходит деревом: страницы → блоки → строки → слова.
     Нам нужен связный текст, поэтому собираем построчно. */
  const page = out?.result?.textAnnotation;
  if (page?.fullText) return page.fullText;

  const lines = [];
  for (const block of page?.blocks || [])
    for (const line of block.lines || [])
      lines.push(line.text || (line.words || []).map(w => w.text).join(" "));
  return lines.join("\n");
}

/* Распознать все страницы разом.

   Последовательно, а не параллельно: параллельные запросы упираются
   в ограничение по частоте, и вместо четырёх страниц человек получает
   ошибку на третьей. Разница во времени — секунды, а надёжность
   важнее.                                                           */
export async function recognizeRussian(env, images) {
  const parts = [];
  for (const img of images) parts.push(await recognizePage(env, img));
  return parts.filter(Boolean).join("\n\n");
}

/* ---------- Распознавание на своей машине ----------

   Зачем оно есть, когда есть Yandex Vision OCR.

   Vision требует платёжного аккаунта, сервисного аккаунта и ключа.
   Пока владелец всё это заводит, сервис продолжал бы отправлять
   фотографии документов за границу — а это самое чувствительное, что
   у нас есть: паспорта, требования из налоговой, чужие договоры.

   Tesseract стоит на самом сервере и не требует ничего. Данные не
   покидают даже машину, не то что страну. На чётких сканах он
   справляется; на кривых снимках с бликами Vision заметно лучше,
   поэтому Vision остаётся улучшением, а не условием.

   На Cloudflare Workers процессов нет, поэтому путь доступен только
   под Node. Проверяем это явно, а не ловим исключение: молчаливый
   провал здесь означал бы тихий откат к зарубежной модели.        */

const onNode = typeof process !== "undefined" && Boolean(process?.versions?.node);

let tesseractChecked = false;
let tesseractOk = false;

/* Есть ли tesseract с русским языком. Проверяем один раз за жизнь
   процесса: запускать команду на каждую страницу — лишняя работа. */
export async function localOcrReady() {
  if (!onNode) return false;
  if (tesseractChecked) return tesseractOk;
  tesseractChecked = true;
  try {
    const { execFile } = await import("node:child_process");
    const langs = await new Promise((resolve, reject) => {
      execFile("tesseract", ["--list-langs"], { timeout: 5000 }, (err, out, errOut) =>
        err ? reject(err) : resolve(String(out || "") + String(errOut || "")));
    });
    /* Без русских данных распознавание молча выдаёт латиницу
       вперемешку с мусором — это хуже, чем честный отказ. */
    tesseractOk = /^rus$/m.test(langs);
  } catch {
    tesseractOk = false;
  }
  return tesseractOk;
}

async function recognizeLocalPage(dataUrl) {
  const parsed = splitDataUrl(dataUrl);
  if (!parsed) throw new Error("Некорректный формат изображения");

  const { execFile } = await import("node:child_process");
  const { writeFile, unlink, mkdtemp } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");

  /* Файл во временной папке: tesseract читает с диска. Папка своя на
     каждый вызов — иначе одновременные запросы перетрут файлы друг
     друга, и человек получит чужой документ. */
  const dir = await mkdtemp(join(tmpdir(), "ecofin-ocr-"));
  const src = join(dir, "page");
  await writeFile(src, Buffer.from(parsed.data, "base64"));

  try {
    return await new Promise((resolve, reject) => {
      /* «stdout» вместо файла результата, «-l rus+eng» — в документах
         попадаются латинские слова и номера. */
      execFile("tesseract", [src, "stdout", "-l", "rus+eng", "--psm", "3"],
        { timeout: 60000, maxBuffer: 8 * 1024 * 1024 },
        (err, out) => err ? reject(err) : resolve(String(out || "")));
    });
  } finally {
    await unlink(src).catch(() => {});
  }
}

export async function recognizeLocal(images) {
  const parts = [];
  for (const img of images) parts.push(await recognizeLocalPage(img));
  return parts.filter(t => t.trim()).join("\n\n");
}

/* Сколько символов считать удачным распознаванием.

   Ноль — плохой порог. Tesseract на снимке с бликом или на фотографии
   под углом возвращает не пустоту, а горсть мусорных символов, и по
   ним разбор выдаст уверенный ответ про документ, которого никто не
   видел. Три десятка символов — это примерно строка осмысленного
   текста: меньше не бывает даже у самой короткой справки. */
const MIN_LOCAL_CHARS = 30;

/* Список зрячих моделей живёт в lib.js: он нужен и здесь, и в
   ai.js, где стоит запрет на обращение к чему-то вне списков. */

/* Модель для распознавания: из настроек, если она в списке.

   Незнакомое значение — не повод подставить своё «по умолчанию»:
   владелец что-то имел в виду, и тихая подмена скроет ошибку. Лучше
   отказать в распознавании и написать об этом в журнал. */
export function visionModel(env) {
  const want = String(env.AI_VISION_MODEL || "").trim();
  if (!want) return null;
  if (!VISION_ALLOWED[want]) {
    console.error(
      `vision: модель «${want}» не в списке разрешённых — распознавание отключено. ` +
      `Разрешены: ${Object.keys(VISION_ALLOWED).join(", ")}`);
    return null;
  }
  return want;
}

/* Единая точка для всего кода: распознать страницы в текст.

   Возвращает { text, where } — где «where» говорит, кто распознавал.
   Это нужно не для красоты: политика обещает, что распознавание идёт
   в России, и запасной путь должен быть видим в журнале, а не тихо
   отправлять фото за границу.                                       */
export async function recognize(env, images, { callProvider, fileName = "документ" } = {}) {
  /* Порядок: сначала то, что не покидает страну, и только если не
     вышло — зрячая модель.

     Первые два пути внутри России: облачный Vision точнее на кривых
     снимках, tesseract работает всегда и без единой настройки. На
     чётком скане любого из них достаточно, и снимок никуда не едет. */
  if (ocrReady(env)) {
    return { text: await recognizeRussian(env, images), where: "ru" };
  }

  let localTried = false;
  if (await localOcrReady()) {
    localTried = true;
    const text = await recognizeLocal(images);
    /* Порог не «пусто», а «слишком мало». Tesseract на снимке с бликом
       возвращает не пустоту, а десяток мусорных символов — и разбор по
       такому тексту хуже, чем отсутствие разбора: человек получит
       уверенный ответ по выдуманному документу. */
    if (text.trim().length >= MIN_LOCAL_CHARS) return { text, where: "local" };
  }

  /* Не вышло внутри страны — зрячая модель.

     Вчера этот путь был удалён: он вёл в США, а США в перечень
     государств, обеспечивающих адекватную защиту, не входят (приказ
     Роскомнадзора от 05.08.2022 № 128), и одна неиспользуемая
     возможность потянула бы всё уведомление в тяжёлый режим.

     Китай в перечне, и текстовая модель уже туда ходит. Зрячая модель
     оттуда же — то же государство, тот же получатель, та же строка в
     уведомлении.

     Модель берётся из настроек, но не любая: список разрешённых —
     ниже. Настройка, в которую можно вписать что угодно, однажды
     получит gpt-4o «на попробовать», и снимки паспортов уедут в
     государство, которого нет в нашем уведомлении. */
  const model = visionModel(env);
  if (!model) {
    throw new Error(localTried
      ? "Не удалось разобрать текст на снимке. Попробуйте снять крупнее и без бликов или вставьте текст вручную"
      : "Распознавание снимков сейчас недоступно. Вставьте текст документа вручную — разбор сработает так же");
  }

  /* Обращение к модели заворачиваем: у ключа может не быть доступа
     именно к этой модели, поставщик может отвечать ошибкой, и тогда
     человеку незачем читать «провайдер недоступен» — он загружал
     снимок, а не выбирал поставщика. Причину пишем в журнал. */
  let text;
  try {
    text = await callProvider(env, {
    model,
    messages: [
      { role: "system", content: OCR_SYSTEM },
      { role: "user", content: [
        { type: "text", text: `Файл: ${fileName}. Перепечатай текст со страниц ниже.` },
        ...images.map(url => ({ type: "image_url", image_url: { url } })),
      ] },
    ],
    maxTokens: 3000,
    });
  } catch (e) {
    console.error("vision: модель", model, "не ответила:", e.message);
    throw new Error(
      "Не удалось разобрать текст на снимке. Попробуйте снять крупнее " +
      "и без бликов или вставьте текст вручную");
  }
  return { text, where: "vision" };
}
