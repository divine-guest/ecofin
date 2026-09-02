/* ============ Сборка страниц для поиска ============

   Зачем. 28 статей базы знаний лежали внутри одного файла knowledge.js
   и открывались по якорю вида knowledge.html#a=Заголовок. Якорь — это
   не страница: у него нет собственного адреса в выдаче, своего
   заголовка и своего описания.

   Для Яндекса и Google это означало ОДНУ страницу «База знаний» вместо
   двадцати восьми страниц под запросы «страховые взносы ИП за себя»,
   «что делать при требовании из налоговой», «как закрыть ИП правильно».
   Именно эти запросы приводят человека с деньгами и конкретной задачей,
   то есть будущего подписчика.

   Скрипт разворачивает те же самые статьи в обычные HTML-файлы в папке
   st/ — содержание не переписывается, оно уже написано. Заодно
   собирает разметку FAQPage из живого текста faq.html и пересобирает
   карту сайта, чтобы она не отставала от содержания.

   Запуск:  node build-seo.mjs
   Гоняется перед каждой выкладкой, как bump-version.py.              */

import { readFile, writeFile, mkdir, readdir, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = "https://divine-guest.github.io/ecofin";
const OUT = join(HERE, "st");

/* ---------- Вспомогательное ---------- */

const esc = s => String(s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

/* Заголовок → адрес. Латиницей: кириллица в адресе превращается в
   нечитаемые проценты и портит вид ссылки при пересылке. */
const MAP = {
  а:"a",б:"b",в:"v",г:"g",д:"d",е:"e",ё:"e",ж:"zh",з:"z",и:"i",й:"y",к:"k",л:"l",
  м:"m",н:"n",о:"o",п:"p",р:"r",с:"s",т:"t",у:"u",ф:"f",х:"h",ц:"c",ч:"ch",ш:"sh",
  щ:"sch",ъ:"",ы:"y",ь:"",э:"e",ю:"yu",я:"ya",
};
export function slug(title) {
  return title.toLowerCase()
    .replace(/[а-яё]/g, c => MAP[c] ?? c)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
}

/* Тело статьи — простой текст с пустыми строками и строчными
   заголовками ЗАГЛАВНЫМИ. Разворачиваем в абзацы и подзаголовки. */
function bodyHtml(text) {
  return text.split(/\n{2,}/).map(block => {
    const lines = block.split("\n");
    const out = [];
    let para = [];
    /* Абзац, целиком состоящий из пунктов «• …», — это список, а не
       сплошной текст: слитно такое не читается ни на экране, ни голосом. */
    const flush = () => {
      if (!para.length) return;
      const bullets = para.filter(x => x.startsWith("•"));
      if (bullets.length >= 2 && bullets.length === para.length) {
        out.push(`<ul>${para.map(x => `<li>${esc(x.replace(/^•\s*/, ""))}</li>`).join("")}</ul>`);
      } else {
        out.push(`<p>${esc(para.join(" "))}</p>`);
      }
      para = [];
    };
    for (const line of lines) {
      const t = line.trim();
      if (!t) { flush(); continue; }
      /* Строка целиком заглавными и без точки — это подзаголовок. */
      if (t.length < 70 && t === t.toUpperCase() && /[А-ЯЁA-Z]/.test(t) && !/[.!?]$/.test(t)) {
        flush();
        out.push(`<h2>${esc(t.charAt(0) + t.slice(1).toLowerCase())}</h2>`);
      } else para.push(t);
      /* Строки-пункты, начатые с «•», собираются ниже отдельным проходом. */
    }
    flush();
    return out.join("\n      ");
  }).join("\n      ");
}

/* Первые полторы сотни символов без переносов — описание для выдачи. */
const descOf = a => (a.summary || a.body).replace(/\s+/g, " ").slice(0, 175).trim();

/* ---------- Страница статьи ---------- */

function articlePage(a, all, version, updated) {
  const url = `${SITE}/st/${slug(a.title)}.html`;
  const desc = descOf(a);
  const related = (a.related || [])
    .map(t => all.find(x => x.title === t))
    .filter(Boolean);

  const ld = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: a.title,
    description: desc,
    inLanguage: "ru-RU",
    articleSection: a.area,
    dateModified: updated,
    author: { "@type": "Organization", name: "ЭкоФин" },
    publisher: {
      "@type": "Organization",
      name: "ЭкоФин",
      logo: { "@type": "ImageObject", url: `${SITE}/icon-512.png` },
    },
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    image: `${SITE}/og-cover.png`,
    citation: (a.law || []).join("; ") || undefined,
  };

  const crumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Главная", item: `${SITE}/index.html` },
      { "@type": "ListItem", position: 2, name: "База знаний", item: `${SITE}/knowledge.html` },
      { "@type": "ListItem", position: 3, name: a.title, item: url },
    ],
  };

  const part = (title, cls, inner) => inner
    ? `\n      <div class="kb-part ${cls}"><h3>${title}</h3>${inner}</div>` : "";

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(a.title)} — ЭкоФин</title>
<!-- Эта страница собрана скриптом build-seo.mjs из js/knowledge.js.
     Править здесь бесполезно: при следующей сборке файл перезапишется.
     Текст статьи живёт в js/knowledge.js. -->
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="ЭкоФин">
<meta property="og:locale" content="ru_RU">
<meta property="og:title" content="${esc(a.title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE}/og-cover.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#0e8f86">
<script type="application/ld+json">${JSON.stringify(ld)}</script>
<script type="application/ld+json">${JSON.stringify(crumbs)}</script>
<link rel="icon" href="../icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="../apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Onest:wght@500;600;700;800&family=Golos+Text:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="../css/style.css?v=${version}">
</head>
<body>
<main class="section">
  <div class="container" style="max-width:820px">
    <nav class="crumbs" aria-label="Хлебные крошки">
      <a href="../index.html">Главная</a> · <a href="../knowledge.html">База знаний</a> ·
      <span>${esc(a.area)}</span>
    </nav>

    <article class="card kb-article">
      <span class="badge">${esc(a.code)}</span>
      <h1>${esc(a.title)}</h1>
      ${a.summary ? `<p class="kb-summary">${esc(a.summary)}</p>` : ""}
      ${bodyHtml(a.body)}
      ${part("Что сделать", "kb-steps", (a.steps || []).length
        ? `<ol>${a.steps.map(x => `<li>${esc(x)}</li>`).join("")}</ol>` : "")}
      ${part("Частые ошибки", "kb-mistakes", (a.mistakes || []).length
        ? `<ul>${a.mistakes.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : "")}
      ${part("Нормы", "kb-law", (a.law || []).length
        ? `<p>${a.law.map(esc).join(" · ")}</p>` : "")}
      <p class="kb-checked">Материал сверен с законодательством ${updated}.
        Нормы меняются — перед решением сверьтесь с действующей редакцией.
        Это справка, а не юридическая консультация.</p>
    </article>

    ${related.length ? `<div class="card">
      <h2 style="font-size:var(--t-lg)">Читать дальше</h2>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        ${related.map(r => `<a class="btn small secondary" href="${slug(r.title)}.html">${esc(r.title)}</a>`).join("")}
      </div>
    </div>` : ""}

    <div class="card kb-cta">
      <h2 style="font-size:var(--t-lg)">Остались вопросы по вашей ситуации?</h2>
      <p style="color:var(--muted)">Статья описывает общий случай. Спросите консультанта
      про свои цифры и свой договор — ответ со ссылками на статьи закона, три вопроса
      в день бесплатно.</p>
      <p style="margin-top:14px">
        <a class="btn gold" href="../auth.html?from=article">Спросить бесплатно</a>
        <a class="btn secondary" href="../calc.html">Посчитать налоги</a>
      </p>
    </div>
  </div>
</main>

<script src="../js/themes.js?v=${version}"></script>
<script src="../js/api.js?v=${version}"></script>
<script src="../js/app.js?v=${version}"></script>
<script src="../js/progress.js?v=${version}"></script>
<script src="../js/palette.js?v=${version}"></script>
<script>
/* Шапка, подвал и быстрый поиск общие для всего сайта. Про подпапку они
   знают сами: PF.base смотрит на адрес страницы и подставляет «../»
   ко всем внутренним ссылкам. Поправлять их здесь после отрисовки
   бесполезно — шапка перерисовывается ещё раз, когда сервер
   подтвердит сессию, и правки пропадают. */
initPage("knowledge.html");
</script>
</body>
</html>
`;
}

/* ---------- Разметка вопросов и ответов ---------- */

/* Собираем FAQPage из живого текста страницы, а не из отдельного списка:
   иначе разметка со временем разойдётся с тем, что видит человек, —
   а за это поиск наказывает. */
async function buildFaq() {
  const p = join(HERE, "faq.html");
  let html = await readFile(p, "utf8");

  const items = [];
  const re = /<summary>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/g;
  let m;
  while ((m = re.exec(html))) {
    const q = m[1].replace(/<[^>]*>/g, "").trim();
    const a = m[2].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    if (q && a) items.push({ "@type": "Question", name: q,
      acceptedAnswer: { "@type": "Answer", text: a } });
  }

  const ld = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    inLanguage: "ru-RU",
    mainEntity: items,
  });

  const block = `<script type="application/ld+json">${ld}</script>`;
  html = html.includes("<!-- faq-ld -->")
    ? html.replace(/<!-- faq-ld -->[\s\S]*?<!-- \/faq-ld -->/,
                   `<!-- faq-ld -->\n${block}\n<!-- /faq-ld -->`)
    : html.replace("</head>", `<!-- faq-ld -->\n${block}\n<!-- /faq-ld -->\n</head>`);

  await writeFile(p, html, "utf8");
  return items.length;
}

