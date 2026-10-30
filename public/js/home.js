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
import { startLocationWatch } from "./location-watch.js";

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
  // H:MM:SS, or M:SS within the hour, like the phone's own countdown.
  const total = Math.floor(diffMs / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

function clearCountdown() {
  if (countdownTimer) {
    window.clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

function greetingText() {
  // The Arabic greeting, shown at all times of day.
  return "السلام عليكم";
}

/** Greeting + location + today's date (Gregorian now, Hijri fills in once
 *  resolved). The one header for the whole dashboard. */
function renderGreeting(locationLabel) {
  return `
    <header class="home-greeting">
      <div class="home-greeting__text">
        <p class="home-greeting__hello" lang="ar" dir="rtl">${greetingText()}</p>
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

function minutesOf(hhmm) {
  const match = String(hhmm || "").match(/^(\d{1,2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/**
 * A prayer can be ticked once its time has passed. Past days: every prayer.
 * Future days: none. Today: only the prayers whose time has already come.
 */
function canTick(prayerKey, timings, day) {
  const now = new Date();
  const todayKey = dayKey(now);
  const key = dayKey(day);
  if (key < todayKey) return true;
  if (key > todayKey) return false;
  const at = minutesOf(timings[prayerKey]);
  if (at === null) return false;
  return now.getHours() * 60 + now.getMinutes() >= at;
}

/** "Mark all as prayed" ticks only the prayers that can be ticked. */
function markAllTickable(storage, day, timings) {
  for (const name of TRACKED_PRAYERS) {
    if (canTick(name, timings, day)) setPrayed(storage, day, name, true);
  }
  return getDayStatus(storage, day);
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

// Each prayer plays the Adhan or shows a bell. Sunrise and the evening adhkar show a bell or are off.
const PRAYER_MODES_KEY = "tazawwud:prayer-modes";
const DEFAULT_MODES = { Fajr: "adhan", Dhuhr: "adhan", Asr: "adhan", Maghrib: "adhan", Isha: "adhan", Sunrise: "bell", EveningAdhkar: "bell" };
const MODE_CHOICES = {
  Fajr: ["adhan", "bell"], Dhuhr: ["adhan", "bell"], Asr: ["adhan", "bell"], Maghrib: ["adhan", "bell"], Isha: ["adhan", "bell"],
  Sunrise: ["bell", "off"], EveningAdhkar: ["bell", "off"],
};
const EVENT_LABELS = { Sunrise: "Sunrise", EveningAdhkar: "Evening adhkar" };

/** "15:46" plus minutes, as "16:46". */
function addMinutes(hhmm, minutes) {
  const [h, m] = String(hhmm || "").split(":").map(Number);
  if (!Number.isInteger(h) || !Number.isInteger(m)) return "—";
  const total = (h * 60 + m + minutes + 24 * 60) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

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

const ICON_SPEAKER = '<svg class="tz-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
const ICON_BELL = '<svg class="tz-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10.3 20a2 2 0 0 0 3.4 0"/></svg>';
const ICON_BELL_OFF = '<svg class="tz-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10.3 20a2 2 0 0 0 3.4 0"/><path d="M3 3l18 18"/></svg>';

/** An inline icon for each alert mode. Plain icons, not emoji, so they look the same on every phone. */
function modeIcon(mode) {
  return { adhan: ICON_SPEAKER, bell: ICON_BELL, off: ICON_BELL_OFF }[mode] || ICON_BELL;
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

/** Sunrise (after Fajr) or the evening adhkar reminder (one hour after Asr): a bell, or off. */
function renderSunRow(name, timings) {
  const mode = readModes()[name];
  const label = EVENT_LABELS[name];
  const time = name === "Sunrise" ? timings.Sunrise : addMinutes(timings.Asr, 60);
  return `
      <li class="home-salah-list__row home-salah-list__row--sun">
        <span class="home-track-spacer" aria-hidden="true"></span>
        <span class="home-salah-list__name-en">${label}</span>
        <span class="home-salah-list__time">${escapeHtml(time || "—")}</span>
        <button type="button" class="home-bell${mode !== "off" ? " is-on" : ""}" data-sun-mode="${name}" aria-label="${escapeHtml(modeLabel(label, mode))}">${modeIcon(mode)}</button>
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
    const locked = tracked && !canTick(prayer.key, timings, trackedDay());
    const shown = prayerDisplay(prayer);
    const mode = readModes()[prayer.name];
    const alert = tracked
      ? `<button type="button" class="home-bell is-on" data-alert-prayer="${escapeHtml(prayer.name)}" aria-label="${escapeHtml(modeLabel(shown.name, mode))}">${modeIcon(mode)}</button>`
      : "";
    const tick = tracked
      ? `<button type="button" class="home-track${prayed ? " is-prayed" : ""}${locked ? " is-locked" : ""}" data-track-prayer="${escapeHtml(prayer.name)}" aria-pressed="${prayed}"${locked ? " disabled" : ""} aria-label="Mark ${escapeHtml(shown.name)} as prayed">${prayed ? "✓" : ""}</button>`
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
    // Sunrise sits after Fajr. It has no tick. The evening reminder is on the Notifications page.
    if (prayer.key === "Fajr") return row + renderSunRow("Sunrise", timings);
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
      button.innerHTML = modeIcon(mode);
      button.setAttribute("aria-label", modeLabel(shown.name, mode));
      syncNativeSchedule();
    });
  });
  // Sunrise and the evening adhkar reminder: bell or off.
  root.querySelectorAll("[data-sun-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      const name = button.dataset.sunMode;
      const mode = nextMode(name, readModes()[name]);
      writeMode(name, mode);
      button.innerHTML = modeIcon(mode);
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
      const prayer = PRAYERS.find((p) => p.name === name);
      if (!prayer || !canTick(prayer.key, lastPrayerArgs?.timings || {}, day)) return;
      const isOn = getDayStatus(storage, day)[name] === true;
      refreshTracker(root, setPrayed(storage, day, name, !isOn));
    });
  });
  root.querySelector("[data-track-all]")?.addEventListener("click", () => {
    refreshTracker(root, markAllTickable(storage, trackedDay(), lastPrayerArgs?.timings || {}));
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
  // Once a second. Only this number is replaced; the rest of the card is not redrawn.
  countdownTimer = window.setInterval(() => {
    const remainingMs = next.target.getTime() - Date.now();
    if (remainingMs <= 0) {
      clearCountdown();
      loadDashboard(root); // roll over to the following prayer
      return;
    }
    const text = formatCountdown(next.target);
    if (el.textContent !== text) el.textContent = text;
  }, 1000);
}

// The last prayer snapshot, kept on the device so Home can show it the moment the app opens.
const SNAPSHOT_KEY = "tazawwud:home-snapshot";

// Shown before any prayer times are known: the layout with dashes, and no loading text.
const EMPTY_SNAPSHOT = {
  timings: { Fajr: "--:--", Sunrise: "--:--", Dhuhr: "--:--", Asr: "--:--", Maghrib: "--:--", Isha: "--:--" },
  locationLabel: "",
  state: { current: null, next: null },
  next: null,
};

let lastSnapshot = null;

function readSavedSnapshot() {
  try {
    const saved = JSON.parse(globalThis.localStorage?.getItem(SNAPSHOT_KEY) || "null");
    if (!saved?.next?.target) return null;
    const target = new Date(saved.next.target);
    if (target.getTime() <= Date.now()) return null; // that prayer has passed: wait for fresh times
    return { ...saved, next: { ...saved.next, target } };
  } catch {
    return null;
  }
}

function saveSnapshot(snapshot) {
  try {
    const plain = {
      ...snapshot,
      next: snapshot.next ? { ...snapshot.next, target: snapshot.next.target.toISOString() } : null,
    };
    globalThis.localStorage?.setItem(SNAPSHOT_KEY, JSON.stringify(plain));
  } catch {
    // storage full or blocked: Home still works, it just loads from the network
  }
}

async function loadDashboard(root) {
  if (!hasSavedLocation()) {
    renderNoLocation(root);
    return;
  }
  // Show what we know at once: this session's times, else the saved times, else the empty layout.
  const shown = lastSnapshot || readSavedSnapshot() || EMPTY_SNAPSHOT;
  renderDashboard(root, shown);
  window.dispatchEvent(new CustomEvent("tazawwud:home-rendered", { detail: root }));
  try {
    const snapshot = await withTimeout(getPrayerSnapshot(), DASHBOARD_LOAD_LIMIT_MS);
    if (!snapshot) {
      renderNoLocation(root);
      return;
    }
    lastSnapshot = snapshot;
    saveSnapshot(snapshot);
    import("./reminders-sync.js").then((m) => m.syncReminders()).catch(() => {});
    renderDashboard(root, snapshot);
    window.dispatchEvent(new CustomEvent("tazawwud:home-rendered", { detail: root }));
  } catch (error) {
    console.error("[TAZAWWUD] Failed to load Home prayer snapshot:", error);
    if (shown === EMPTY_SNAPSHOT) renderUnavailable(root);
  }
}

/** Called by app.js each time the Home view is shown. */
export function initHomeDashboard(root) {
  if (!root) return;
  startLocationWatch();
  loadDashboard(root);
}

/** Called by app.js when navigating away from Home, to stop the tick. */
export function stopHomeDashboard() {
  clearCountdown();
}
