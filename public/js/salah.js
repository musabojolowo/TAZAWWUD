// ============================================================================
// TAZAWWUD - Salah Times (Phase 7)
// ----------------------------------------------------------------------------
// Uses AlAdhan's free timings endpoints. Location permission is requested only
// after the user chooses the automatic-location action.
// ============================================================================

import { createNotificationManager } from "./notifications.js";
import { locator, scheduleTestAdhan, syncNativeSchedule } from "./native-bridge.js";
import { getPositionWithFallback, describeLocationError } from "./geo.js";
import { loadPrefs, updatePrefs } from "./notification-prefs.js";
import { estimatePrayerTimes, fetchJsonWithFallback, renderFallbackNotice } from "./error-boundary.js";

const ALADHAN_BASE = "https://api.aladhan.com/v1";
const SETTINGS_STORAGE_KEY = "tazawwud:salah-settings";
const LOCATION_STORAGE_KEY = "tazawwud:salah-location";
const CALCULATION_METHODS = [
  { value: 3, label: "Muslim World League (MWL)" },
  { value: 2, label: "ISNA" },
  { value: 5, label: "Egyptian General Authority of Survey" },
  { value: 1, label: "University of Islamic Sciences, Karachi" },
  { value: 4, label: "Umm al-Qura University, Makkah" },
  { value: 7, label: "University of Tehran" },
];
const ASR_SCHOOLS = [
  { value: 0, label: "Standard / Shafi'i" },
  { value: 1, label: "Hanafi" },
];
const DEFAULT_SETTINGS = { method: 3, school: 0 };
export const PRAYERS = [
  { key: "Fajr", name: "Fajr", arabic: "الفجر" },
  { key: "Dhuhr", name: "Dhuhr", arabic: "الظهر" },
  { key: "Asr", name: "Asr", arabic: "العصر" },
  { key: "Maghrib", name: "Maghrib", arabic: "المغرب" },
  { key: "Isha", name: "Isha", arabic: "العشاء" },
];

let initializedRoot = null;
let currentLocation = null;
let notificationManager = null;

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || "null");
    const method = Number(saved?.method);
    const school = Number(saved?.school);
    return {
      method: CALCULATION_METHODS.some((option) => option.value === method)
        ? method
        : DEFAULT_SETTINGS.method,
      school: ASR_SCHOOLS.some((option) => option.value === school)
        ? school
        : DEFAULT_SETTINGS.school,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(settings) {
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  announcePrayerInputsChanged();
}

// Lets the global reminder scheduler recalculate prayer times straight away.
function announcePrayerInputsChanged() {
  syncNativeSchedule();
  window.dispatchEvent(new Event("tazawwud:prayer-inputs-changed"));
}

/**
 * Persists the last-used location (coordinates or city) so the Salah tab and
 * the Home dashboard can both restore it without re-prompting the user every
 * visit. This is the single source of truth for "where" — Home reads it via
 * getPrayerSnapshot()/hasSavedLocation() below rather than tracking its own.
 */
function saveLocation(location) {
  try {
    localStorage.setItem(LOCATION_STORAGE_KEY, JSON.stringify(location));
  } catch {
    // Storage unavailable (private browsing, quota) — non-fatal.
  }
  announcePrayerInputsChanged();
}

function loadSavedLocation() {
  try {
    return JSON.parse(localStorage.getItem(LOCATION_STORAGE_KEY) || "null");
  } catch {
    return null;
  }
}

function renderOptions(options, selectedValue) {
  return options.map((option) => `
    <option value="${option.value}"${option.value === selectedValue ? " selected" : ""}>
      ${option.label}
    </option>
  `).join("");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character]);
}

