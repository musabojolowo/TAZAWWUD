// ============================================================================
// TAZAWWUD — Service Worker
// ----------------------------------------------------------------------------
// Phase 2: Lightweight static-asset caching (app shell) using a
// cache-first strategy with network fallback. No Firebase logic here.
// Bump CACHE_VERSION whenever cached assets change, to bust old caches.
// ============================================================================

const CACHE_VERSION = "tazawwud-shell-v33";

const APP_SHELL_ASSETS = [
  "/",
  "/index.html",
  "/css/style.css",
  "/js/app.js",
  "/js/theme-preload.js",
  "/js/sidebar.js",
  "/js/reminders.js",
  "/js/home.js",
  "/js/tasbih.js",
  "/js/stories.js",
  "/js/admin.js",
  "/js/daily-content.js",
  "/js/quran.js",
  "/js/mushaf.js",
  "/js/hadith.js",
  "/js/hisn.js",
  "/js/salah.js",
  "/js/notifications.js",
  "/js/qibla.js",
  "/js/calendar.js",
  "/js/adhkar.js",
  "/js/storage.js",
  "/js/cloud-sync.js",
  "/js/error-boundary.js",
  "/js/html-utils.js",
  "/js/theme.js",
  "/js/auth.js",
  "/js/bookmarks.js",
  "/js/firebase-config.js",
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

const API_HOSTS = new Set([
  "api.alquran.cloud",
  "api.aladhan.com",
  "cdn.jsdelivr.net",
  "raw.githubusercontent.com",
]);

const STATIC_DESTINATIONS = new Set(["style", "script", "font", "image", "manifest"]);

function isApiRequest(request) {
  return API_HOSTS.has(new URL(request.url).hostname);
}

// Qur'an recitation audio (mp3quran.net, many server*.mp3quran.net
// subdomains) was previously untouched by this service worker entirely —
// requests fell through to the browser's default network fetch with no
// caching at all, so nothing played once was ever available offline.
function isAudioRequest(request) {
  if (request.destination === "audio") return true;
  return new URL(request.url).hostname.endsWith(".mp3quran.net");
}

function isStaticRequest(request) {
  const url = new URL(request.url);
  return request.destination === "font"
    || (url.origin === self.location.origin
      && (STATIC_DESTINATIONS.has(request.destination) || url.pathname.endsWith(".json")));
}

async function cacheResponse(request, response) {
  if (!response || (!response.ok && response.type !== "opaque")) return response;
  const cache = await caches.open(CACHE_VERSION);
  // Don't make the page wait for the cache write: multi-MB responses (full
  // Hadith collections) were being held back until they were fully stored.
  cache.put(request, response.clone()).catch(() => {});
  return response;
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  return cacheResponse(request, await fetch(request));
}

async function networkFirst(request) {
  try {
    return await cacheResponse(request, await fetch(request));
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw new Error("Offline and no cached response is available");
  }
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const request = event.request;
  const isNavigation = request.mode === "navigate";

  if (isNavigation) {
    event.respondWith(
      networkFirst(request).catch(() => caches.match("/index.html"))
    );
    return;
  }

  if (isApiRequest(request)) {
    event.respondWith(networkFirst(request));
    return;
  }

  // Cache-first: a given reciter's recording of a given Surah never
  // changes, so once played it should replay instantly and work offline
  // without ever re-fetching. (Cache Storage has far more headroom than
  // localStorage, so multi-megabyte Surah recordings are fine here.)
  if (isAudioRequest(request)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (isStaticRequest(request)) {
    event.respondWith(cacheFirst(request));
  }
});
