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
import { CALC_PAGES, CALC_GROUPS } from "./calc-pages.mjs";
import { AUDIENCES, ARTICLE_AUDIENCE, CALC_AUDIENCE, forAudience } from "./audience.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
/* Собственный домен. До покупки здесь стоял адрес GitHub Pages, и это
   было верно: сайт там и жил. Теперь старый адрес в каноническом теге
   был бы вреден - он говорит поисковику "настоящая страница вон там",
   и весь вес уходил бы чужому поддомену, а свой домен считался копией. */
const SITE = "https://ecofin26.ru";
const OUT = join(HERE, "st");
const CALC_OUT = join(HERE, "calc");

/* ---------- Вспомогательное ---------- */

const plural = (n, one, few, many) => {
  const t = Math.abs(n) % 100, d = t % 10;
  if (t > 10 && t < 20) return many;
  if (d > 1 && d < 5) return few;
  return d === 1 ? one : many;
};

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
      /* Главная — корень, а не /index.html: в карте сайта и в canonical
         стоит именно он, и два адреса одной страницы поисковик считает
         разными страницами. */
      { "@type": "ListItem", position: 1, name: "Главная", item: `${SITE}/` },
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
<link rel="stylesheet" href="../css/fonts.css?v=${version}">
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

/* ---------- Страницы калькуляторов ---------- */

/* Границы панели калькулятора в calc.html: от открывающего <div> с нужным
   id до парного закрывающего. Считаем вложенность, а не ищем ближайший
   </div>: внутри панели своих div десятки. */
function panelBounds(html, id) {
  const at = html.indexOf(`id="${id}"`);
  if (at < 0) throw new Error(`в calc.html нет панели ${id}`);
  const start = html.lastIndexOf("<div", at);
  const tag = /<\/?div\b[^>]*>/g;
  tag.lastIndex = start;
  let depth = 0, m;
  while ((m = tag.exec(html))) {
    depth += m[0][1] === "/" ? -1 : 1;
    if (depth === 0) return { start, close: m.index, end: m.index + m[0].length };
  }
  throw new Error(`панель ${id} в calc.html не закрыта`);
}

const HUB_LINK = /\n[ \t]*<p class="calc-page-link no-print">.*?<\/p>/g;

/* Ссылки с общей страницы на отдельные ставит сборка, а не руки:
   добавили страницу в calc-pages.mjs — ссылка появилась, убрали — пропала. */
function syncHubLinks(html, pages) {
  html = html.replace(HUB_LINK, "");
  for (const p of pages) {
    const b = panelBounds(html, p.panel);
    html = html.slice(0, b.close).replace(/\s*$/, "") +
      `\n      <p class="calc-page-link no-print"><a href="calc/${p.slug}.html">${esc(p.link)} →</a></p>\n    ` +
      html.slice(b.close);
  }
  return html;
}

/* Панель для отдельной страницы: без ссылки на саму себя, сразу открытая,
   а внутренние адреса — от корня сайта, раз страница лежит в подпапке. */
function panelFor(html, id) {
  const b = panelBounds(html, id);
  return html.slice(b.start, b.end)
    .replace(HUB_LINK, "")
    .replace(/class="tab-panel\b(?: active)?/, 'class="tab-panel active')
    .replace(/\b(href|src)="(?!https?:|#|mailto:|tel:|\/|\.\.\/|data:)([^"]+)"/g, '$1="../$2"');
}

/* Абзацы разбора: строка — абзац, массив — список. */
const paras = items => items.map(x => Array.isArray(x)
  ? `<ul>${x.map(li => `<li>${esc(li)}</li>`).join("")}</ul>`
  : `<p>${esc(x)}</p>`).join("\n      ");