function renderShell(root) {
  const settings = loadSettings();
  root.innerHTML = `
    <header class="salah-header">
      <h2>Salah Times</h2>
      <p class="salah-header__arabic" lang="ar" dir="rtl">مواقيت الصلاة</p>
      <p class="salah-header__date" data-salah-date>Today's date</p>
    </header>
    <section class="salah-location-panel" aria-labelledby="salah-location-heading">
      <h3 id="salah-location-heading" class="salah-panel-heading">Location</h3>
      <p class="salah-location" data-salah-location>Choose automatic location or enter your city.</p>
      <div class="salah-actions">
        <button type="button" class="salah-button" data-salah-geolocation>Use my location</button>
        <button type="button" class="salah-button salah-button--secondary" data-salah-city-toggle>Choose a city</button>
      </div>
      <form class="salah-city-form" data-salah-city-form hidden>
        <div>
          <label for="salah-city">City</label>
          <input id="salah-city" name="city" type="text" autocomplete="address-level2" placeholder="Ilorin" required />
        </div>
        <div>
          <label for="salah-country">Country</label>
          <input id="salah-country" name="country" type="text" autocomplete="country-name" placeholder="Nigeria" required />
        </div>
        <button type="submit" class="salah-button">Load prayer times</button>
      </form>
      <div class="salah-preferences" aria-labelledby="salah-preferences-heading">
        <h4 id="salah-preferences-heading" class="salah-preferences__heading">Prayer calculation</h4>
        <label for="salah-method">Calculation method</label>
        <select id="salah-method" class="salah-select" data-salah-method>
          ${renderOptions(CALCULATION_METHODS, settings.method)}
        </select>
        <label for="salah-school">Asr juristic school</label>
        <select id="salah-school" class="salah-select" data-salah-school>
          ${renderOptions(ASR_SCHOOLS, settings.school)}
        </select>
        <p class="salah-preferences__hint">Preferences are saved and applied to your prayer times.</p>
        <label class="salah-notification__toggle" for="salah-notifications-enabled">
          <input id="salah-notifications-enabled" type="checkbox" data-salah-notifications />
          <span>Enable prayer notifications</span>
        </label>
        <label for="salah-muadhin">Muadhin</label>
        <div class="salah-muadhin-row">
          <select id="salah-muadhin" class="salah-select" data-salah-muadhin></select>
          <button type="button" class="salah-button salah-button--secondary" data-salah-muadhin-test>Test</button>
        </div>
        <p class="salah-preferences__hint">Named Adhan recordings play from files in this app; Simple Chime works without any audio files.</p>
        <div class="salah-alerts" data-salah-alerts>
          <p class="salah-alerts__heading">Prayer alerts</p>
          <div class="salah-alerts__prayers">
            <label><input type="checkbox" data-prayer-toggle="Fajr" /> Fajr</label>
            <label><input type="checkbox" data-prayer-toggle="Dhuhr" /> Dhuhr</label>
            <label><input type="checkbox" data-prayer-toggle="Asr" /> Asr</label>
            <label><input type="checkbox" data-prayer-toggle="Maghrib" /> Maghrib</label>
            <label><input type="checkbox" data-prayer-toggle="Isha" /> Isha</label>
          </div>
          <label for="salah-alert-offset">Minutes before (−) or after (+) prayer time</label>
          <input id="salah-alert-offset" class="salah-select" type="number" min="-60" max="60" step="1" data-alert-offset />
          <label><input type="checkbox" data-alert-quran-enabled /> Qur'an reminder</label>
          <input class="salah-select" type="time" data-alert-quran-time aria-label="Qur'an reminder time" />
          <label><input type="checkbox" data-alert-adhkar-morning /> Morning Adhkar (after Fajr)</label>
          <label><input type="checkbox" data-alert-adhkar-evening /> Evening Adhkar (after Asr)</label>
          <label for="salah-alert-adhkar-delay">Adhkar: minutes after the prayer</label>
          <input id="salah-alert-adhkar-delay" class="salah-select" type="number" min="0" max="120" step="1" data-alert-adhkar-delay />
          <label><input type="checkbox" data-alert-friday-enabled /> Friday reminder (1 hour before Jumu'ah)</label>
          <label for="salah-alert-jumuah">Jumu'ah time</label>
          <input id="salah-alert-jumuah" class="salah-select" type="time" data-alert-jumuah />
          <p class="salah-preferences__hint" data-alert-jumuah-hint></p>
        </div>
        <button type="button" class="salah-button salah-button--secondary" data-test-background-adhan>Test background Adhan (in 2 minutes)</button>
        <p class="salah-notification__status" data-notification-status role="status">
          Checking notification status…
        </p>
      </div>
    </section>
    <section class="salah-times-panel" aria-labelledby="salah-times-heading">
      <h3 id="salah-times-heading" class="salah-panel-heading">Today's prayers</h3>
      <div class="salah-times" data-salah-times>
        <p class="salah-message">Select a location to load prayer times.</p>
      </div>
    </section>
  `;
  root.querySelector("[data-salah-date]").textContent = new Intl.DateTimeFormat(undefined, {
    dateStyle: "full",
  }).format(new Date());
}

