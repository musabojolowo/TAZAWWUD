// ============================================================================
// TAZAWWUD — Main Application Entry Point
// ----------------------------------------------------------------------------
// Phase 4, Part 2: extends the view-router with a "reader" view (single
// Surah, opened by tapping a card in the Qur'an list) that sits under the
// Qur'an tab but isn't a nav destination of its own.
//
// Phase 5 (targeted update): adds a "mushaf" view — the real page-by-page
// Qur'an reading experience — as the new default destination when a Surah
// is tapped from the list. The old verse-card "reader" view is NOT removed
// (per explicit instruction not to delete existing features); both views
// stay fully wired, and each links to the other, so switching between them
// is one tap rather than a rebuild.
// ============================================================================

import { initThemeToggle } from "./theme.js";
import { isOffline } from "./storage.js";
// Firebase-backed features (account, cloud sync, sidebar, reminders) are loaded
// by initFirebaseFeatures() so a Firebase failure cannot stop navigation.

/**
 * Central, lightweight app state.
 */
export const appState = {
  isReady: false,
  user: null, // populated by Firebase Auth once auth flows are implemented
  currentView: "home",
};

// "reader" and "mushaf" are reachable (Surah tapped from the list, or the
// switch-view links) but have no nav link of their own — their nav-highlight
// is treated the same as "quran" (see NAV_GROUP).
const VALID_VIEWS = ["home", "quran", "sunnah", "salah", "qiblah", "calendar", "tasbih", "stories", "admin", "dua", "names99", "mosque", "reader", "mushaf"];
const NAV_GROUP = { reader: "quran", mushaf: "quran" };

let quranModulePromise = null;
function loadQuranModule() {
  if (!quranModulePromise) {
    quranModulePromise = import("./quran.js");
  }
  return quranModulePromise;
}

let mushafModulePromise = null;
function loadMushafModule() {
  if (!mushafModulePromise) {
    mushafModulePromise = import("./mushaf.js");
  }
  return mushafModulePromise;
}

let hadithModulePromise = null;
function loadHadithModule() {
  if (!hadithModulePromise) {
    hadithModulePromise = import("./hadith.js");
  }
  return hadithModulePromise;
}

let salahModulePromise = null;
function loadSalahModule() {
  if (!salahModulePromise) {
    salahModulePromise = import("/js/salah.js");
  }
  return salahModulePromise;
}

let qiblaModulePromise = null;
function loadQiblaModule() {
  if (!qiblaModulePromise) {
    qiblaModulePromise = import("/js/qibla.js");
  }
  return qiblaModulePromise;
}

let calendarModulePromise = null;
function loadCalendarModule() {
  if (!calendarModulePromise) {
    calendarModulePromise = import("/js/calendar.js");
  }
  return calendarModulePromise;
}

let adhkarModulePromise = null;
function loadAdhkarModule() {
  if (!adhkarModulePromise) {
    adhkarModulePromise = import("/js/adhkar.js");
  }
  return adhkarModulePromise;
}

let homeModulePromise = null;
function loadHomeModule() {
  if (!homeModulePromise) {
    homeModulePromise = import("/js/home.js");
  }
  return homeModulePromise;
}

let tasbihModulePromise = null;
function loadTasbihModule() {
  if (!tasbihModulePromise) {
    tasbihModulePromise = import("/js/tasbih.js");
  }
  return tasbihModulePromise;
}

let storiesModulePromise = null;
function loadStoriesModule() {
  if (!storiesModulePromise) {
    storiesModulePromise = import("/js/stories.js");
  }
  return storiesModulePromise;
}

let duaModulePromise = null;
function loadHisnModule() {
  if (!duaModulePromise) duaModulePromise = import("/js/hisn.js");
  return duaModulePromise;
}

let names99ModulePromise = null;
function loadNames99Module() {
  if (!names99ModulePromise) names99ModulePromise = import("/js/names99.js");
  return names99ModulePromise;
}

let mosqueModulePromise = null;
function loadMosqueModule() {
  if (!mosqueModulePromise) mosqueModulePromise = import("/js/mosque.js");
  return mosqueModulePromise;
}

let adminModulePromise = null;
function loadAdminModule() {
  if (!adminModulePromise) {
    adminModulePromise = import("/js/admin.js");
  }
  return adminModulePromise;
}

