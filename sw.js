/* Service worker : rend l'application installable et rapide à ouvrir.
   Les données (planning, documents…) viennent toujours en direct de Supabase. */
const VERSION = "dam-equipe-v40d";
const COQUILLE = ["./", "index.html", "css/style.css", "js/app.js", "js/plus.js", "js/config.js",
  "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png",
  "icons/apple-touch-icon.png", "icons/favicon.svg"];
self.addEventListener("install", e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(COQUILLE)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || req.headers.has("range") || new URL(req.url).origin !== self.location.origin) return;
  // Réseau d'abord (pour recevoir les mises à jour), cache si hors connexion.
  e.respondWith(fetch(req).then(res => {
    // On ne garde en cache que les réponses valides (pas les erreurs 404/500).
    if (res.ok && res.type === "basic") { const copie = res.clone(); e.waitUntil(caches.open(VERSION).then(c => c.put(req, copie))); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: req.mode === "navigate" })
    .then(r => r || (req.mode === "navigate" ? caches.match("index.html") : Response.error()))));
});
// Notifications (nouveaux messages, documents, changements de planning)
self.addEventListener("push", e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) { d = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "DAM Essentiel", { body: d.body || "", icon: "icons/icon-192.png", badge: "icons/icon-192.png", tag: d.tag || undefined, renotify: !!d.tag, data: { url: d.url || "./" } }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "./", self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(ws => {
    for (const w of ws) if (w.url.startsWith(self.location.origin) && "focus" in w) return w.navigate(url).then(c => (c || w).focus());
    return self.clients.openWindow(url);
  }));
});
