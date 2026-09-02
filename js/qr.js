/* ============ ЭкоФин — QR-код прямо в браузере ============

   Зачем свой код вместо готовой картинки по ссылке.

   Раньше QR для счёта рисовал чужой сервис: адрес картинки был
   https://api.qrserver.com/...?data=ST00012|Name=…|PersonalAcc=…
   То есть название компании, номер расчётного счёта, банк и сумма
   уезжали в адресной строке на зарубежный сервер — при каждом открытии
   счёта, у каждого пользователя, без его ведома.

   Это плохо сразу с трёх сторон:
     • закон — сервис обещает хранить данные россиян в России, а тут
       банковские реквизиты уходят третьему лицу за границу;
     • надёжность — сервис недоступен, и в счёте вместо QR битая картинка;
     • деньги — номер счёта в чужих журналах это ровно то, чем пользуются
       при подмене реквизитов.

   Здесь всё считается на месте. Ничего никуда не уходит, работает без
   сети и не зависит от чужого сервиса.

   Что реализовано: байтовый режим (нужен для кириллицы в UTF-8),
   уровень коррекции M, версии 1–20 — с запасом для строки СБП.

   Использование:
       QR.svg("текст")        → строка с готовым <svg>
       QR.matrix("текст")     → двумерный массив true/false
*/