let dailyContentModulePromise = null;
function loadDailyContentModule() {
  if (!dailyContentModulePromise) {
    dailyContentModulePromise = import("/js/daily-content.js");
  }
  return dailyContentModulePromise;
}

/** Sets the current year in the footer. */
function renderFooterYear() {
  const yearEl = document.getElementById("year");
  if (yearEl) {
    yearEl.textContent = new Date().getFullYear();
  }
}

function initNetworkStatus() {
  const status = document.getElementById("network-status");
  if (!status) return;

  const render = () => {
    const offline = isOffline();
    status.hidden = !offline;
    status.textContent = offline
      ? "You are offline. Saved content remains available."
      : "";
  };

  window.addEventListener("online", render);
  window.addEventListener("offline", render);
  render();
}

/** Account button, sync status and auto-sync. Receives the modules that
 *  initFirebaseFeatures() loaded. */
function initCloudSync({ cloud, authModule }) {
  const { syncUserData, restoreUserData, watchAuthAndSync } = cloud;
  const { signInWithGoogle, getUid } = authModule;
  const status = document.getElementById("sync-status");
  const signInButton = document.getElementById("google-sign-in-btn");
  const onStatus = ({ message, isError = false }) => {
    if (!status) return;
    status.hidden = false;
    status.textContent = message;
    status.classList.toggle("sync-status--error", isError);
    window.setTimeout(() => {
      status.hidden = true;
    }, 5000);
  };

  watchAuthAndSync({ onStatus });
  window.addEventListener("online", () => syncUserData({ onStatus }));
  signInButton?.addEventListener("click", async () => {
    signInButton.disabled = true;
    const previousUid = getUid();
    try {
      const { user, isNewLink } = await signInWithGoogle();
      if (!isNewLink && previousUid && previousUid !== user.uid) {
        // The anonymous uid couldn't be linked (this Google account already
        // has its own account) — carry its local bookmarks over rather than
        // losing them.
        const { mergeLocalBookmarksIntoCloud } = await import("./bookmarks.js");
        const merged = await mergeLocalBookmarksIntoCloud(previousUid, user.uid);
        if (merged) onStatus({ message: `Signed in — merged ${merged} local bookmark(s) into your account.` });
      }
      await restoreUserData({ onStatus });
      await syncUserData({ onStatus });
    } catch (error) {
      console.error("[TAZAWWUD] Google sign-in failed:", error);
      onStatus({ message: "Google sign-in was unavailable. Your local data is safe.", isError: true });
    } finally {
      signInButton.disabled = false;
    }
  });
}

/**
 * Shows the requested view panel and hides the rest; updates the
 * `is-active` state on every nav link (top nav + bottom nav) that
 * points at that view (or its nav group, e.g. "reader"/"mushaf" -> "quran").
 */
