/* ============ ЭкоФин — чтение документов из файла и фото ============
   Текст вытаскивается прямо в браузере: до сервера доезжает уже разобранный
   документ, а не сырой файл. Для сканов и фотографий отправляются картинки —
   их читает зрячая модель на стороне сервера. */

const DOCSCAN = {
  MAX_FILE: 15 * 1024 * 1024,   // 15 МБ на файл
  MAX_IMAGES: 4,                // страниц/фото за один разбор
  IMG_SIDE: 1600,               // до какой стороны ужимаем фото перед отправкой
  PDFJS: "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379/pdf.min.mjs",

  /* Возвращает { text, images, fileName } — то, что понимает /api/analyze. */
  async read(file, onProgress = () => {}) {
    if (file.size > this.MAX_FILE) throw new Error("Файл больше 15 МБ — сожмите или разбейте на части");
    const name = file.name || "документ";
    const ext = name.toLowerCase().split(".").pop();

    if (file.type.startsWith("image/")) {
      onProgress("Готовим изображение…");
      return { text: "", images: [await this.imageToDataUrl(file)], fileName: name };
    }
    if (ext === "txt" || ext === "md" || ext === "csv" || file.type.startsWith("text/")) {
      onProgress("Читаем текст…");
      return { text: (await file.text()).slice(0, 12000), images: [], fileName: name };
    }
    if (ext === "docx") {
      onProgress("Разбираем DOCX…");
      return { text: await this.readDocx(file), images: [], fileName: name };
    }
    if (ext === "pdf") {
      onProgress("Разбираем PDF…");
      return await this.readPdf(file, onProgress, name);
    }
    if (ext === "doc") throw new Error("Старый формат .doc не читается. Пересохраните как .docx или .pdf");
    throw new Error("Не понимаю этот формат. Подойдут PDF, DOCX, TXT или фотография");
  },

  /* --- DOCX: это ZIP, а браузер умеет распаковывать deflate сам --- */
  async readDocx(file) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const xml = await this.unzipEntry(buf, "word/document.xml");
    if (!xml) throw new Error("Не нашёл текст внутри DOCX — файл повреждён?");

    const text = new TextDecoder().decode(xml)
      .replace(/<w:p[ >]/g, "\n<w:p ")          // абзацы — переводом строки
      .replace(/<w:tab\/>/g, "\t")
      .replace(/<[^>]+>/g, "")                   // остальную разметку выкидываем
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    if (!text) throw new Error("В документе не нашлось текста");
    return text.slice(0, 12000);
  },

  /* Минимальный чтец ZIP: ищем нужную запись и распаковываем её. */
  async unzipEntry(buf, wanted) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    /* Идём по локальным заголовкам: сигнатура PK\x03\x04 */
    for (let i = 0; i < buf.length - 30; i++) {
      if (dv.getUint32(i, true) !== 0x04034b50) continue;
      const method = dv.getUint16(i + 8, true);
      const compSize = dv.getUint32(i + 18, true);
      const nameLen = dv.getUint16(i + 26, true);
      const extraLen = dv.getUint16(i + 28, true);
      const nameBytes = buf.subarray(i + 30, i + 30 + nameLen);
      const name = new TextDecoder().decode(nameBytes);
      if (name !== wanted) continue;

      const start = i + 30 + nameLen + extraLen;
      /* Размер 0 в локальном заголовке значит «смотри в data descriptor» —
         такие архивы Word не делает, но подстрахуемся, взяв остаток файла. */
      const data = buf.subarray(start, compSize ? start + compSize : buf.length);
      if (method === 0) return data;                       // без сжатия
      if (method !== 8) throw new Error("Неподдерживаемое сжатие внутри DOCX");
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    return null;
  },

  /* --- PDF: сначала пробуем текстовый слой, если пусто — рендерим в картинки --- */
  async readPdf(file, onProgress, name) {
    const pdfjs = await this.loadPdfJs();
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const pages = Math.min(doc.numPages, 10);

    let text = "";
    for (let p = 1; p <= pages; p++) {
      onProgress(`Читаем страницу ${p} из ${pages}…`);
      const content = await (await doc.getPage(p)).getTextContent();
      text += content.items.map(i => i.str).join(" ") + "\n\n";
    }
    text = text.trim();

    /* Меньше 200 символов на весь документ — это скан, а не текст. */
    if (text.length >= 200) return { text: text.slice(0, 12000), images: [], fileName: name };

    onProgress("Похоже на скан — распознаём страницы…");
    const images = [];
    for (let p = 1; p <= Math.min(doc.numPages, this.MAX_IMAGES); p++) {
      const page = await doc.getPage(p);
      const viewport = page.getViewport({ scale: 1 });
      const scale = Math.min(this.IMG_SIDE / Math.max(viewport.width, viewport.height), 2);
      const scaled = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(scaled.width);
      canvas.height = Math.round(scaled.height);
      await page.render({ canvasContext: canvas.getContext("2d"), viewport: scaled }).promise;
      images.push(canvas.toDataURL("image/jpeg", 0.78));
    }
    return { text: "", images, fileName: name };
  },

  async loadPdfJs() {
    if (this._pdfjs) return this._pdfjs;
    try {
      const mod = await import(this.PDFJS);
      mod.GlobalWorkerOptions.workerSrc = this.PDFJS.replace("pdf.min.mjs", "pdf.worker.min.mjs");
      this._pdfjs = mod;
      return mod;
    } catch {
      throw new Error("Не удалось загрузить модуль чтения PDF. Проверьте интернет или пришлите файл в DOCX");
    }
  },

  /* Фото с телефона весит 5–10 МБ; ужимаем, иначе не пролезет в запрос. */
  async imageToDataUrl(file) {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, this.IMG_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();

    for (const q of [0.8, 0.65, 0.5, 0.4]) {
      const url = canvas.toDataURL("image/jpeg", q);
      if (url.length <= 5.5 * 1024 * 1024) return url;
    }
    throw new Error("Фотография слишком большая даже после сжатия — сфотографируйте по частям");
  },
};

