// ============================================================================
// TAZAWWUD — Main Application Entry Point
// ----------------------------------------------------------------------------
// Phase 2: Application Foundation.
// This module bootstraps global app state and confirms the shell has loaded.
// Feature modules (Qur'an, Sunnah, Salah, Daily Guidance) will be imported
// and mounted into #app-root in later phases.
// ============================================================================

import { auth, db } from "./firebase-config.js";

/**
 * Central, lightweight app state.
 * Kept as a plain object (no framework) so any module can read/mutate it
 * via the exported reference.
 */
export const appState = {
  isReady: false,
  user: null, // populated by Firebase Auth once auth flows are implemented
  currentView: "home",
};

/**
 * Sets the current year in the footer.
 */
function renderFooterYear() {
  const yearEl = document.getElementById("year");
  if (yearEl) {
    yearEl.textContent = new Date().getFullYear();
  }
}

/**
 * Entry point — runs once the DOM is ready.
 */
function initApp() {
  renderFooterYear();

  appState.isReady = true;

  console.log(
    "%c[TAZAWWUD] App shell initialized successfully.",
    "color:#0F5C4A; font-weight:bold;"
  );
  console.log("[TAZAWWUD] Firebase Auth instance:", auth);
  console.log("[TAZAWWUD] Firebase Realtime Database instance:", db);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}
