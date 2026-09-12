/* ЭкоФин — service worker (офлайн-кэш).
   Версию поднимаем при каждом релизе: иначе у вернувшихся посетителей
   останется старый кэш и новый фронтенд не подхватится. */
const CACHE = "pravofin-v206";

const ASSETS = [
  "index.html", "tools.html", "calc.html", "courses.html", "games.html",
  "knowledge.html", "dashboard.html", "auth.html", "expenses.html",
  "search.html", "faq.html", "about.html", "legal.html", "onboarding.html",
  "404.html", "recovery.html", "situations.html", "book.html", "docs.html", "clients.html",
  "css/style.css?v=206", "css/calc.css?v=206",
  "js/contacts.js?v=206", "js/themes.js?v=206", "js/api.js?v=206", "js/app.js?v=206", "js/partners.js?v=206", "js/ai.js?v=206", "js/rates.js?v=206", "js/docscan.js?v=206",
  "js/games.js?v=206", "js/knowledge.js?v=206", "js/templates.js?v=206", "js/courses.js?v=206",
  "js/competencies.js?v=206",
  "js/situations.js?v=206",
  "js/progress.js?v=206", "js/favorites.js?v=206",
  "js/book.js?v=206", "js/qr.js?v=206", "js/calc.js?v=206", "js/templates.js?v=206",
  "manifest.webmanifest", "icon.svg",
];

self.addEventListener("install", e => {
  /* Одна недоступная ссылка не должна валить всю установку. */
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(ASSETS.map(a => c.add(a))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  /* Ответы API не кэшируем никогда: там персональные данные, квоты и права.
     Отдать их из кэша — значит показать чужие или устаревшие лимиты. */
  if (url.pathname.startsWith("/api/") || url.hostname.endsWith("workers.dev")) return;

  /* Чужие домены (шрифты, генератор QR) оставляем браузеру. */
  if (url.origin !== location.origin) return;

  e.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then(hit => hit || caches.match("404.html")))
  );
});
