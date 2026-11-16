// App-Hülle offline halten. API-Aufrufe (intervals.icu, Anthropic) gehen nie durch den Cache.
const CACHE = "hc-shell-v8";
const SHELL = ["./", "index.html", "styles.css", "manifest.webmanifest", "icons/icon.svg",
  "js/app.js", "js/api.js", "js/rules.js", "js/marker.js", "js/review.js", "js/affirmations.js", "js/charts.js", "js/ai.js", "js/config.js"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (u.origin !== location.origin || e.request.method !== "GET") return;
  // Netz zuerst, damit Updates sofort ankommen; Cache nur als Rückfall
  e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request)));
});
