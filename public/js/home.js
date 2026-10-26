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
import { TRACKED_PRAYERS, getDayStatus, setPrayed, markAllPrayed, countPrayed, dayKey, currentStreak } from "./tracker.js";
import { navigateTo } from "./app.js";
import { syncNativeSchedule } from "./native-bridge.js";

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
  // Written as units, so it is clear: "6h 01m" or "45 min". Minutes only, so the screen
  // changes once a minute, not once a second.
  const totalMinutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${pad(minutes)}m` : `${minutes} min`;
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
// The day the tick list shows: today, or a past day picked in the day strip.
const STRIP_DAYS_BACK = 6;
const STRIP_DAYS_FORWARD = 0;
let selectedTrackerDay = null;
let lastPrayerArgs = null;

function trackedDay() {
  return selectedTrackerDay || new Date();
}

function trackerStatus() {
  return getDayStatus(globalThis.localStorage, trackedDay());
}

function streakLabel() {
  const streak = currentStreak(globalThis.localStorage, new Date());
  return streak === 0 ? "No streak yet" : `${streak}-day streak`;
}

/** The last seven days, ending today. Tap one to review or tick its prayers. */
function renderDayStrip() {
  const today = new Date();
  const selectedKey = dayKey(trackedDay());
  const todayKey = dayKey(today);
  const buttons = [];
  // A year back and a year ahead. Future days can be viewed, not ticked.
  for (let i = STRIP_DAYS_BACK; i >= -STRIP_DAYS_FORWARD; i -= 1) {
    const day = new Date(today);
    day.setDate(day.getDate() - i);
    const key = dayKey(day);
    const future = key > todayKey;
    const count = future ? 0 : countPrayed(getDayStatus(globalThis.localStorage, day));
    const label = day.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
    buttons.push(`
      <button type="button" class="home-day${key === selectedKey ? " is-selected" : ""}${key === todayKey ? " is-today" : ""}${future ? " is-future" : ""}" data-track-day="${key}" aria-pressed="${key === selectedKey}" aria-label="${escapeHtml(label)}, ${count} of 5 prayed"${future ? " disabled" : ""}>
        <span class="home-day__week">${escapeHtml(day.toLocaleDateString("en-GB", { weekday: "narrow" }))}</span>
        <strong class="home-day__num">${day.getDate()}</strong>
        <small class="home-day__count" data-track-day-count="${key}">${count}/5</small>
      </button>`);
  }
  return `<div class="home-day-strip" role="group" aria-label="Choose a day to review">${buttons.join("")}</div>`;
}

// Each prayer plays the Adhan or shows a bell. Sunrise and Sunset show a bell or are off.
const PRAYER_MODES_KEY = "tazawwud:prayer-modes";
const DEFAULT_MODES = { Fajr: "adhan", Dhuhr: "adhan", Asr: "adhan", Maghrib: "adhan", Isha: "adhan", Sunrise: "bell", Sunset: "bell" };
const MODE_CHOICES = {
  Fajr: ["adhan", "bell"], Dhuhr: ["adhan", "bell"], Asr: ["adhan", "bell"], Maghrib: ["adhan", "bell"], Isha: ["adhan", "bell"],
  Sunrise: ["bell", "off"], Sunset: ["bell", "off"],
};

function readModes() {
  let saved = null;
  try { saved = JSON.parse(globalThis.localStorage?.getItem(PRAYER_MODES_KEY) || "null"); } catch { saved = null; }
  const modes = { ...DEFAULT_MODES };
  for (const name of Object.keys(DEFAULT_MODES)) {
    if (saved && MODE_CHOICES[name].includes(saved[name])) modes[name] = saved[name];
  }
  return modes;
}

function writeMode(name, value) {
  const modes = readModes();
  modes[name] = value;
  globalThis.localStorage?.setItem(PRAYER_MODES_KEY, JSON.stringify(modes));
}

/** The next choice in a pair, for example adhan to bell. */
function nextMode(name, current) {
  const choices = MODE_CHOICES[name];
  return choices[(choices.indexOf(current) + 1) % choices.length];
}

function modeIcon(mode) {
  return { adhan: "🔊", bell: "🔔", off: "🔕" }[mode] || "🔔";
}

function modeLabel(name, mode) {
  return mode === "adhan" ? `${name}: Adhan` : mode === "bell" ? `${name}: bell` : `${name}: off`;
}

/** The label for a prayer on the day being viewed: Dhuhr is Jumu'ah on a Friday. */
function prayerDisplay(prayer) {
  if (prayer.name === "Dhuhr" && trackedDay().getDay() === 5) {
    return { name: "Jumu'ah", arabic: "الجمعة" };
  }
  return { name: prayer.name, arabic: prayer.arabic };
}

/** Sunrise or Sunset: a bell, or off. Sunset is shown before Maghrib. */
function renderSunRow(name, timings) {
  const mode = readModes()[name];
  const time = name === "Sunrise" ? timings.Sunrise : timings.Sunset;
  return `
      <li class="home-salah-list__row home-salah-list__row--sun">
        <span class="home-track-spacer" aria-hidden="true"></span>
        <span class="home-salah-list__name-en">${name}</span>
        <span class="home-salah-list__time">${escapeHtml(time || "—")}</span>
        <button type="button" class="home-bell${mode !== "off" ? " is-on" : ""}" data-sun-mode="${name}" aria-label="${escapeHtml(modeLabel(name, mode))}">${modeIcon(mode)}</button>
      </li>
    `;
}

function renderSalahList(timings, state) {
  lastPrayerArgs = { timings, state };
  const status = trackerStatus();
  const rows = PRAYERS.map((prayer) => {
    const isCurrent = state.current?.key === prayer.key;
    const isNext = state.next?.key === prayer.key;
    const tracked = TRACKED_PRAYERS.includes(prayer.name);
    const prayed = tracked && status[prayer.name] === true;
    const shown = prayerDisplay(prayer);
    const mode = readModes()[prayer.name];
    const alert = tracked
      ? `<button type="button" class="home-bell is-on" data-alert-prayer="${escapeHtml(prayer.name)}" aria-label="${escapeHtml(modeLabel(shown.name, mode))}">${modeIcon(mode)}</button>`
      : "";
    const tick = tracked
      ? `<button type="button" class="home-track${prayed ? " is-prayed" : ""}" data-track-prayer="${escapeHtml(prayer.name)}" aria-pressed="${prayed}" aria-label="Mark ${escapeHtml(shown.name)} as prayed">${prayed ? "✓" : ""}</button>`
      : `<span class="home-track-spacer" aria-hidden="true"></span>`;
    const row = `
      <li class="home-salah-list__row${isNext ? " is-next" : ""}${isCurrent ? " is-current" : ""}">
        ${tick}
        <span class="home-salah-list__name-ar" lang="ar" dir="rtl">${escapeHtml(shown.arabic)}</span>
        <span class="home-salah-list__name-en">${escapeHtml(shown.name)}</span>
        <span class="home-salah-list__time">${escapeHtml(timings[prayer.key] || "—")}</span>
        ${alert}
      </li>
    `;
    // Sunrise sits after Fajr, and Sunset before Maghrib. Neither has a tick.
    if (prayer.key === "Fajr") return row + renderSunRow("Sunrise", timings);
    if (prayer.key === "Maghrib") return renderSunRow("Sunset", timings) + row;
    return row;
  }).join("");

  return `
    <section class="home-salah-list" aria-label="Five prayers">
      <div class="home-salah-list__header">
        <h3 class="home-salah-list__heading">${dayKey(trackedDay()) === dayKey(new Date()) ? "Today's Prayers" : "Prayers for the chosen day"}</h3>
        <button type="button" class="home-salah-list__view-all" data-goto-view="salah">View all</button>
      </div>
      ${renderDayStrip()}
      <ul class="home-salah-list__rows">${rows}</ul>
      <div class="home-track-all">
        <button type="button" class="home-track-all__button" data-track-all ${countPrayed(status) === 5 ? "disabled" : ""}>Mark all as prayed</button>
        <p class="home-track-all__count" data-track-count aria-live="polite">${countPrayed(status)}/5 tracked</p>
        <p class="home-track-streak" data-track-streak>${escapeHtml(streakLabel())}</p>
      </div>
    </section>
  `;
}

/** Tick circles and "Mark all as prayed" on Home. Only the five prayers are tracked. */
function wireTracker(root) {
  const storage = globalThis.localStorage;
  // Keep the chosen day in view in the strip.
  const strip = root.querySelector(".home-day-strip");
  const selected = strip?.querySelector(".is-selected");
  if (strip && selected) {
    strip.scrollLeft = selected.offsetLeft - strip.clientWidth / 2 + selected.clientWidth / 2;
  }
  // Adhan or bell for each of the five prayers.
  root.querySelectorAll("[data-alert-prayer]").forEach((button) => {
    button.addEventListener("click", () => {
      const name = button.dataset.alertPrayer;
      const mode = nextMode(name, readModes()[name]);
      writeMode(name, mode);
      const shown = prayerDisplay(PRAYERS.find((p) => p.name === name));
      button.textContent = modeIcon(mode);
      button.setAttribute("aria-label", modeLabel(shown.name, mode));
      syncNativeSchedule();
    });
  });
  // Sunrise and Sunset: bell or off.
  root.querySelectorAll("[data-sun-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      const name = button.dataset.sunMode;
      const mode = nextMode(name, readModes()[name]);
      writeMode(name, mode);
      button.textContent = modeIcon(mode);
      button.classList.toggle("is-on", mode !== "off");
      button.setAttribute("aria-label", modeLabel(name, mode));
      syncNativeSchedule();
    });
  });
  root.querySelectorAll("[data-track-day]").forEach((button) => {
    button.addEventListener("click", () => {
      const [year, month, day] = button.dataset.trackDay.split("-").map(Number);
      selectedTrackerDay = new Date(year, month - 1, day);
      const section = root.querySelector(".home-salah-list");
      if (section && lastPrayerArgs) {
        section.outerHTML = renderSalahList(lastPrayerArgs.timings, lastPrayerArgs.state);
        wireTracker(root);
      }
    });
  });
  root.querySelectorAll("[data-track-prayer]").forEach((button) => {
    button.addEventListener("click", () => {
      const name = button.dataset.trackPrayer;
      const day = trackedDay();
      const isOn = getDayStatus(storage, day)[name] === true;
      refreshTracker(root, setPrayed(storage, day, name, !isOn));
    });
  });
  root.querySelector("[data-track-all]")?.addEventListener("click", () => {
    refreshTracker(root, markAllPrayed(storage, trackedDay()));
  });
}

/** Updates the tick circles and the count in place, without redrawing the page. */
function refreshTracker(root, status) {
  root.querySelectorAll("[data-track-prayer]").forEach((button) => {
    const on = status[button.dataset.trackPrayer] === true;
    button.classList.toggle("is-prayed", on);
    button.setAttribute("aria-pressed", String(on));
    button.textContent = on ? "✓" : "";
  });
  const count = countPrayed(status);
  const label = root.querySelector("[data-track-count]");
  if (label) label.textContent = `${count}/5 tracked`;
  root.querySelector("[data-track-all]")?.toggleAttribute("disabled", count === 5);
  const dayCount = root.querySelector(`[data-track-day-count="${dayKey(trackedDay())}"]`);
  if (dayCount) dayCount.textContent = `${count}/5`;
  const streak = root.querySelector("[data-track-streak]");
  if (streak) streak.textContent = streakLabel();
  syncNativeSchedule(); // the phone's notification card shows today's count and streak
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
            <span class="home-next-prayer__clock">${next ? escapeHtml(next.time || timings[next.prayer.key] || "") : ""}</span>
          </div>
        </div>
      </section>
    `,
    renderExplore() + renderSalahList(timings, state)
  );
  fillHijriDate(root);
  // The prayer list is drawn into the Explore container, so the tick handlers must be wired there.
  wireTracker(document.getElementById(EXPLORE_ROOT_ID) || root);

  if (next) startCountdown(root, next);
}

function startCountdown(root, next) {
  const el = root.querySelector("[data-home-countdown]");
  if (!el) return;
  // Checked every 15 seconds, but the text is only replaced when the minute changes.
  countdownTimer = window.setInterval(() => {
    const remainingMs = next.target.getTime() - Date.now();
    if (remainingMs <= 0) {
      clearCountdown();
      loadDashboard(root); // roll over to the following prayer
      return;
    }
    const text = formatCountdown(next.target);
    if (el.textContent !== text) el.textContent = text;
  }, 15000);
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
