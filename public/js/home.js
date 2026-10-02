// ============================================================================
// TAZAWWUD — Home Dashboard (Next Prayer, today's five prayers, Quick Access)
// ----------------------------------------------------------------------------
// This is NOT a second prayer-calculation system: every prayer time and the
// countdown target come from the existing Salah module (public/js/salah.js),
// which is also what the Salah tab itself renders from. Home and Salah share
// one saved location (see salah.js: saveLocation/loadSavedLocation), so
// picking a location in either place keeps both in sync.
// ============================================================================

import {
  PRAYERS,
  getPrayerSnapshot,
  hasSavedLocation,
  requestLocationHeadless,
} from "./salah.js";
import { formatGregorianDate, getTodayHijriLabel } from "./calendar.js";
import { navigateTo } from "./app.js";

let countdownTimer = null;
let hijriRequestToken = 0;

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character]);
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function formatCountdown(target) {
  const diffMs = target.getTime() - Date.now();
  if (diffMs <= 0) return "Now";
  const totalSeconds = Math.floor(diffMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

function clearCountdown() {
  if (countdownTimer) {
    window.clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

/** Compact grid — sizing/spacing lives in CSS (.home-quick-access*), not here. */
function renderQuickAccess() {
  const items = [
    { view: "quran", icon: "menu_book", label: "Qur'an" },
    { view: "sunnah", icon: "history_edu", label: "Hadith" },
    { view: "qiblah", icon: "explore", label: "Qiblah" },
    { view: "calendar", icon: "calendar_month", label: "Calendar" },
    { view: "tasbih", icon: "touch_app", label: "Tasbih" },
    { view: "stories", icon: "auto_stories", label: "Stories" },
  ];
  return `
    <section class="home-quick-access" aria-labelledby="home-quick-access-heading">
      <h3 id="home-quick-access-heading" class="home-quick-access__heading">Quick Access</h3>
      <div class="home-quick-access__grid">
        ${items.map((item) => `
          <button type="button" class="home-quick-access__item" data-goto-view="${item.view}">
            <span class="material-symbols-rounded icon" aria-hidden="true">${item.icon}</span>
            <span>${item.label}</span>
          </button>
        `).join("")}
      </div>
    </section>
  `;
}

/** Gregorian date renders instantly (local, no network); Hijri fills in
 *  once resolved so it never blocks showing the prayer card. */
function dateLineMarkup() {
  return `
    <p class="home-next-prayer__date">
      ${escapeHtml(formatGregorianDate(new Date()))}
      <span class="home-next-prayer__date-sep">•</span>
      <span data-home-hijri>…</span>
    </p>
  `;
}

async function fillHijriDate(root) {
  const token = ++hijriRequestToken;
  try {
    const label = await getTodayHijriLabel();
    if (token !== hijriRequestToken) return; // a newer render superseded this one
    const el = root.querySelector("[data-home-hijri]");
    if (el) el.textContent = label;
  } catch (error) {
    // getTodayHijriLabel() already falls back internally and shouldn't
    // reject, but a date lookup should never be able to break Home.
    console.warn("[TAZAWWUD] Could not resolve Hijri date:", error.message);
  }
}

/** Buttons carry data-goto-view rather than data-view so they don't get
 *  double-wired by app.js's own nav-link listener setup; instead they just
 *  trigger a click on the real nav link, reusing its existing router logic. */
function wireGotoViewButtons(root) {
  root.querySelectorAll("[data-goto-view]").forEach((button) => {
    button.addEventListener("click", () => navigateTo(button.dataset.gotoView));
  });
}

function renderNoLocation(root) {
  root.setAttribute("aria-busy", "false");
  root.innerHTML = `
    <section class="home-next-prayer home-next-prayer--empty">
      ${dateLineMarkup()}
      <p class="home-next-prayer__hint">
        Set your location to see the next prayer and today's prayer times here.
      </p>
      <div class="home-next-prayer__actions">
        <button type="button" class="salah-button" data-home-use-location>Use my location</button>
        <button type="button" class="salah-button salah-button--secondary" data-goto-view="salah">
          Choose a city
        </button>
      </div>
    </section>
    ${renderQuickAccess()}
  `;
  wireGotoViewButtons(root);
  fillHijriDate(root);

  root.querySelector("[data-home-use-location]").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "Getting your location…";
    try {
      const snapshot = await requestLocationHeadless();
      if (snapshot) {
        renderDashboard(root, snapshot);
      } else {
        renderNoLocation(root);
      }
    } catch (error) {
      console.warn("[TAZAWWUD] Home location request failed:", error.message);
      button.disabled = false;
      button.textContent = "Use my location";
    }
  });
}

function renderUnavailable(root) {
  root.setAttribute("aria-busy", "false");
  root.innerHTML = `
    <section class="home-next-prayer home-next-prayer--empty">
      ${dateLineMarkup()}
      <p class="home-next-prayer__hint">Unable to load prayer times right now. Please check your connection.</p>
      <div class="home-next-prayer__actions">
        <button type="button" class="salah-button salah-button--secondary" data-goto-view="salah">
          Open Salah
        </button>
      </div>
    </section>
    ${renderQuickAccess()}
  `;
  wireGotoViewButtons(root);
  fillHijriDate(root);
}

function renderDashboard(root, snapshot) {
  clearCountdown();
  root.setAttribute("aria-busy", "false");
  const { timings, locationLabel, state, next } = snapshot;

  const timelineItems = PRAYERS.map((prayer) => {
    const isCurrent = state.current?.key === prayer.key;
    const isNext = state.next?.key === prayer.key;
    return `
      <div class="home-prayer-timeline__item${isCurrent ? " is-current" : ""}${isNext ? " is-next" : ""}">
        <span class="home-prayer-timeline__name-ar" lang="ar" dir="rtl">${escapeHtml(prayer.arabic)}</span>
        <span class="home-prayer-timeline__name-en">${escapeHtml(prayer.name)}</span>
        <span class="home-prayer-timeline__time">${escapeHtml(timings[prayer.key] || "—")}</span>
      </div>
    `;
  }).join("");

  root.innerHTML = `
    <section class="home-next-prayer" aria-labelledby="home-next-prayer-heading">
      <div class="home-next-prayer__top">
        <span class="home-next-prayer__location">${escapeHtml(locationLabel || "Your location")}</span>
        <button type="button" class="home-next-prayer__change" data-goto-view="salah">Change</button>
      </div>
      ${dateLineMarkup()}
      <p class="home-next-prayer__eyebrow" id="home-next-prayer-heading">Next Prayer</p>
      <div class="home-next-prayer__main">
        <div class="home-next-prayer__name">
          <span class="home-next-prayer__name-ar" lang="ar" dir="rtl">${escapeHtml(next?.prayer.arabic || "")}</span>
          <span class="home-next-prayer__name-en">${next ? escapeHtml(next.prayer.name) : "—"}</span>
        </div>
        <div class="home-next-prayer__when">
          <span class="home-next-prayer__countdown" data-home-countdown>${next ? formatCountdown(next.target) : "—"}</span>
          <span class="home-next-prayer__clock">${next ? escapeHtml(timings[next.prayer.key] || "") : ""}</span>
        </div>
      </div>
    </section>
    <section class="home-prayer-timeline" aria-label="Today's five prayers">${timelineItems}</section>
    ${renderQuickAccess()}
  `;
  wireGotoViewButtons(root);
  fillHijriDate(root);

  if (next) startCountdown(root, next);
}

function startCountdown(root, next) {
  const el = root.querySelector("[data-home-countdown]");
  if (!el) return;
  countdownTimer = window.setInterval(() => {
    const remainingMs = next.target.getTime() - Date.now();
    if (remainingMs <= 0) {
      clearCountdown();
      loadDashboard(root); // roll over to the following prayer
      return;
    }
    el.textContent = formatCountdown(next.target);
  }, 1000);
}

async function loadDashboard(root) {
  if (!hasSavedLocation()) {
    renderNoLocation(root);
    return;
  }
  root.setAttribute("aria-busy", "true");
  try {
    const snapshot = await getPrayerSnapshot();
    if (!snapshot) {
      renderNoLocation(root);
      return;
    }
    renderDashboard(root, snapshot);
  } catch (error) {
    console.error("[TAZAWWUD] Failed to load Home prayer snapshot:", error);
    renderUnavailable(root);
  }
}

/** Called by app.js each time the Home view is shown. */
export function initHomeDashboard(root) {
  if (!root) return;
  loadDashboard(root);
}

/** Called by app.js when navigating away from Home, to stop the tick. */
export function stopHomeDashboard() {
  clearCountdown();
}
