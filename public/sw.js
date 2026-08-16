// Service worker for the fast_menu PWA.
// Strategy:
//   - Navigations   -> network-first, fall back to cache, then to /offline.
//     (Menu prices/availability and dashboard data change frequently, so we
//     always prefer a live response and only serve cache when offline.)
//   - Static assets -> stale-while-revalidate (fast, self-healing).
// Bump CACHE_VERSION whenever the precache list or strategy changes.

const CACHE_VERSION = "v1";
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
