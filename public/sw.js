// Service worker for the fast_menu PWA.
// Strategy:
//   - Navigations   -> network-first, fall back to cache, then to /offline.
//     (Menu prices/availability and dashboard data change frequently, so we
//     always prefer a live response and only serve cache when offline.)
//   - Static assets -> stale-while-revalidate (fast, self-healing).
// Bump CACHE_VERSION whenever the precache list or strategy changes.

const CACHE_VERSION = "v2";
const CACHE_NAME = `fast-menu-${CACHE_VERSION}`;

// App shell + assets safe to precache. Hashed Next.js build assets are cached
// at runtime instead, so we keep this list small and stable.
const PRECACHE_URLS = [
  "/",
  "/offline",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      // addAll is atomic; if one URL 404s the whole install fails, so cache
      // individually and ignore misses.
      .then((cache) =>
        Promise.all(
          PRECACHE_URLS.map((url) => cache.add(url).catch(() => undefined)),
        ),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only handle GET; let the browser deal with POST/etc. (dashboard writes,
  // Supabase auth, etc. must always hit the network).
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Never touch cross-origin requests (Supabase API/storage, fonts, etc.).
  if (url.origin !== self.location.origin) return;

  // Never cache API routes — QR generation and other server actions must
  // always be fresh.
  if (url.pathname.startsWith("/api/")) return;

  // HTML navigations -> network-first with offline fallback. Covers the
  // marketing page, public menus (/m/[slug]) and the owner dashboard, all of
  // which can change (prices, 86'd dishes, edits) and should never go stale
  // silently.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          return cached || caches.match("/offline");
        }),
    );
    return;
  }

  // Static assets -> stale-while-revalidate.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.status === 200 && response.type === "basic") {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});

// Allow the page to trigger an immediate activation after an update.
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

// ---------------------------------------------------------------------------
// Web Push for staff: a new guest order or a "call waiter" request arrives as
// a JSON payload {title, body, url, tag}. Tapping the notification focuses an
// open tab (or opens one) at that URL.
// ---------------------------------------------------------------------------
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "fast_menu";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      tag: data.tag || undefined,
      renotify: Boolean(data.tag),
      data: { url: data.url || "/waiter" },
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      vibrate: [120, 60, 120],
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/waiter";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if ("navigate" in client && "focus" in client) {
            return client.navigate(url).then((c) => (c || client).focus());
          }
        }
        return self.clients.openWindow(url);
      }),
  );
});