function showView(viewName) {
  if (!VALID_VIEWS.includes(viewName)) {
    viewName = "home";
  }

  // Leaving a Qur'an-audio-playing view should stop any ayah/Surah audio
  // currently playing, and — for the Mushaf view specifically — cancel any
  // in-progress auto-scroll animation too.
  if (appState.currentView === "reader" && viewName !== "reader") {
    loadQuranModule().then(({ stopReaderAudio }) => stopReaderAudio());
  }
  if (appState.currentView === "mushaf" && viewName !== "mushaf") {
    loadMushafModule().then(({ stopReadingAudio }) => stopReadingAudio());
  }
  if (appState.currentView === "home" && viewName !== "home") {
    loadHomeModule().then(({ stopHomeDashboard }) => stopHomeDashboard());
  }
  // Both have live Firebase listeners (onValue) that must be detached when
  // leaving, or they'd keep running — and keep re-rendering a now-hidden
  // view — for the rest of the session.
  if (appState.currentView === "stories" && viewName !== "stories") {
    loadStoriesModule().then(({ stopStories }) => stopStories());
  }
  // If the compass was enabled, its deviceorientation listeners otherwise
  // keep running — and keep recomputing the (now-hidden) needle rotation —
  // for the rest of the app session on every other view.
  if (appState.currentView === "qiblah" && viewName !== "qiblah") {
    loadQiblaModule().then(({ stopQibla }) => stopQibla());
  }
  if (appState.currentView === "admin" && viewName !== "admin") {
    loadAdminModule().then(({ stopAdmin }) => stopAdmin());
  }

  document.querySelectorAll("[data-view-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.viewPanel !== viewName;
  });

  const activeGroup = NAV_GROUP[viewName] || viewName;
  document.querySelectorAll("[data-view]").forEach((link) => {
    link.classList.toggle("is-active", link.dataset.view === activeGroup);
  });

  appState.currentView = viewName;

  if (viewName === "home") {
    const homeDashboardRootEl = document.getElementById("home-dashboard-root");
    loadHomeModule()
      .then(({ initHomeDashboard }) => initHomeDashboard(homeDashboardRootEl))
      .catch((error) => {
        console.error("[TAZAWWUD] Failed to load Home dashboard module:", error);
        renderModuleError(homeDashboardRootEl, "Home couldn't load. Check your connection, then reload.");
      });

    const featuredContentRootEl = document.getElementById("daily-featured-content-root");
    loadDailyContentModule()
      .then(({ initDailyFeaturedContent }) => initDailyFeaturedContent(featuredContentRootEl))
      .catch((error) => console.error("[TAZAWWUD] Failed to load daily featured content:", error));

    renderContinueReadingBanner("continue-reading-banner-home");
  }

  if (viewName === "quran") {
    const surahListEl = document.getElementById("surah-list");
    loadQuranModule()
      .then(({ initSurahList }) => initSurahList(surahListEl, openSurah))
      .catch((error) => console.error("[TAZAWWUD] Failed to load Qur'an module:", error));
    renderContinueReadingBanner("continue-reading-banner");
  }

  if (viewName === "sunnah") {
    const hadithRootEl = document.getElementById("hadith-root");
    loadHadithModule()
      .then(({ initHadithSection }) => initHadithSection(hadithRootEl))
      .catch((error) => console.error("[TAZAWWUD] Failed to load Hadith module:", error));
  }

  if (viewName === "salah") {
    const salahRootEl = document.getElementById("salah-root");
    loadSalahModule()
      .then(({ initSalah }) => initSalah(salahRootEl))
      .catch((error) => console.error("[TAZAWWUD] Failed to load Salah module:", error));
  }

  if (viewName === "qiblah") {
    const qiblaRootEl = document.getElementById("qiblah-root");
    loadQiblaModule()
      .then(({ initQibla }) => initQibla(qiblaRootEl))
      .catch((error) => console.error("[TAZAWWUD] Failed to load Qiblah module:", error));
  }

  if (viewName === "calendar") {
    const calendarRootEl = document.getElementById("calendar-root");
    loadCalendarModule()
      .then(({ initCalendar }) => initCalendar(calendarRootEl))
      .catch((error) => console.error("[TAZAWWUD] Failed to load Calendar module:", error));
  }

  if (viewName === "tasbih") {
    const tasbihRootEl = document.getElementById("tasbih-root");
    loadTasbihModule()
      .then(({ initTasbih }) => initTasbih(tasbihRootEl))
      .catch((error) => console.error("[TAZAWWUD] Failed to load Tasbih module:", error));
  }

  if (viewName === "stories") {
    const storiesRootEl = document.getElementById("stories-root");
    loadStoriesModule()
      .then(({ initStories }) => initStories(storiesRootEl))
      .catch((error) => console.error("[TAZAWWUD] Failed to load Stories module:", error));
  }

  if (viewName === "dua") {
    const duaRootEl = document.getElementById("dua-root");
    loadHisnModule()
      .then(({ openHisnMuslim }) => openHisnMuslim(duaRootEl, {
        nameAr: "حصن المسلم",
        nameEn: "Hisn al-Muslim",
        onBack: () => navigateTo("home"),
      }))
      .catch((error) => console.error("[TAZAWWUD] Failed to load Dua & Dhikr:", error));
  }

  if (viewName === "names99") {
    const names99RootEl = document.getElementById("names99-root");
    loadNames99Module()
      .then(({ initNames99 }) => initNames99(names99RootEl))
      .catch((error) => console.error("[TAZAWWUD] Failed to load 99 Names:", error));
  }

  if (viewName === "mosque") {
    const mosqueRootEl = document.getElementById("mosque-root");
    loadMosqueModule()
      .then(({ initMosque }) => initMosque(mosqueRootEl))
      .catch((error) => console.error("[TAZAWWUD] Failed to load Mosque Finder:", error));
  }

  if (viewName === "admin") {
    const adminRootEl = document.getElementById("admin-root");
    loadAdminModule()
      .then(({ initAdmin }) => initAdmin(adminRootEl))
      .catch((error) => console.error("[TAZAWWUD] Failed to load Admin module:", error));
  }
}