function setMessage(root, message, isError = false) {
  const times = root.querySelector("[data-salah-times]");
  if (!times) return;
  times.innerHTML = `<p class="salah-message${isError ? " salah-message--error" : ""}">${escapeHtml(message)}</p>`;
}

function setBusy(root, message) {
  root.setAttribute("aria-busy", "true");
  setMessage(root, message);
}

function parseTime(time) {
  const match = String(time).match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function getPrayerState(timings) {
  const minutesNow = new Date().getHours() * 60 + new Date().getMinutes();
  const prayerMinutes = PRAYERS.map((prayer) => ({
    ...prayer,
    minutes: parseTime(timings[prayer.key]),
  })).filter((prayer) => prayer.minutes !== null);

  if (!prayerMinutes.length) return { current: null, next: null };

  const nextIndex = prayerMinutes.findIndex((prayer) => prayer.minutes > minutesNow);
  if (nextIndex === -1) {
    return { current: null, next: prayerMinutes[0] };
  }

  const current = nextIndex > 0 ? prayerMinutes[nextIndex - 1] : null;
  return { current, next: prayerMinutes[nextIndex] };
}

function renderPrayerTimes(root, timings, locationLabel) {
  const state = getPrayerState(timings);
  root.setAttribute("aria-busy", "false");
  root.querySelector("[data-salah-location]").innerHTML = `<strong>${escapeHtml(locationLabel)}</strong>`;
  root.querySelector("[data-salah-times]").innerHTML = PRAYERS.map((prayer) => {
    const isCurrent = state.current?.key === prayer.key;
    const isNext = state.next?.key === prayer.key;
    const status = isCurrent ? "Now" : isNext ? "Next" : "";
    return `
      <div class="salah-prayer${isCurrent ? " is-current" : ""}${isNext ? " is-next" : ""}"
        data-prayer-key="${prayer.key}"
        data-prayer-name="${prayer.name}"
        data-prayer-arabic="${prayer.arabic}">
        <div>
          <span class="salah-prayer__name">${prayer.name}</span>
          <span class="salah-prayer__arabic" lang="ar" dir="rtl">${prayer.arabic}</span>
        </div>
        <div>
          <span class="salah-prayer__time">${escapeHtml(timings[prayer.key])}</span>
          ${status ? `<span class="salah-prayer__status">${status}</span>` : ""}
        </div>
      </div>
    `;
  }).join("");
  notificationManager?.setPrayerTimes(timings);
}

async function fetchPrayerData(url) {
  const result = await fetchJsonWithFallback(url, {
    cacheKey: `salah:${url}`,
    validate: (payload) => payload?.code === 200 && Boolean(payload.data?.timings),
  });
  return { ...result.data.data, source: result.source };
}

async function loadPrayerTimes(root, url, locationLabel) {
  setBusy(root, "Loading prayer times...");
  try {
    const data = await fetchPrayerData(url);
    renderPrayerTimes(root, data.timings, locationLabel);
    if (data.source !== "network") {
      renderFallbackNotice(root, data.source === "cache"
        ? "Showing the last saved prayer times until the service reconnects."
        : "Showing saved prayer times from an earlier request.");
    }
  } catch (error) {
    const coordinates = currentLocation?.type === "coordinates"
      ? currentLocation
      : null;
    const estimated = coordinates
      ? estimatePrayerTimes(coordinates.latitude, coordinates.longitude)
      : null;
    if (estimated) {
      renderPrayerTimes(root, estimated, locationLabel);
      renderFallbackNotice(root, "Estimated offline prayer times. Reconnect for AlAdhan times.");
      return;
    }
    root.setAttribute("aria-busy", "false");
    setMessage(root, "Unable to load prayer times. Please check your internet connection and try again.", true);
    console.error("[TAZAWWUD] Failed to load Salah times:", error);
  }
}

function getApiParams() {
  const settings = loadSettings();
  return {
    method: String(settings.method),
    school: String(settings.school),
  };
}

function loadByCoordinates(root, latitude, longitude) {
  currentLocation = { type: "coordinates", latitude, longitude };
  saveLocation(currentLocation);
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    ...getApiParams(),
  });
  return loadPrayerTimes(root, `${ALADHAN_BASE}/timings?${params}`, "Your current location");
}

