// ============================================================================
// TAZAWWUD — Home Dashboard
// ----------------------------------------------------------------------------
// This is NOT a second prayer-calculation system: every prayer time and the
// countdown target come from the existing Salah module (public/js/salah.js),
// which is also what the Salah tab itself renders from. Home and Salah share
// one saved location (see salah.js: saveLocation/loadSavedLocation), so
// picking a location in either place keeps both in sync.
//
// Two render targets, in this order on the page (see index.html):
//   #home-dashboard-root  -> greeting + next-prayer/countdown card (this file)
//   #daily-featured-content-root -> Daily Ayah/Hadith slot (daily-content.js,
//                           initialized by app.js; NOT touched here)
//   #home-explore-root    -> Explore grid + Today's Prayers list (this file)
//   #continue-reading-banner-home -> Continue Reading (app.js; NOT touched here)
// If #home-explore-root is missing, everything falls back to one root.
// ============================================================================

import {
  PRAYERS,
  getPrayerSnapshot,
  hasSavedLocation,
  requestLocationHeadless,
} from "./salah.js";
import { formatGregorianDate, getTodayHijriLabel } from "./calendar.js";
import { navigateTo } from "./app.js";

const EXPLORE_ROOT_ID = "home-explore-root";

let countdownTimer = null;

// Prayer times normally load in a second or two. If they do not, the dashboard
// shows a retry state instead of staying on "Loading…" indefinitely.
const DASHBOARD_LOAD_LIMIT_MS = 15000;

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const id = window.setTimeout(() => reject(new Error("Prayer times timed out.")), ms);
    promise.then(
      (value) => { window.clearTimeout(id); resolve(value); },
      (error) => { window.clearTimeout(id); reject(error); }
    );
  });
}
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

function greetingText() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/** Greeting + location + today's date (Gregorian now, Hijri fills in once
 *  resolved). The one header for the whole dashboard. */