/** Shows a "Continue Reading — Surah N" banner if there's a locally-saved last-read Surah. */
function renderContinueReadingBanner(bannerId = "continue-reading-banner") {
  const banner = document.getElementById(bannerId);
  if (!banner) return;

  const lastSurah = localStorage.getItem("tazawwud:lastReadSurah");
  if (!lastSurah) {
    banner.innerHTML = "";
    return;
  }

  banner.innerHTML = `
    <button type="button" class="continue-reading-btn">
      <span class="material-symbols-rounded icon" aria-hidden="true">auto_stories</span>
      <span>Continue Reading — Sūrah ${lastSurah}</span>
      <span class="material-symbols-rounded icon" aria-hidden="true">chevron_right</span>
    </button>
  `;
  banner.querySelector(".continue-reading-btn").addEventListener("click", () => openSurah(Number(lastSurah)));
}

/**
 * Opens the Mushaf (page-by-page) view for a single Surah — the default
 * reading experience. Called from the Surah list.
 */
function openSurah(surahNumber) {
  showView("mushaf");
  history.pushState(null, "", `#quran/${surahNumber}`);

  const mushafRootEl = document.getElementById("mushaf-root");
  loadMushafModule()
    .then(({ openSurahInMushaf }) => openSurahInMushaf(mushafRootEl, surahNumber))
    .catch((error) => console.error("[TAZAWWUD] Failed to load Mushaf module:", error));
}

/** Opens the old verse-card reader for a single Surah (still fully available). */
function openSurahInReader(surahNumber) {
  showView("reader");
  history.pushState(null, "", `#quran/${surahNumber}/verses`);

  const readerContentEl = document.getElementById("reader-content");
  loadQuranModule()
    .then(({ loadSurahDetail }) => loadSurahDetail(readerContentEl, surahNumber))
    .catch((error) => console.error("[TAZAWWUD] Failed to load Qur'an module:", error));
}

/**
 * Wires every element with a `data-view` attribute (top nav + bottom nav)
 * to the router, the reader's/mushaf's back buttons and cross-links, and
 * syncs the initial view with the URL hash (supports deep links like
 * #quran/36 for Mushaf and #quran/36/verses for the classic reader).
 */
/**
 * Switches to a view and updates the URL hash — the one canonical way to
 * navigate. Used by the click-wired [data-view] elements (top header,
 * bottom nav) and importable directly by any module (Home's Quick Access,
 * the settings sidebar, Tasbih, etc.) for views that don't have their own
 * static nav-link element to click.
 */
export function navigateTo(viewName) {
  showView(viewName);
  history.replaceState(null, "", `#${viewName}`);
}

function initRouter() {
  document.querySelectorAll("[data-view]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      navigateTo(link.dataset.view);
    });
  });

  document.getElementById("reader-back-btn")?.addEventListener("click", () => {
    showView("quran");
    history.replaceState(null, "", "#quran");
  });

  document.getElementById("mushaf-back-btn")?.addEventListener("click", () => {
    showView("quran");
    history.replaceState(null, "", "#quran");
  });

  // Cross-links between the two reading experiences (nothing is removed —
  // both stay one tap away from each other).
  document.getElementById("mushaf-switch-to-verses-btn")?.addEventListener("click", () => {
    const surahNumber = document.getElementById("mushaf-root")?.dataset.currentSurah;
    openSurahInReader(Number(surahNumber) || 1);
  });
  document.getElementById("reader-switch-to-mushaf-btn")?.addEventListener("click", () => {
    const surahNumber = document.getElementById("reader-content")?.dataset.currentSurah;
    openSurah(Number(surahNumber) || 1);
  });

  const hash = window.location.hash.replace("#", "");
  const [initialView, deepLinkSurah, deepLinkMode] = hash.split("/");

  if (initialView === "quran" && deepLinkSurah) {
    showView("quran"); // mount the list first so "Back" has somewhere to go
    if (deepLinkMode === "verses") {
      openSurahInReader(Number(deepLinkSurah));
    } else {
      openSurah(Number(deepLinkSurah));
    }
  } else {
    showView(initialView || "home");
  }
}

/** Replaces a loading placeholder with a message and a reload button, so a
 *  failed module never leaves the page stuck on "Loading…". */