const QR = (() => {

  /* ---------- Арифметика Галуа GF(256) ----------
     Коды Рида — Соломона считаются в поле из 256 элементов: умножение
     там не обычное, поэтому заранее строим таблицы логарифмов. */
  const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  for (let i = 0, x = 1; i < 255; i++) {
    EXP[i] = x; LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;          // порождающий многочлен поля
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];

  const mul = (a, b) => (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]];

  /* Многочлен-генератор для n проверочных байтов. */
  function generator(n) {
    let g = [1];
    for (let i = 0; i < n; i++) {
      const next = new Array(g.length + 1).fill(0);
      for (let j = 0; j < g.length; j++) {
        next[j] ^= g[j];
        next[j + 1] ^= mul(g[j], EXP[i]);
      }
      g = next;
    }
    return g;
  }

  /* Проверочные байты блока данных. */
  function ecBytes(data, n) {
    const g = generator(n);
    const res = new Uint8Array(data.length + n);
    res.set(data);
    for (let i = 0; i < data.length; i++) {
      const c = res[i];
      if (!c) continue;
      for (let j = 0; j < g.length; j++) res[i + j] ^= mul(g[j], c);
    }
    return res.slice(data.length);
  }

  /* ---------- Таблицы стандарта, уровень коррекции M ----------
     На каждую версию: [сколько всего байт данных, проверочных на блок,
     блоков группы 1, байт данных в блоке группы 1,
     блоков группы 2, байт данных в блоке группы 2] */
  const VER = [
    null,
    [16, 10, 1, 16, 0, 0],      [28, 16, 1, 28, 0, 0],
    [44, 26, 1, 44, 0, 0],      [64, 18, 2, 32, 0, 0],
    [86, 24, 2, 43, 0, 0],      [108, 16, 4, 27, 0, 0],
    [124, 18, 4, 31, 0, 0],     [154, 22, 2, 38, 2, 39],
    [182, 22, 3, 36, 2, 37],    [216, 26, 4, 43, 1, 44],
    [254, 30, 1, 50, 4, 51],    [290, 22, 6, 36, 2, 37],
    [334, 22, 8, 37, 1, 38],    [365, 24, 4, 40, 5, 41],
    [415, 24, 5, 41, 5, 42],    [453, 28, 7, 45, 3, 46],
    [507, 28, 10, 46, 1, 47],   [563, 26, 9, 43, 4, 44],
    [627, 26, 3, 44, 11, 45],   [669, 26, 3, 41, 13, 42],
  ];

  /* Где стоят выравнивающие квадраты — по версиям. */
  const ALIGN = [
    [], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34],
    [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50],
    [6, 30, 54], [6, 32, 58], [6, 34, 62], [6, 26, 46, 66],
    [6, 26, 48, 70], [6, 26, 50, 74], [6, 30, 54, 78],
    [6, 30, 56, 82], [6, 30, 58, 86], [6, 34, 62, 90],
  ];

  /* ---------- Сборка потока битов ---------- */
  function bitStream(bytes, version) {
    const [capacity] = VER[version];
    const bits = [];
    const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >> i) & 1); };

    push(0b0100, 4);                                  // режим: байты
    push(bytes.length, version <= 9 ? 8 : 16);        // длина
    for (const b of bytes) push(b, 8);

    /* Признак конца — до четырёх нулей, но не длиннее оставшегося места. */
    for (let i = 0; i < 4 && bits.length < capacity * 8; i++) bits.push(0);
    while (bits.length % 8) bits.push(0);

    /* Хвост добивается двумя чередующимися байтами — так велит стандарт. */
    const out = [];
    for (let i = 0; i < bits.length; i += 8) {
      let b = 0;
      for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
      out.push(b);
    }
    const PAD = [0xec, 0x11];
    for (let i = 0; out.length < capacity; i++) out.push(PAD[i % 2]);
    return out;
  }

  /* Данные и проверочные байты перемешиваются по блокам: так царапина
     на одном месте портит понемногу в каждом блоке, а не убивает один. */
  function interleave(data, version) {
    const [, ecPerBlock, n1, len1, n2, len2] = VER[version];
    const blocks = [], ecs = [];
    let pos = 0;
    for (let i = 0; i < n1; i++) { blocks.push(data.slice(pos, pos + len1)); pos += len1; }
    for (let i = 0; i < n2; i++) { blocks.push(data.slice(pos, pos + len2)); pos += len2; }
    for (const b of blocks) ecs.push(ecBytes(Uint8Array.from(b), ecPerBlock));

    const out = [];
    const maxData = Math.max(len1, len2);
    for (let i = 0; i < maxData; i++)
      for (const b of blocks) if (i < b.length) out.push(b[i]);
    for (let i = 0; i < ecPerBlock; i++)
      for (const e of ecs) out.push(e[i]);
    return out;
  }

  /* ---------- Раскладка модулей ---------- */
  function place(version, codewords) {
    const size = version * 4 + 17;
    const m = Array.from({ length: size }, () => new Array(size).fill(null));
    const fixed = Array.from({ length: size }, () => new Array(size).fill(false));

    const square = (r, c) => {          // поисковый квадрат 7×7 с рамкой
      for (let i = -1; i <= 7; i++) for (let j = -1; j <= 7; j++) {
        const y = r + i, x = c + j;
        if (y < 0 || x < 0 || y >= size || x >= size) continue;
        const on = i >= 0 && i <= 6 && j >= 0 && j <= 6 &&
                   (i === 0 || i === 6 || j === 0 || j === 6 || (i >= 2 && i <= 4 && j >= 2 && j <= 4));
        m[y][x] = on; fixed[y][x] = true;
      }
    };
    square(0, 0); square(0, size - 7); square(size - 7, 0);

    for (let i = 8; i < size - 8; i++) {             // синхрополосы
      const on = i % 2 === 0;
      m[6][i] = on; fixed[6][i] = true;
      m[i][6] = on; fixed[i][6] = true;
    }

    /* Выравнивающие квадраты стоят на пересечениях списка координат, кроме
       трёх углов, где уже стоят поисковые.
       Проверять «занята ли клетка» здесь нельзя, хотя так и напрашивается:
       центры на 6-й строке и 6-м столбце лежат прямо на синхрополосе, она
       их «занимает» — и квадраты просто не рисовались. На версиях с первой
       по шестую таких центров нет, поэтому всё работало; начиная с седьмой
       код переставал читаться, и выглядело это как поломка «где-то в больших
       версиях». Поэтому исключаем ровно три угла, поимённо. */
    const A = ALIGN[version], first = A[0], last = A[A.length - 1];
    for (const r of A) for (const c of A) {
      const atFinder = (r === first && c === first)
                    || (r === first && c === last)
                    || (r === last  && c === first);
      if (atFinder) continue;
      for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
        m[r + i][c + j] = Math.abs(i) === 2 || Math.abs(j) === 2 || (i === 0 && j === 0);
        fixed[r + i][c + j] = true;
      }
    }

    m[size - 8][8] = true; fixed[size - 8][8] = true;   // всегда тёмный модуль

    /* Места под сведения о формате — заполним после выбора маски. */
    for (let i = 0; i < 9; i++) {
      if (!fixed[8][i]) { fixed[8][i] = true; m[8][i] = false; }
      if (!fixed[i][8]) { fixed[i][8] = true; m[i][8] = false; }
    }
    /* Второй экземпляр сведений о формате — пятнадцать модулей, но
       разложенных несимметрично: восемь по горизонтали (столбцы size-8 …
       size-1 в строке 8) и семь по вертикали (строки size-7 … size-1 в
       столбце 8). Шестнадцатая клетка снизу, (size-8, 8), — тот самый
       «всегда тёмный» модуль, он к формату не относится.
       Ошибка на одну клетку здесь не портит картинку заметно: код просто
       перестаёт читаться целиком, потому что все данные после неё
       смещаются на один модуль. */
    for (let i = 1; i <= 8; i++)
      if (!fixed[8][size - i]) { fixed[8][size - i] = true; m[8][size - i] = false; }
    for (let i = 1; i <= 7; i++)
      if (!fixed[size - i][8]) { fixed[size - i][8] = true; m[size - i][8] = false; }

    /* Сведения о версии — только начиная с седьмой. */
    if (version >= 7) {
      let v = version << 12, d = version << 12;
      for (let i = 0; i < 6; i++) if (d & (1 << (17 - i))) d ^= 0x1f25 << (5 - i);
      v |= d;
      for (let i = 0; i < 18; i++) {
        const bit = Boolean((v >> i) & 1);
        const r = Math.floor(i / 3), c = i % 3;
        m[r][size - 11 + c] = bit; fixed[r][size - 11 + c] = true;
        m[size - 11 + c][r] = bit; fixed[size - 11 + c][r] = true;
      }
    }

    /* Данные заполняют оставшееся змейкой снизу справа, парами столбцов. */
    let bitIdx = 0, up = true;
    const bitAt = i => {
      const byte = codewords[i >> 3];
      return byte === undefined ? false : Boolean((byte >> (7 - (i & 7))) & 1);
    };
    for (let col = size - 1; col > 0; col -= 2) {
      if (col === 6) col--;                          // столбец синхрополосы пропускаем
      for (let k = 0; k < size; k++) {
        const row = up ? size - 1 - k : k;
        for (const c of [col, col - 1]) {
          if (fixed[row][c]) continue;
          m[row][c] = bitAt(bitIdx++);
        }
      }
      up = !up;
    }
    return { m, fixed, size };
  }

  const MASKS = [
    (r, c) => (r + c) % 2 === 0,
    (r) => r % 2 === 0,
    (_, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => (r * c) % 2 + (r * c) % 3 === 0,
    (r, c) => ((r * c) % 2 + (r * c) % 3) % 2 === 0,
    (r, c) => ((r + c) % 2 + (r * c) % 3) % 2 === 0,
  ];

  /* Штраф за неудачный рисунок: чем меньше, тем надёжнее читается. */
  function penalty(m, size) {
    let p = 0;
    /* Правило 1: длинные одноцветные полосы. */
    for (let i = 0; i < size; i++) {
      for (const line of [m[i], m.map(r => r[i])]) {
        let run = 1;
        for (let j = 1; j < size; j++) {
          if (line[j] === line[j - 1]) run++;
          else { if (run >= 5) p += 3 + (run - 5); run = 1; }
        }
        if (run >= 5) p += 3 + (run - 5);
      }
    }
    /* Правило 2: одноцветные квадраты 2×2. */
    for (let r = 0; r < size - 1; r++) for (let c = 0; c < size - 1; c++)
      if (m[r][c] === m[r][c + 1] && m[r][c] === m[r + 1][c] && m[r][c] === m[r + 1][c + 1]) p += 3;
    /* Правило 3: рисунок, похожий на поисковый квадрат. */
    const A = [true, false, true, true, true, false, true, false, false, false, false];
    const B = [false, false, false, false, true, false, true, true, true, false, true];
    const same = (line, i, pat) => pat.every((v, k) => line[i + k] === v);
    for (let i = 0; i < size; i++) {
      const row = m[i], col = m.map(r => r[i]);
      for (let j = 0; j + 11 <= size; j++) {
        if (same(row, j, A) || same(row, j, B)) p += 40;
        if (same(col, j, A) || same(col, j, B)) p += 40;
      }
    }
    /* Правило 4: перекос доли тёмного от половины. */
    let dark = 0;
    for (const row of m) for (const v of row) if (v) dark++;
    p += Math.floor(Math.abs(dark * 100 / (size * size) - 50) / 5) * 10;
    return p;
  }

  /* Сведения о формате: уровень коррекции M и номер маски, с защитой. */
  function formatBits(maskId) {
    const data = (0b00 << 3) | maskId;               // 00 = уровень M
    let d = data << 10;
    for (let i = 0; i < 5; i++) if (d & (1 << (14 - i))) d ^= 0x537 << (4 - i);
    return ((data << 10) | d) ^ 0b101010000010010;
  }

  function applyFormat(m, size, maskId) {
    const bits = formatBits(maskId);
    /* Нулевая позиция — старший бит, а не младший. Стандарт кладёт биты
       формата от старшего к младшему, и если перепутать направление,
       картинка выглядит совершенно нормальной, но не читается ничем:
       считыватель просто не понимает, какой маской её снимать. */
    const bit = i => Boolean((bits >> (14 - i)) & 1);
    /* Первый экземпляр — вокруг левого верхнего поискового квадрата. */
    for (let i = 0; i <= 5; i++) m[8][i] = bit(i);
    m[8][7] = bit(6);
    m[8][8] = bit(7);
    m[7][8] = bit(8);
    for (let i = 9; i <= 14; i++) m[14 - i][8] = bit(i);

    /* Второй — снизу слева и справа сверху. Биты 0–6 идут по вертикали,
       7–14 по горизонтали. */
    for (let i = 0; i <= 6; i++) m[size - 1 - i][8] = bit(i);
    for (let i = 7; i <= 14; i++) m[8][size - 15 + i] = bit(i);

    /* Модуль, который по стандарту всегда тёмный. */
    m[size - 8][8] = true;
  }

  function matrix(text) {
    const bytes = new TextEncoder().encode(String(text));
    /* Версия — наименьшая, в которую влезает. Заголовок длины на версиях
       до девятой занимает байт, дальше два — это учтено. */
    let version = 0;
    for (let v = 1; v <= 20; v++) {
      const header = 4 + (v <= 9 ? 8 : 16);
      if (bytes.length * 8 + header <= VER[v][0] * 8) { version = v; break; }
    }
    if (!version) throw new Error("Текст слишком длинный для QR-кода");

    const codewords = interleave(bitStream(bytes, version), version);
    const { m, fixed, size } = place(version, codewords);

    /* Пробуем все восемь масок и берём ту, у которой штраф меньше. */
    let best = null, bestScore = Infinity;
    for (let id = 0; id < 8; id++) {
      const cand = m.map(row => row.slice());
      for (let r = 0; r < size; r++) for (let c = 0; c < size; c++)
        if (!fixed[r][c] && MASKS[id](r, c)) cand[r][c] = !cand[r][c];
      applyFormat(cand, size, id);
      const score = penalty(cand, size);
      if (score < bestScore) { bestScore = score; best = cand; }
    }
    return best;
  }

  /* Готовый <svg>. Рисуем одним path — так разметка короче в разы,
     а браузер отрисовывает быстрее, чем тысячу отдельных квадратов. */
  function svg(text, { margin = 4, dark = "#000", light = "#fff" } = {}) {
    const m = matrix(text);
    const n = m.length, side = n + margin * 2;
    let d = "";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++)
      if (m[r][c]) d += `M${c + margin} ${r + margin}h1v1h-1z`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}" `
         + `shape-rendering="crispEdges" role="img" aria-label="QR-код для оплаты">`
         + `<rect width="${side}" height="${side}" fill="${light}"/>`
         + `<path d="${d}" fill="${dark}"/></svg>`;
  }

  /* Готовая строка для тега <img src>. Кодируем в base64 — svg с решётками
     в цветах ломает inline-разметку, если вставлять как есть. */
  function dataUrl(text, opts) {
    const s = svg(text, opts);
    const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(s)));
    return "data:image/svg+xml;base64," + b64;
  }

  return { matrix, svg, dataUrl };
})();

if (typeof window !== "undefined") window.QR = QR;
if (typeof module !== "undefined" && module.exports) module.exports = QR;