function loadByCity(root, city, country) {
  currentLocation = { type: "city", city, country };
  saveLocation(currentLocation);
  const params = new URLSearchParams({
    city,
    country,
    ...getApiParams(),
  });
  return loadPrayerTimes(root, `${ALADHAN_BASE}/timingsByCity?${params}`, `${city}, ${country}`);
}

function reloadCurrentLocation(root) {
  if (!currentLocation) return;
  if (currentLocation.type === "coordinates") {
    loadByCoordinates(root, currentLocation.latitude, currentLocation.longitude);
  } else {
    loadByCity(root, currentLocation.city, currentLocation.country);
  }
}

function requestLocation(root) {
  if (!navigator.geolocation && !locator()) {
    setMessage(root, "Location is unavailable in this browser. You can select your city instead.", true);
    return;
  }

  setBusy(root, "Getting your location...");
  getPositionWithFallback()
    .then(({ coords }) => loadByCoordinates(root, coords.latitude, coords.longitude))
    .catch((error) => {
      root.setAttribute("aria-busy", "false");
      const message = error?.code === 1
        ? "Location access was denied. You can select your city instead."
        : `Unable to get your location. ${describeLocationError(error)} You can select your city instead.`;
      setMessage(root, message, true);
      console.warn("[TAZAWWUD] Geolocation unavailable:", error?.message);
    });
}

// ============================================================================
// Headless prayer-data API — used by the Home dashboard (public/js/home.js).
// Deliberately reuses getApiParams()/fetchPrayerData()/getPrayerState()/
// estimatePrayerTimes() above rather than a second calculation system, per
// the project rule that Home and Salah must stay backed by one source.
// ============================================================================

/** True once a location has been saved (in this session or a previous one). */
export function hasSavedLocation() {
  return Boolean(currentLocation || loadSavedLocation());
}

function locationLabelFor(location) {
  if (!location) return null;
  return location.type === "coordinates" ? "Your current location" : `${location.city}, ${location.country}`;
}

async function fetchTimingsForLocation(location) {
  const params = new URLSearchParams({
    ...(location.type === "coordinates"
      ? { latitude: String(location.latitude), longitude: String(location.longitude) }
      : { city: location.city, country: location.country }),
    ...getApiParams(),
  });
  const url = location.type === "coordinates"
    ? `${ALADHAN_BASE}/timings?${params}`
    : `${ALADHAN_BASE}/timingsByCity?${params}`;
  return fetchPrayerData(url);
}

/**
 * Resolves the target Date for the next prayer, handling the day-wrap case
 * (all five prayers already passed today -> next prayer is tomorrow's Fajr).
 */
