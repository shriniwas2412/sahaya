// Offline shell: cache the built app on install, serve it when offline.
// API calls (/api/*) always go to the network. Push shows reminders and alerts.
// Paths are relative to the worker's scope, so it also works under a sub-path (GitHub Pages).
const CACHE = "sahaya-v2";
const ROOT = new URL(self.registration.scope).pathname; // e.g. "/" or "/sahaya/"

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    const html = await (await fetch(ROOT, { cache: "reload" })).text();
    const assets = [...html.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map((m) => m[1]).filter((u) => u.startsWith(ROOT));
    await c.addAll([ROOT, ...new Set(assets)]);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.includes("/api/")) return;
  e.respondWith((async () => {
    try {
      const res = await fetch(e.request);
      if (res.ok) (await caches.open(CACHE)).put(e.request, res.clone());
      return res;
    } catch {
      return (await caches.match(e.request, { ignoreSearch: true })) ?? (await caches.match(ROOT));
    }
  })());
});

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Sahaya", {
    body: d.body || "", tag: d.tag, renotify: true, requireInteraction: !!d.urgent, icon: ROOT + "icon-192.png", data: { url: d.url || ROOT },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window" });
    if (all[0]) return all[0].focus();
    return self.clients.openWindow(e.notification.data?.url || ROOT);
  })());
});