function calcPage(p, { R, hub, pages, articles, version }) {
  const url = `${SITE}/calc/${p.slug}.html`;
  const title = p.title(R);
  const desc = p.description(R);
  const ex = p.example(R);
  const group = CALC_GROUPS[p.group];
  if (!group) throw new Error(`${p.slug}: нет группы ${p.group}`);
  /* Опечатка в названии статьи или соседа должна валить сборку, а не
     молча выпускать страницу с битой ссылкой. */
  const article = p.article ? articles.find(a => a.title === p.article) : null;
  if (p.article && !article) throw new Error(`${p.slug}: в базе знаний нет статьи «${p.article}»`);
  const related = (p.related || []).map(s => {
    const r = pages.find(x => x.slug === s);
    if (!r) throw new Error(`${p.slug}: нет страницы калькулятора ${s}`);
    return r;
  });
  const checked = R.checkedOn.split("-").reverse().join(".");

  const app = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: p.h1,
    url,
    description: desc,
    applicationCategory: "FinanceApplication",
    operatingSystem: "Любая",
    inLanguage: "ru-RU",
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "RUB" },
    publisher: { "@type": "Organization", name: "ЭкоФин", url: `${SITE}/` },
  };

  const crumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Главная", item: `${SITE}/` },
      { "@type": "ListItem", position: 2, name: "Калькуляторы", item: `${SITE}/calc.html` },
      { "@type": "ListItem", position: 3, name: p.h1, item: url },
    ],
  };

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>${esc(title)} — ЭкоФин</title>
<!-- Страница собрана скриптом build-seo.mjs. Калькулятор взят из calc.html,
     текст — из calc-pages.mjs, числа — из js/rates.js. Править здесь
     бесполезно: при следующей сборке файл перезапишется. -->
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="ЭкоФин">
<meta property="og:locale" content="ru_RU">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE}/og-cover.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#0e8f86">
<script type="application/ld+json">${JSON.stringify(app)}</script>
<script type="application/ld+json">${JSON.stringify(crumbs)}</script>
<link rel="icon" href="../icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="../apple-touch-icon.png">
<link rel="stylesheet" href="../css/fonts.css?v=${version}">
<link rel="stylesheet" href="../css/style.css?v=${version}">
<link rel="stylesheet" href="../css/calc.css?v=${version}">
</head>
<body>
<main class="section tint-navy calc-page">
  <div class="container">
    <nav class="crumbs" aria-label="Хлебные крошки">
      <a href="../index.html">Главная</a> · <a href="../calc.html">Калькуляторы</a> ·
      <span>${esc(group)}</span>
    </nav>
    <div class="section-title">
      <h1>${esc(p.h1)}</h1>
      <div class="line"></div>
      <p class="subtitle">${esc(p.lead(R))}</p>
    </div>

    ${panelFor(hub, p.panel)}

    <article class="card kb-article calc-guide">
      <h2>Как считается</h2>
      ${paras(p.how(R))}
      <h2>Пример</h2>
      <p>${esc(ex.intro)}</p>
      <table class="calc-table calc-example">
        ${ex.rows.map(([a, b]) => `<tr><td>${esc(a)}</td><td>${esc(b)}</td></tr>`).join("\n        ")}
      </table>
      ${ex.outro ? `<p>${esc(ex.outro)}</p>` : ""}
      <div class="kb-part kb-mistakes"><h3>Частые ошибки</h3><ul>${p.mistakes(R).map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>
      <div class="kb-part kb-law"><h3>Нормы</h3><p>${p.law(R).map(x => esc(x)).join(" · ")}</p></div>
      <p class="kb-checked">Ставки сверены ${checked}. Нормы меняются — перед решением
        сверьтесь с действующей редакцией. Расчёт справочный и не заменяет консультацию.</p>
    </article>

    <div class="card">
      <h2 style="font-size:var(--t-lg)">Считать и читать дальше</h2>
      ${article ? `<p style="margin-top:8px">Подробный разбор: <a href="../st/${slug(article.title)}.html">${esc(article.title)}</a></p>` : ""}
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        ${related.map(r => `<a class="btn small secondary" href="${r.slug}.html">${esc(r.h1)}</a>`).join("\n        ")}
        <a class="btn small secondary" href="../calc.html">Все калькуляторы</a>
      </div>
    </div>
  </div>
</main>

<script src="../js/rates.js?v=${version}"></script>
<script src="../js/themes.js?v=${version}"></script>
<script src="../js/api.js?v=${version}"></script>
<script src="../js/app.js?v=${version}"></script>
<script src="../js/progress.js?v=${version}"></script>
<script src="../js/palette.js?v=${version}"></script>
<script src="../js/ai.js?v=${version}"></script>
<script>
/* Шапка и подвал знают про подпапку сами: PF.base подставляет «../». */
initPage("calc.html");
</script>
<script src="../js/favorites.js?v=${version}"></script>
<script src="../js/calc.js?v=${version}"></script>
</body>
</html>
`;
}

/* ---------- Витрины по аудитории ---------- */

/* Вкладки калькуляторов в том порядке, в каком они стоят на странице:
   старые ссылки вида calc.html#tab=6 считают именно по порядку. */
function calcTabs(hub) {
  const out = [];
  const re = /<button class="tab[^"]*" data-panel="(\w+)"[^>]*>([^<]+)<\/button>/g;
  let m;
  while ((m = re.exec(hub))) out.push({ id: m[1], label: m[2].trim(), index: out.length });
  if (!out.length) throw new Error("не нашёл вкладки калькуляторов в calc.html");
  return out;
}

/* Куда вести с витрины: у части калькуляторов есть своя страница, у
   остальных — вкладка на общей. */
function calcHref(tab) {
  const page = CALC_PAGES.find(p => p.panel === tab.id);
  return page ? `calc/${page.slug}.html` : `calc.html#tab=${tab.index}`;
}

