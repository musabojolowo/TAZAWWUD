// ============================================================================
// TAZAWWUD — Theme Module (Dark Mode)
// ----------------------------------------------------------------------------
// The actual theme (light/dark) is applied as early as possible via a tiny
// inline synchronous script in index.html's <head>, BEFORE this module (or
// any of app.js) even loads — that's what prevents a flash of the wrong
// theme on page load. This module only handles what happens AFTER that:
// keeping the toggle button's icon in sync, persisting changes, and
// updating the PWA status-bar color to match.
// ============================================================================

const THEME_STORAGE_KEY = "tazawwud:theme";
const THEME_COLOR_LIGHT = "#0F5C4A";
const THEME_COLOR_DARK = "#0D1614";

function getCurrentTheme() {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(THEME_STORAGE_KEY, theme);

  const metaThemeColor = document.querySelector('meta[name="theme-color"]');
  if (metaThemeColor) {
    metaThemeColor.setAttribute("content", theme === "dark" ? THEME_COLOR_DARK : THEME_COLOR_LIGHT);
  }

  updateToggleIcon(theme);
}

function updateToggleIcon(theme) {
  const btn = document.getElementById("theme-toggle-btn");
  if (!btn) return;
  const icon = btn.querySelector(".material-symbols-rounded");
  // Icon shows the mode you'd SWITCH TO, matching common convention:
  // sun-icon while dark is active (tap to go light), moon while light is active.
  icon.textContent = theme === "dark" ? "light_mode" : "dark_mode";
  btn.setAttribute("aria-label", theme === "dark" ? "Switch to light mode" : "Switch to dark mode");
}

/** Mounts the toggle button's click handler and syncs its icon to the current theme. */
export function initThemeToggle() {
  updateToggleIcon(getCurrentTheme());

  const btn = document.getElementById("theme-toggle-btn");
  btn?.addEventListener("click", () => {
    const next = getCurrentTheme() === "dark" ? "light" : "dark";
    applyTheme(next);
  });
}
