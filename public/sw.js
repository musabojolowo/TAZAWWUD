// ============================================================================
// TAZAWWUD — Service Worker
// ----------------------------------------------------------------------------
// Phase 2: Lightweight static-asset caching (app shell) using a
// cache-first strategy with network fallback. No Firebase logic here.
// Bump CACHE_VERSION whenever cached assets change, to bust old caches.
// ============================================================================

const CACHE_VERSION = "tazawwud-shell-v1";

const APP_SHELL_ASSETS = [
  "/",
  "/index.html",
  "/css/style.css",
  "/js/app.js",
  "/manifest.json",
];

// -- Install: pre-cache the app shell -----------------------------------
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// -- Activate: clean up old cache versions -------------------------------
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_VERSION)
            .map((name) => caches.delete(name))
        )
      )
      .then(() => self.clients.claim())
  );
});

// -- Fetch: cache-first, falling back to network -------------------------
self.addEventListener("fetch", (event) => {
  // Only handle same-origin GET requests; let everything else (e.g. Firebase
  // calls, cross-origin font requests) pass straight through to the network.
  if (event.request.method !== "GET" || !event.request.url.startsWith(self.location.origin)) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(event.request)
        .then((networkResponse) => {
          // Cache a copy of newly fetched app-shell-like assets for next time.
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_VERSION).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // Offline fallback for navigation requests.
          if (event.request.mode === "navigate") {
            return caches.match("/index.html");
          }
        });
    })
  );
});