function audiencePage(who, { articles, hub, templates, version }) {
  const a = AUDIENCES[who];
  const url = `${SITE}/${a.slug}.html`;
  const other = AUDIENCES[a.other];

  const tabs = calcTabs(hub).filter(t => {
    const mark = CALC_AUDIENCE[t.id];
    if (!mark) throw new Error(`калькулятор ${t.id} не размечен в audience.mjs`);
    return forAudience(mark, who);
  });

  const mine = articles.filter(x => {
    const mark = ARTICLE_AUDIENCE[x.title];
    if (!mark) throw new Error(`статья «${x.title}» не размечена в audience.mjs`);
    return forAudience(mark, who);
  });

  /* Внутри витрины статьи сгруппированы по разделу: сплошной список из
     трёх десятков заголовков не читается вовсе. */
  const areas = [...new Set(mine.map(x => x.area))];

  const crumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Главная", item: `${SITE}/` },
      { "@type": "ListItem", position: 2, name: a.h1, item: url },
    ],
  };

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>${esc(a.title)} — ЭкоФин</title>
<!-- Страница собрана скриптом build-seo.mjs из разметки audience.mjs.
     Править здесь бесполезно: при следующей сборке файл перезапишется. -->
<meta name="description" content="${esc(a.description)}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="ЭкоФин">
<meta property="og:locale" content="ru_RU">
<meta property="og:title" content="${esc(a.title)} — ЭкоФин">
<meta property="og:description" content="${esc(a.description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE}/og-cover.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#0e8f86">
<script type="application/ld+json">${JSON.stringify(crumbs)}</script>
<link rel="icon" href="icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="apple-touch-icon.png">
<link rel="stylesheet" href="css/fonts.css?v=${version}">
<link rel="stylesheet" href="css/style.css?v=${version}">
</head>
<body>
<main class="section tint-navy">
  <div class="container" style="max-width:900px">
    <div class="section-title">
      <h1>${esc(a.h1)}</h1>
      <div class="line"></div>
      <p class="subtitle">${esc(a.lead)}</p>
    </div>

    <div class="card">
      <h2 style="font-size:var(--t-lg)">Посчитать</h2>
      <p style="color:var(--muted)">${tabs.length} калькуляторов по вашим задачам. Считают по ставкам 2026 года, регистрация не нужна.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        ${tabs.map(t => `<a class="btn small secondary" href="${calcHref(t)}">${esc(t.label)}</a>`).join("\n        ")}
      </div>
    </div>

    <div class="card">
      <h2 style="font-size:var(--t-lg)">Разобраться</h2>
      <p style="color:var(--muted)">${mine.length} разборов: что говорит закон, что делать по шагам и на чём обычно теряют деньги.</p>
      ${areas.map(area => `
      <h3 style="margin-top:16px">${esc(area)}</h3>
      <ul>
        ${mine.filter(x => x.area === area)
              .map(x => `<li><a href="st/${slug(x.title)}.html">${esc(x.title)}</a></li>`)
              .join("\n        ")}
      </ul>`).join("")}
    </div>

    <div class="card">
      <h2 style="font-size:var(--t-lg)">Оформить</h2>
      <p>${templates} ${plural(templates, "готовый документ", "готовых документа", "готовых документов")} с подсказками: договоры, претензии, заявления,
        приказы и письма в налоговую. Заполняются в браузере, скачиваются файлом.</p>
      <p style="margin-top:12px">
        <a class="btn small secondary" href="docs.html">Документы</a>
        <a class="btn small secondary" href="situations.html">Что делать в моей ситуации</a>
      </p>
    </div>

    ${(a.niches || []).length ? `
    <div class="card">
      <h2 style="font-size:var(--t-lg)">Ниши</h2>
      ${a.niches.map(([href, label, hint]) =>
        `<p style="margin-top:8px"><a href="${href}">${esc(label)}</a> — ${esc(hint)}</p>`).join("")}
    </div>` : ""}

    <div class="card kb-cta">
      <h2 style="font-size:var(--t-lg)">Спросить про свой случай</h2>
      <p style="color:var(--muted)">Калькулятор считает общий случай, а у вас свои цифры и свой договор.
        Консультант отвечает со ссылками на статьи закона — три вопроса в день бесплатно.</p>
      <p style="margin-top:14px">
        <a class="btn gold" href="auth.html?from=${a.slug}">Спросить бесплатно</a>
      </p>
      <p class="hint" style="margin-top:14px">${esc(other.otherLabel)}
        <a href="${other.slug}.html">${esc(other.h1)}</a></p>
    </div>
  </div>