/* ---------- Карта сайта ---------- */

async function buildSitemap(articles, today) {
  const pages = [
    ["", "1.0", "weekly"],
    ["situations.html", "0.95", "weekly"],
    ["tools.html", "0.9", "weekly"],
    ["calc.html", "0.9", "weekly"],
    ["knowledge.html", "0.9", "weekly"],
    ["answers.html", "0.9", "daily"],
    ["courses.html", "0.8", "weekly"],
    ["games.html", "0.7", "monthly"],
    ["about.html", "0.6", "monthly"],
    ["faq.html", "0.7", "monthly"],
    ["expenses.html", "0.6", "monthly"],
    ["search.html", "0.5", "monthly"],
    ["legal.html", "0.3", "yearly"],
  ];

  const url = (loc, pri, freq) =>
    `  <url>\n    <loc>${SITE}/${loc}</loc>\n    <lastmod>${today}</lastmod>\n` +
    `    <changefreq>${freq}</changefreq>\n    <priority>${pri}</priority>\n  </url>`;

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Собирается автоматически: node build-seo.mjs. Руками не править. -->
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages.map(([l, p, f]) => url(l, p, f)).join("\n")}
${articles.map(a => url(`st/${slug(a.title)}.html`, "0.8", "monthly")).join("\n")}
</urlset>
`;
  await writeFile(join(HERE, "sitemap.xml"), xml, "utf8");
  return pages.length + articles.length;
}

/* ---------- Запуск ---------- */

const main = async () => {
  const version = (await readFile(join(HERE, ".assets-version"), "utf8")).trim();

  /* knowledge.js — обычный скрипт, не модуль: подставляем его в область
     видимости так же, как это делает браузер. */
  const src = (await readFile(join(HERE, "js", "knowledge.js"), "utf8"))
    .replace(/^const /gm, "globalThis.");
  (0, eval)(src);
  const articles = globalThis.ARTICLES;
  const updated = globalThis.KB_UPDATED || new Date().toISOString().slice(0, 10);

  await mkdir(OUT, { recursive: true });

  /* Убираем страницы статей, которых больше нет: иначе поиск будет
     годами держать в выдаче то, что мы удалили. */
  const want = new Set(articles.map(a => `${slug(a.title)}.html`));
  for (const f of await readdir(OUT)) {
    if (f.endsWith(".html") && !want.has(f)) await unlink(join(OUT, f));
  }

  for (const a of articles) {
    await writeFile(join(OUT, `${slug(a.title)}.html`), articlePage(a, articles, version, updated), "utf8");
  }

  const faq = await buildFaq();
  const urls = await buildSitemap(articles, new Date().toISOString().slice(0, 10));

  console.log(`страниц статей: ${articles.length}`);
  console.log(`вопросов в разметке FAQ: ${faq}`);
  console.log(`адресов в карте сайта: ${urls}`);
};

main().catch(e => { console.error(e); process.exit(1); });