export function getNextPrayerTarget(timings) {
  const state = getPrayerState(timings);
  const now = new Date();

  if (state.next) {
    const target = new Date(now);
    target.setHours(Math.floor(state.next.minutes / 60), state.next.minutes % 60, 0, 0);
    return { prayer: state.next, target };
  }

  const fajrMinutes = parseTime(timings.Fajr);
  if (fajrMinutes === null) return null;
  const fajr = PRAYERS.find((prayer) => prayer.key === "Fajr");
  const target = new Date(now);
  target.setDate(target.getDate() + 1);
  target.setHours(Math.floor(fajrMinutes / 60), fajrMinutes % 60, 0, 0);
  return { prayer: { ...fajr, minutes: fajrMinutes }, target };
}

/**
 * Headless equivalent of loadPrayerTimes(): fetches today's timings for the
 * saved location (network -> cache -> offline estimate, same fallback chain
 * the Salah tab uses) and returns everything Home needs to render. Returns
 * null if no location has been saved yet.
 */
export async function getPrayerSnapshot() {
  const location = currentLocation || loadSavedLocation();
  if (!location) return null;
  currentLocation = location;

  try {
    const data = await fetchTimingsForLocation(location);
    return {
      timings: data.timings,
      locationLabel: locationLabelFor(location),
      source: data.source,
      state: getPrayerState(data.timings),
      next: getNextPrayerTarget(data.timings),
    };
  } catch (error) {
    const estimated = location.type === "coordinates"
      ? estimatePrayerTimes(location.latitude, location.longitude)
      : null;
    if (estimated) {
      return {
        timings: estimated,
        locationLabel: locationLabelFor(location),
        source: "estimated",
        state: getPrayerState(estimated),
        next: getNextPrayerTarget(estimated),
      };
    }
    throw error;
  }
}

/** Headless "use my location" for the Home dashboard's own CTA button. */
export async function requestLocationHeadless() {
  const position = await getPositionWithFallback();
  currentLocation = {
    type: "coordinates",
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
  };
  saveLocation(currentLocation);
  return getPrayerSnapshot();
}

/** Fills the prayer-alert controls from the saved settings and saves each change. */
function wireAlertPrefs(root) {
  const prefs = loadPrefs();

  root.querySelectorAll("[data-prayer-toggle]").forEach((input) => {
    const key = input.dataset.prayerToggle;
    input.checked = prefs.prayers[key] !== false;
    input.addEventListener("change", () => updatePrefs({ prayers: { [key]: input.checked } }));
  });

  const offset = root.querySelector("[data-alert-offset]");
  offset.value = String(prefs.offsetMinutes);
  offset.addEventListener("change", () => {
    const value = Math.min(60, Math.max(-60, Math.round(Number(offset.value) || 0)));
    offset.value = String(value);
    updatePrefs({ offsetMinutes: value });
  });

  const quranEnabled = root.querySelector("[data-alert-quran-enabled]");
  const quranTime = root.querySelector("[data-alert-quran-time]");
  quranEnabled.checked = prefs.quran.enabled;
  quranTime.value = prefs.quran.time;
  quranEnabled.addEventListener("change", () => updatePrefs({ quran: { enabled: quranEnabled.checked } }));
  quranTime.addEventListener("change", () => {
    if (quranTime.value) updatePrefs({ quran: { time: quranTime.value } });
  });

  const morning = root.querySelector("[data-alert-adhkar-morning]");
  const evening = root.querySelector("[data-alert-adhkar-evening]");
  const delay = root.querySelector("[data-alert-adhkar-delay]");
  morning.checked = prefs.adhkar.morningEnabled;
  evening.checked = prefs.adhkar.eveningEnabled;
  delay.value = String(prefs.adhkar.minutesAfterPrayer);
  morning.addEventListener("change", () => updatePrefs({ adhkar: { morningEnabled: morning.checked } }));
  evening.addEventListener("change", () => updatePrefs({ adhkar: { eveningEnabled: evening.checked } }));
  delay.addEventListener("change", () => {
    const value = Math.min(120, Math.max(0, Math.round(Number(delay.value) || 0)));
    delay.value = String(value);
    updatePrefs({ adhkar: { minutesAfterPrayer: value } });
  });

  const friday = root.querySelector("[data-alert-friday-enabled]");
  const jumuah = root.querySelector("[data-alert-jumuah]");
  const jumuahHint = root.querySelector("[data-alert-jumuah-hint]");
  const showJumuahHint = (time) => {
    jumuahHint.textContent = time
      ? "The Friday reminder is set for one hour before this time."
      : "Set your Jumu'ah time to turn on the Friday reminder.";
  };
  friday.checked = prefs.friday.enabled;
  jumuah.value = prefs.friday.jumuahTime || "";
  showJumuahHint(prefs.friday.jumuahTime);
  friday.addEventListener("change", () => updatePrefs({ friday: { enabled: friday.checked } }));
  jumuah.addEventListener("change", () => {
    const time = jumuah.value || null;
    updatePrefs({ friday: { jumuahTime: time } });
    showJumuahHint(time);
  });
}