</main>

<script src="js/themes.js?v=${version}"></script>
<script src="js/api.js?v=${version}"></script>
<script src="js/app.js?v=${version}"></script>
<script src="js/progress.js?v=${version}"></script>
<script src="js/palette.js?v=${version}"></script>
<script src="js/ai.js?v=${version}"></script>
<script>initPage("${a.slug}.html");</script>
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

async function buildSitemap(articles, today, calcPages = []) {
  const pages = [
    ["", "1.0", "weekly"],
    ["dlya-biznesa.html", "0.95", "weekly"],
    ["dlya-fizlic.html", "0.95", "weekly"],
    ["marketplace.html", "0.9", "monthly"],
    ["tenders.html", "0.9", "monthly"],
    ["situations.html", "0.95", "weekly"],
    ["book.html", "0.9", "weekly"],
    ["docs.html", "0.9", "weekly"],
    ["clients.html", "0.7", "monthly"],
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
    ["recovery.html", "0.4", "yearly"],
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
${calcPages.map(p => url(`calc/${p.slug}.html`, "0.85", "monthly")).join("\n")}
</urlset>
`;
  await writeFile(join(HERE, "sitemap.xml"), xml, "utf8");
  return pages.length + articles.length + calcPages.length;
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

  /* Калькуляторы: разметка панелей — из calc.html, числа — из rates.js.
     rates.js тоже обычный скрипт, выполняем его так же. */
  const R = new Function((await readFile(join(HERE, "js", "rates.js"), "utf8")) + "\nreturn RATES;")();
  const hubPath = join(HERE, "calc.html");
  const hubBefore = await readFile(hubPath, "utf8");
  const hub = syncHubLinks(hubBefore, CALC_PAGES);
  if (hub !== hubBefore) await writeFile(hubPath, hub, "utf8");

  await mkdir(CALC_OUT, { recursive: true });
  const wantCalc = new Set(CALC_PAGES.map(p => `${p.slug}.html`));
  for (const f of await readdir(CALC_OUT)) {
    if (f.endsWith(".html") && !wantCalc.has(f)) await unlink(join(CALC_OUT, f));
  }
  for (const p of CALC_PAGES) {
    await writeFile(join(CALC_OUT, `${p.slug}.html`),
      calcPage(p, { R, hub, pages: CALC_PAGES, articles, version }), "utf8");
  }

  /* Витрины по аудитории. Число шаблонов берём из самого файла
     шаблонов: написанное руками разойдётся с содержанием. */
  const tplSrc = (await readFile(join(HERE, "js", "templates.js"), "utf8"))
    .replace(/^const /gm, "globalThis.");
  (0, eval)(tplSrc);
  const templates = Object.keys(globalThis.TEMPLATES).length;

  for (const who of Object.keys(AUDIENCES)) {
    await writeFile(join(HERE, `${AUDIENCES[who].slug}.html`),
      audiencePage(who, { articles, hub, templates, version }), "utf8");
  }

  /* Копия разметки аудитории для браузера. Сам audience.mjs наружу не
     отдаётся: nginx запрещает .mjs, да и незачем — странице нужен
     только справочник «заголовок → кому». Собирается здесь, чтобы
     копия не разошлась с оригиналом. */
  const audienceJs = `/* СОБРАНО АВТОМАТИЧЕСКИ из audience.mjs — руками не править.
   Пересобрать: node build-seo.mjs

   Нужен страницам, которые фильтруют содержание по аудитории:
   база знаний, а дальше документы и инструменты. */

const AUDIENCE = ${JSON.stringify({ articles: ARTICLE_AUDIENCE, calcs: CALC_AUDIENCE }, null, 2)};

/* Материал показывается, если помечен этой аудиторией или «обоими». */
const forAudience = (mark, who) => !who || mark === "both" || mark === who;
`;
  await writeFile(join(HERE, "js", "audience.js"), audienceJs, "utf8");

  const faq = await buildFaq();
  const urls = await buildSitemap(articles, new Date().toISOString().slice(0, 10), CALC_PAGES);

  console.log(`страниц статей: ${articles.length}`);
  console.log(`страниц калькуляторов: ${CALC_PAGES.length}`);
  console.log(`витрин по аудитории: ${Object.keys(AUDIENCES).length}`);
  console.log(`разметка для браузера: js/audience.js`);
  console.log(`вопросов в разметке FAQ: ${faq}`);
  console.log(`адресов в карте сайта: ${urls}`);
};

main().catch(e => { console.error(e); process.exit(1); });
