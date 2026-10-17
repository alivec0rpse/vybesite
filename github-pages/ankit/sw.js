/* One origin hosts every card, and CacheStorage is shared across the whole
 * origin rather than per scope. The activate sweep below must therefore only
 * touch this card's own caches, or each card evicts the others' offline copy. */
const PREFIX = "vybe-ankit-";
const V = PREFIX + "a412b031b0-addr2";
const CORE = ["./", "styles.css?v=a412b031b0", "app.js?v=a412b031b0", "manifest.webmanifest", "contact.vcf", "assets/vybe-lockup.svg", "assets/vybe-mark.svg", "assets/vybe-lockup.png", "qr.js?v=a412b031b0", "assets/fonts/jakarta.woff2", "assets/icon-192.png", "assets/apple-touch-icon.png"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(V).then((c) => c.addAll(CORE))); self.skipWaiting(); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith(PREFIX) && k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== location.origin) return;
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).then((r) => { if (r.ok && !r.redirected) { const c = r.clone(); caches.open(V).then((x) => x.put(req, c)); } return r; })
      .catch(() => caches.match(req).then((m) => m || caches.match("./"))));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => { if (r.ok) { const c = r.clone(); caches.open(V).then((x) => x.put(req, c)); } return r; })));
});