function renderGreeting(locationLabel) {
  return `
    <header class="home-greeting">
      <div class="home-greeting__text">
        <p class="home-greeting__hello">${greetingText()}</p>
        <p class="home-greeting__date">
          ${escapeHtml(formatGregorianDate(new Date()))}
          <span class="home-greeting__date-sep">•</span>
          <span data-home-hijri>…</span>
        </p>
      </div>
      <button type="button" class="home-greeting__location" data-goto-view="salah">
        <span class="material-symbols-rounded icon icon--sm" aria-hidden="true">location_on</span>
        <span>${escapeHtml(locationLabel || "Set location")}</span>
      </button>
    </header>
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

/** Explore: compact 6-tile grid. Two tiles (Dua & Dhikr, 99 Names) have no
 *  content yet — shown and clearly labeled, not hidden, but inert. */
function renderExplore() {
  const items = [
    { view: "quran", icon: "menu_book", label: "Qur'an" },
    { view: "dua", icon: "volunteer_activism", label: "Dua & Dhikr" },
    { view: "qiblah", icon: "explore", label: "Qiblah" },
    { view: "names99", icon: "workspace_premium", label: "99 Names" },
    { view: "calendar", icon: "calendar_month", label: "Calendar" },
    { view: "tasbih", icon: "touch_app", label: "Tasbih" },
    { view: "mosque", icon: "mosque", label: "Mosque" },
    { view: "stories", icon: "auto_stories", label: "Stories" },
    { view: "bookmarks", icon: "bookmark", label: "Bookmarks" },
  ];
  return `
    <section class="home-quick-access" aria-labelledby="home-quick-access-heading">
      <h3 id="home-quick-access-heading" class="home-quick-access__heading">Explore</h3>
      <div class="home-quick-access__grid">
        ${items.map((item) => `
          <button
            type="button"
            class="home-quick-access__item${item.soon ? " is-soon" : ""}"
            ${item.soon ? `aria-disabled="true" aria-label="${escapeHtml(item.label)} — coming soon"` : `data-goto-view="${item.view}"`}
          >
            ${item.soon ? `<span class="home-quick-access__badge">Soon</span>` : ""}
            <span class="material-symbols-rounded icon" aria-hidden="true">${item.icon}</span>
            <span>${escapeHtml(item.label)}</span>
          </button>
        `).join("")}
      </div>
    </section>
  `;
}

/** Today's five prayers as a compact list — one row each, next prayer
 *  highlighted with an accent bar. */
function renderSalahList(timings, state) {
  const rows = PRAYERS.map((prayer) => {
    const isCurrent = state.current?.key === prayer.key;
    const isNext = state.next?.key === prayer.key;
    return `
      <li class="home-salah-list__row${isNext ? " is-next" : ""}${isCurrent ? " is-current" : ""}">
        <span class="home-salah-list__name-ar" lang="ar" dir="rtl">${escapeHtml(prayer.arabic)}</span>
        <span class="home-salah-list__name-en">${escapeHtml(prayer.name)}</span>
        <span class="home-salah-list__time">${escapeHtml(timings[prayer.key] || "—")}</span>
      </li>
    `;
  }).join("");

  return `
    <section class="home-salah-list" aria-label="Today's five prayers">
      <div class="home-salah-list__header">
        <h3 class="home-salah-list__heading">Today's Prayers</h3>
        <button type="button" class="home-salah-list__view-all" data-goto-view="salah">View all</button>
      </div>
      <ul class="home-salah-list__rows">${rows}</ul>
    </section>
  `;
}

/** Buttons carry data-goto-view and go through navigateTo(), the one router
 *  entry point, so they don't depend on app.js's nav-link elements. */
function wireGotoViewButtons(container) {
  container.querySelectorAll("[data-goto-view]").forEach((button) => {
    button.addEventListener("click", () => navigateTo(button.dataset.gotoView));
  });
}

/**
 * Writes the two halves of Home. `primaryHtml` goes into the dashboard root
 * (greeting + prayer card). `exploreHtml` goes into the Explore root, which
 * sits below the Daily Ayah slot. Falls back to one root if the Explore
 * root is missing, so Home still renders.
 */
function paint(root, primaryHtml, exploreHtml) {
  const exploreRoot = document.getElementById(EXPLORE_ROOT_ID);
  if (exploreRoot) {
    root.innerHTML = primaryHtml;
    exploreRoot.innerHTML = exploreHtml;
    wireGotoViewButtons(root);
    wireGotoViewButtons(exploreRoot);
  } else {
    root.innerHTML = primaryHtml + exploreHtml;
    wireGotoViewButtons(root);
  }
}

function renderNoLocation(root) {
  root.setAttribute("aria-busy", "false");
  paint(
    root,
    `
      ${renderGreeting(null)}
      <section class="home-next-prayer home-next-prayer--empty">
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
    `,
    renderExplore()
  );
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
  paint(
    root,
    `
      ${renderGreeting(null)}
      <section class="home-next-prayer home-next-prayer--empty">
        <p class="home-next-prayer__hint">Unable to load prayer times right now. Please check your connection.</p>
        <div class="home-next-prayer__actions">
          <button type="button" class="salah-button salah-button--secondary" data-goto-view="salah">
            Open Salah
          </button>
        </div>
      </section>
    `,
    renderExplore()
  );
  fillHijriDate(root);
}

function renderDashboard(root, snapshot) {
  clearCountdown();
  root.setAttribute("aria-busy", "false");
  const { timings, locationLabel, state, next } = snapshot;

  paint(
    root,
    `
      ${renderGreeting(locationLabel)}
      <section class="home-next-prayer" aria-labelledby="home-next-prayer-heading">
        <div class="home-next-prayer__main">
          <div class="home-next-prayer__name">
            <p class="home-next-prayer__eyebrow" id="home-next-prayer-heading">Next Prayer</p>
            <span class="home-next-prayer__name-ar" lang="ar" dir="rtl">${escapeHtml(next?.prayer.arabic || "")}</span>
            <span class="home-next-prayer__name-en">${next ? escapeHtml(next.prayer.name) : "—"}</span>
          </div>
          <div class="home-next-prayer__when">
            <span class="home-next-prayer__countdown" data-home-countdown>${next ? formatCountdown(next.target) : "—"}</span>
            <span class="home-next-prayer__clock">${next ? escapeHtml(timings[next.prayer.key] || "") : ""}</span>
          </div>
        </div>
      </section>
    `,
    renderExplore() + renderSalahList(timings, state)
  );
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
    const snapshot = await withTimeout(getPrayerSnapshot(), DASHBOARD_LOAD_LIMIT_MS);
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
