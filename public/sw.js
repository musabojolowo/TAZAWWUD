// ============================================================================
// TAZAWWUD — Service Worker
// ----------------------------------------------------------------------------
// Phase 2: Lightweight static-asset caching (app shell) using a
// cache-first strategy with network fallback. No Firebase logic here.
// Bump CACHE_VERSION whenever cached assets change, to bust old caches.
// ============================================================================

const CACHE_VERSION = "tazawwud-shell-v71";
// Icon and text fonts are kept in their own cache, so they survive version changes.
const FONT_CACHE = "tazawwud-fonts-v1";

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
  "/js/names99.js",
  "/js/mosque.js",
  "/js/salah.js",
  "/js/notifications.js",
  "/js/qibla.js",
  "/js/calendar.js",
  "/js/adhkar.js",
  "/js/storage.js",
  "/js/cloud-sync.js",
  "/js/error-boundary.js",
  "/js/idb-cache.js",
  "/js/geo.js",
  "/js/native-bridge.js",
  "/js/notification-hub.js",
  "/js/notifications-view.js",
  "/js/bookmarks-view.js",
  "/js/notification-prefs.js",
  "/js/magnetic.js",
  "/js/download-manager.js",
  "/js/downloads-ui.js",
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
      // cache: "reload" bypasses the browser HTTP cache, so a precached copy
      // is never an older file from before a deploy.
      .then((cache) => cache.addAll(APP_SHELL_ASSETS.map((url) => new Request(url, { cache: "reload" }))))
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
            // Offline downloads (tazawwud-offline-*) survive version bumps.
            .filter((name) => name !== CACHE_VERSION && name !== FONT_CACHE && !name.startsWith("tazawwud-offline-"))
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

// App code (scripts, styles, manifest) is fetched from the network first, so a
// deploy is picked up on the next load. The cache is used only when offline.
function isAppCodeRequest(request) {
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  return ["script", "style", "manifest"].includes(request.destination)
    || /\.(js|css|webmanifest)$/.test(url.pathname);
}

function isStaticRequest(request) {
  const url = new URL(request.url);
  if (request.destination === "font") return true;
  if (url.origin === self.location.origin) {
    return STATIC_DESTINATIONS.has(request.destination) || url.pathname.endsWith(".json");
  }

  // Firebase's modular SDK is imported from gstatic at runtime; cache those
  // modules after first use so a previously initialized app can start offline.
  // Google Fonts' stylesheet is also cacheable; font files are handled above.
  return (url.hostname === "www.gstatic.com" && request.destination === "script")
    || (url.hostname === "fonts.googleapis.com" && request.destination === "style");
}

// Stores a successful response for offline use. Runs through
// event.waitUntil(), so the browser keeps the service worker alive until the
// write has committed, while the page receives its response immediately.
// A failed write (quota, unavailable cache) is logged and never changes the
// live response.
async function storeResponse(request, response) {
  try {
    const cache = await caches.open(CACHE_VERSION);
    await cache.put(request, response);
  } catch (error) {
    console.warn("[TAZAWWUD SW] Cache write failed:", request.url, error);
  }
}

function cacheResponse(event, request, response) {
  if (response && (response.ok || response.type === "opaque")) {
    event.waitUntil(storeResponse(request, response.clone()));
  }
  return response;
}

async function cacheFirst(event, request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  return cacheResponse(event, request, await fetch(request));
}

async function networkFirst(event, request) {
  try {
    return cacheResponse(event, request, await fetch(request));
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw new Error("Offline and no cached response is available");
  }
}

// Tapping an alert opens the app (or brings the open app to the front) at the
// page stored with the alert, such as /#salah or /#home.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/#home";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          // An open window moves to the alert's page, not just to the front.
          if ("navigate" in client) {
            return client.navigate(target).then(() => client.focus(), () => client.focus());
          }
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});

function isFontRequest(request) {
  const host = new URL(request.url).hostname;
  return request.destination === "font"
    || host === "fonts.gstatic.com"
    || (host === "fonts.googleapis.com" && request.destination === "style");
}

async function fontCacheFirst(event, request) {
  const cache = await caches.open(FONT_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    // Opaque responses (cross-origin, no CORS) are stored too, so the icon font works offline.
    if (response.ok || response.type === "opaque") {
      event.waitUntil(cache.put(request, response.clone()).catch(() => {}));
    }
    return response;
  } catch (error) {
    return cached || Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const request = event.request;
  const isNavigation = request.mode === "navigate";

  if (isNavigation) {
    event.respondWith(
      networkFirst(event, request).catch(async () => {
        const cache = await caches.open(CACHE_VERSION);
        return cache.match("/index.html");
      })
    );
    return;
  }

  // Fonts (the icon font and Arabic text font) are cached once used, so they work offline.
  if (isFontRequest(request)) {
    event.respondWith(fontCacheFirst(event, request));
    return;
  }

  // Third-party files (the Firebase SDK, Google Fonts) go straight to the network.
  // Caching them here can serve a stored copy that a module or stylesheet cannot
  // use, which breaks the account features and the icon font. Our own API hosts
  // and audio are still handled below.
  const isThirdParty = new URL(request.url).origin !== self.location.origin;
  if (isThirdParty && !isApiRequest(request) && !isAudioRequest(request)) return;

  if (isApiRequest(request) || isAppCodeRequest(request)) {
    event.respondWith(networkFirst(event, request));
    return;
  }

  // Cache-first: a given reciter's recording of a given Surah never
  // changes, so once played it should replay instantly and work offline
  // without ever re-fetching. (Cache Storage has far more headroom than
  // localStorage, so multi-megabyte Surah recordings are fine here.)
  if (isAudioRequest(request)) {
    event.respondWith(cacheFirst(event, request));
    return;
  }

  if (isStaticRequest(request)) {
    event.respondWith(cacheFirst(event, request));
  }
});