function renderModuleError(root, message) {
  if (!root) return;
  root.setAttribute("aria-busy", "false");
  root.innerHTML = `
    <section class="module-error" role="alert">
      <p>${message}</p>
      <button type="button" class="salah-button" data-module-reload>Reload</button>
    </section>
  `;
  root.querySelector("[data-module-reload]")?.addEventListener("click", () => window.location.reload());
}

/** Shows that account features are unavailable, without affecting the pages. */
function showAccountUnavailable() {
  const button = document.getElementById("google-sign-in-btn");
  if (button) {
    button.disabled = true;
    button.textContent = "Account unavailable";
  }
  const status = document.getElementById("sync-status");
  if (status) {
    status.hidden = false;
    status.textContent = "Account and cloud sync are unavailable right now. The pages still work.";
    status.classList.add("sync-status--error");
  }
}

/**
 * Loads the Firebase-backed features on demand. Each module loads independently,
 * so one failure leaves the others working, and the account area says so.
 */
async function initFirebaseFeatures() {
  const [cloudResult, authResult, sidebarResult, reminderResult, configResult] = await Promise.allSettled([
    import("./cloud-sync.js"),
    import("./auth.js"),
    import("./sidebar.js"),
    import("./reminders.js"),
    import("./firebase-config.js"),
  ]);

  if (cloudResult.status === "fulfilled" && authResult.status === "fulfilled") {
    initCloudSync({ cloud: cloudResult.value, authModule: authResult.value });
  } else {
    console.warn("[TAZAWWUD] Account features unavailable:", (cloudResult.reason || authResult.reason)?.message);
    showAccountUnavailable();
  }

  if (sidebarResult.status === "fulfilled") {
    sidebarResult.value.initSidebar();
  } else {
    console.warn("[TAZAWWUD] Settings sidebar unavailable:", sidebarResult.reason?.message);
    // Keep the account/settings panel reachable even if its Firebase-dependent
    // module graph fails to load. Account actions may be unavailable, but the
    // rest of the panel and navigation must not disappear with Firebase.
    const accountButton = document.getElementById("account-menu-btn");
    const sidebar = document.getElementById("settings-sidebar");
    const backdrop = document.getElementById("sidebar-backdrop");
    const closeButton = document.getElementById("sidebar-close-btn");
    const closeFallback = () => {
      if (sidebar) sidebar.hidden = true;
      if (backdrop) backdrop.hidden = true;
      document.body.style.overflow = "";
    };
    accountButton?.addEventListener("click", () => {
      if (sidebar) sidebar.hidden = false;
      if (backdrop) backdrop.hidden = false;
      document.body.style.overflow = "hidden";
    });
    closeButton?.addEventListener("click", closeFallback);
    backdrop?.addEventListener("click", closeFallback);
  }

  if (reminderResult.status === "fulfilled") {
    reminderResult.value.startReminders();
  } else {
    console.warn("[TAZAWWUD] Daily reminders unavailable:", reminderResult.reason?.message);
  }

  if (configResult.status === "fulfilled") {
    console.log("[TAZAWWUD] Firebase Auth instance:", configResult.value.auth);
    console.log("[TAZAWWUD] Firebase Realtime Database instance:", configResult.value.db);
  }
}

/** Entry point — runs once the DOM is ready. */
function initApp() {
  renderFooterYear();
  initRouter();
  initThemeToggle();
  initNetworkStatus();
  // Firebase-backed features load separately; a failure here never blocks navigation.
  initFirebaseFeatures().catch((error) => {
    console.warn("[TAZAWWUD] Firebase features failed to start:", error?.message);
    showAccountUnavailable();
  });
  // Loads the download manifest and keeps "Offline" badges in sync. Light
  // startup cost: heavy Qur'an/Hadith modules are not loaded here.
  import("/js/downloads-ui.js")
    .then(({ initDownloads }) => initDownloads())
    .catch((error) => console.warn("[TAZAWWUD] Offline downloads unavailable:", error));

  appState.isReady = true;

  console.log(
    "%c[TAZAWWUD] App shell initialized successfully.",
    "color:#0F5C4A; font-weight:bold;"
  );
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}

// Moved here from an inline <script> in index.html so the CSP's script-src
// doesn't need 'unsafe-inline' — identical behavior/timing, just no longer
// inline (module scripts already run after the DOM is parsed).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => console.log("[TAZAWWUD] Service worker registered:", reg.scope))
      .catch((err) => console.error("[TAZAWWUD] Service worker registration failed:", err));
  });
}