export function initSalah(root) {
  if (!root) return;
  if (initializedRoot === root) return;
  initializedRoot = root;
  renderShell(root);
  notificationManager = createNotificationManager(root);

  const notificationToggle = root.querySelector("[data-salah-notifications]");
  // The native permission arrives a moment after the page draws, so refresh when it does.
  const refreshNotificationControls = () => {
    notificationToggle.checked = notificationManager.isEnabled();
    notificationManager.refreshStatus();
  };
  window.addEventListener("tazawwud:notification-permission-changed", refreshNotificationControls);
  refreshNotificationControls();

  root.querySelector("[data-test-background-adhan]").addEventListener("click", async () => {
    const scheduled = await scheduleTestAdhan(120);
    if (scheduled) {
      notificationManager.showStatus("Test Adhan in 2 minutes. You can close the app now.");
    } else {
      notificationManager.showStatus("The background test works in the Android app only.", true);
    }
  });
  notificationToggle.addEventListener("change", async (event) => {
    if (event.currentTarget.checked) {
      const enabled = await notificationManager.enable();
      event.currentTarget.checked = enabled;
    } else {
      notificationManager.disable();
    }
  });

  wireAlertPrefs(root);

  const muadhinSelect = root.querySelector("[data-salah-muadhin]");
  if (muadhinSelect) {
    muadhinSelect.innerHTML = notificationManager
      .getMuadhinOptions()
      .map(
        (option) =>
          `<option value="${option.id}">${option.label}</option>`
      )
      .join("");
    muadhinSelect.value = notificationManager.getSelectedMuadhinId();
    muadhinSelect.addEventListener("change", (event) => {
      notificationManager.setMuadhin(event.target.value);
    });
  }
  root.querySelector("[data-salah-muadhin-test]")?.addEventListener("click", () => {
    notificationManager.testPlayback();
  });

  const savedLocation = loadSavedLocation();
  if (savedLocation) {
    currentLocation = savedLocation;
    if (savedLocation.type === "coordinates") {
      loadByCoordinates(root, savedLocation.latitude, savedLocation.longitude);
    } else if (savedLocation.city && savedLocation.country) {
      loadByCity(root, savedLocation.city, savedLocation.country);
    }
  }

  root.querySelector("[data-salah-geolocation]").addEventListener("click", () => requestLocation(root));
  root.querySelector("[data-salah-city-toggle]").addEventListener("click", () => {
    const form = root.querySelector("[data-salah-city-form]");
    form.hidden = !form.hidden;
    if (!form.hidden) root.querySelector("#salah-city").focus();
  });
  root.querySelector("[data-salah-city-form]").addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const city = String(formData.get("city")).trim();
    const country = String(formData.get("country")).trim();
    if (city && country) loadByCity(root, city, country);
  });

  ["[data-salah-method]", "[data-salah-school]"].forEach((selector) => {
    root.querySelector(selector).addEventListener("change", (event) => {
      const settings = loadSettings();
      const key = selector.includes("method") ? "method" : "school";
      settings[key] = Number(event.currentTarget.value);
      saveSettings(settings);
      reloadCurrentLocation(root);
    });
  });
}