/* ============ Приём файла или фотографии в любое поле ============

   Раньше документ можно было приложить ровно в одном месте — в разборе
   договора. Во всех остальных инструментах стояло пустое поле «вставьте
   текст», и человек с бумажной претензией на руках просто уходил:
   перепечатывать две страницы никто не станет.

   Теперь любое текстовое поле умеет принимать файл. PDF, DOCX и TXT
   разбираются прямо в браузере — ничего никуда не уходит и лимит не
   тратится. Фотография и скан без текстового слоя отправляются
   на распознавание: там нужна зрячая модель, и это стоит запуска.

   Использование — одна строка рядом с полем:

       DOCSCAN.attach({ target: "replyText" });

   Полю дописывается зона перетаскивания, кнопка выбора файла и строка
   состояния. Готовый текст подставляется в поле, и человек может его
   поправить перед отправкой — распознавание не бывает идеальным, и
   прятать результат от правки было бы нечестно.                      */

DOCSCAN.attach = function ({ target, label = "" } = {}) {
  const field = document.getElementById(target);
  if (!field || field.dataset.scanReady) return;
  field.dataset.scanReady = "1";

  const box = document.createElement("div");
  box.className = "scan-box";
  box.innerHTML = `
    <button type="button" class="scan-pick">
      <span class="scan-ico" aria-hidden="true">📎</span>
      <span>${label || "Приложить файл или фото документа"}</span>
    </button>
    <span class="scan-hint">PDF, DOCX, TXT или снимок с телефона</span>
    <div class="scan-status" hidden></div>`;

  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".pdf,.docx,.txt,.md,.csv,image/*";
  input.style.display = "none";
  box.appendChild(input);
  field.parentNode.insertBefore(box, field);

  const status = box.querySelector(".scan-status");
  const say = (msg, kind = "") => {
    status.hidden = !msg;
    status.className = "scan-status " + kind;
    status.textContent = msg;
  };

  async function handle(file) {
    if (!file) return;
    if (!PF.user()) {
      toast("Войдите, чтобы прикладывать документы");
      return setTimeout(() => (location.href = PF.href("auth.html")), 1200);
    }
    try {
      say("Открываем файл…");
      const data = await DOCSCAN.read(file, say);

      /* Текстовый слой есть — значит распознавать нечего, всё уже готово
         и бесплатно. Так проходит почти всё, что приходит по почте. */
      if (data.text && data.text.trim().length > 30) {
        put(data.text);
        say(`${file.name}: взято ${data.text.trim().length} символов. Проверьте и правьте, если надо.`, "ok");
        return;
      }

      if (!data.images.length) {
        say("В файле нет ни текста, ни страниц для распознавания", "err");
        return;
      }

      say(`Распознаём ${data.images.length} ${DOCSCAN.pageWord(data.images.length)}… Это занимает до минуты.`);
      const res = await API.ocr({ images: data.images, fileName: data.fileName });
      PF.quota = res.quota || PF.quota;
      put(res.text || "");
      say(`${file.name}: распознано. Сверьте числа и даты — на фото они читаются хуже всего.`, "ok");
      if (typeof renderQuota === "function") renderQuota();
    } catch (e) {
      if (e.isPaywall) { say(""); return showPaywall(e.message); }
      say(e.message, "err");
    }
  }

  /* Дописываем, а не затираем: в поле уже может быть набранное вручную,
     и потерять его из-за случайного перетаскивания обидно. */
  function put(text) {
    const had = field.value.trim();
    field.value = had ? had + "\n\n" + text.trim() : text.trim();
    field.dispatchEvent(new Event("input", { bubbles: true }));
  }

  box.querySelector(".scan-pick").onclick = () => input.click();
  input.onchange = () => handle(input.files[0]);

  /* Перетаскивание вешаем на само поле: туда его и тянут. */
  field.addEventListener("dragover", e => { e.preventDefault(); field.classList.add("scan-over"); });
  field.addEventListener("dragleave", () => field.classList.remove("scan-over"));
  field.addEventListener("drop", e => {
    e.preventDefault();
    field.classList.remove("scan-over");
    handle(e.dataTransfer.files[0]);
  });
};

/* «страницу», «страницы», «страниц» — мелочь, но текст без неё
   выглядит машинным ровно в тот момент, когда человек ждёт. */
DOCSCAN.pageWord = function (n) {
  const a = n % 100, b = a % 10;
  if (a > 10 && a < 20) return "страниц";
  if (b > 1 && b < 5) return "страницы";
  if (b === 1) return "страницу";
  return "страниц";
};
