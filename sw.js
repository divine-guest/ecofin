/* ПравоФин — service worker (офлайн-кэш основных страниц) */
const CACHE = "pravofin-v1";
const ASSETS = [
  "index.html", "tools.html", "courses.html", "games.html", "knowledge.html",
  "dashboard.html", "auth.html", "admin.html",
  "css/style.css", "js/app.js", "js/ai.js", "js/games.js", "js/knowledge.js",
  "js/templates.js", "js/courses.js", "manifest.webmanifest", "icon.svg",
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Сеть сначала, кэш — fallback (для статики можно мгновенно из кэша) */
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
