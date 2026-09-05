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

   Пока ключ не задан, работает прежний путь через зрячую модель:
   выкатывать код, который ломает распознавание до получения ключа,
   нельзя.                                                           */

import { OCR_SYSTEM } from "./ai.js";

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

/* Единая точка для всего кода: распознать страницы в текст.

   Возвращает { text, where } — где «where» говорит, кто распознавал.
   Это нужно не для красоты: политика обещает, что распознавание идёт
   в России, и запасной путь должен быть видим в журнале, а не тихо
   отправлять фото за границу.                                       */
export async function recognize(env, images, { callProvider, fileName = "документ" } = {}) {
  if (ocrReady(env)) {
    return { text: await recognizeRussian(env, images), where: "ru" };
  }

  /* Запасной путь, пока ключ не выдан. */
  const text = await callProvider(env, {
    model: env.AI_VISION_MODEL || "gpt-4o-mini",
    messages: [
      { role: "system", content: OCR_SYSTEM },
      { role: "user", content: [
        { type: "text", text: `Файл: ${fileName}. Перепечатай текст со страниц ниже.` },
        ...images.map(url => ({ type: "image_url", image_url: { url } })),
      ] },
    ],
    maxTokens: 3000,
  });
  return { text, where: "vision" };
}
