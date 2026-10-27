// ============================================================================
// TAZAWWUD - Salah Times (Phase 7)
// ----------------------------------------------------------------------------
// Uses AlAdhan's free timings endpoints. Location permission is requested only
// after the user chooses the automatic-location action.
// ============================================================================

import { locator, syncNativeSchedule, inNativeApp, resolvePlaceNative } from "./native-bridge.js";
import { getPositionWithFallback, describeLocationError } from "./geo.js";
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
// High-latitude adjustment, as AlAdhan's latitudeAdjustmentMethod: 1 middle of the night,
// 2 one seventh, 3 angle based (AlAdhan's own default).
const LATITUDE_METHODS = [
  { value: 3, label: "Angle based" },
  { value: 1, label: "Middle of the night" },
  { value: 2, label: "One seventh" },
];
const IMSAK_MAX_MINUTES = 30;
const DEFAULT_SETTINGS = { method: 3, school: 0, latitudeAdjustment: 3, imsakMinutes: 0, imsakCountdown: false };
export const PRAYERS = [
  { key: "Fajr", name: "Fajr", arabic: "الفجر" },
  { key: "Dhuhr", name: "Dhuhr", arabic: "الظهر" },
  { key: "Asr", name: "Asr", arabic: "العصر" },
  { key: "Maghrib", name: "Maghrib", arabic: "المغرب" },
  { key: "Isha", name: "Isha", arabic: "العشاء" },
];

let initializedRoot = null;
let currentLocation = null;

/** Checks every saved setting. Anything missing or wrong falls back to its default. */
export function sanitizeSettings(saved) {
  const method = Number(saved?.method);
  const school = Number(saved?.school);
  const latitude = Number(saved?.latitudeAdjustment);
  const imsak = Number(saved?.imsakMinutes);
  return {
    method: CALCULATION_METHODS.some((option) => option.value === method)
      ? method
      : DEFAULT_SETTINGS.method,
    school: ASR_SCHOOLS.some((option) => option.value === school)
      ? school
      : DEFAULT_SETTINGS.school,
    latitudeAdjustment: LATITUDE_METHODS.some((option) => option.value === latitude)
      ? latitude
      : DEFAULT_SETTINGS.latitudeAdjustment,
    imsakMinutes: Number.isInteger(imsak) && imsak >= 0 && imsak <= IMSAK_MAX_MINUTES
      ? imsak
      : DEFAULT_SETTINGS.imsakMinutes,
    imsakCountdown: saved?.imsakCountdown === true,
  };
}

function loadSettings() {
  try {
    return sanitizeSettings(JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || "null"));
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

const SALAH_STYLE_HREF = "/css/salah-page.css";

function ensureSalahStylesheet() {
  if (document.querySelector(`link[href="${SALAH_STYLE_HREF}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = SALAH_STYLE_HREF;
  document.head.append(link);
}

function renderShell(root) {
  ensureSalahStylesheet();
  const settings = loadSettings();
  root.innerHTML = `
    <header class="sp-header">
      <div>
        <h2 class="sp-title">Salah Times</h2>
        <p class="salah-header__arabic" lang="ar" dir="rtl">مواقيت الصلاة</p>
      </div>
      <p class="salah-header__date" data-salah-date>Today's date</p>
    </header>

    <section class="sp-card sp-location" aria-labelledby="salah-location-heading">
      <div class="sp-location__top">
        <h3 id="salah-location-heading" class="sp-label">Location</h3>
        <div class="sp-location__buttons">
          <button type="button" class="sp-chip" data-salah-geolocation>Use my location</button>
          <button type="button" class="sp-chip sp-chip--ghost" data-salah-city-toggle>Choose a city</button>
        </div>
      </div>
      <p class="salah-location" data-salah-location>Choose automatic location or enter your city.</p>
      <form class="sp-city-form" data-salah-city-form hidden>
        <label for="salah-city">City</label>
        <input id="salah-city" name="city" type="text" autocomplete="address-level2" placeholder="e.g. London" required />
        <label for="salah-country">Country</label>
        <input id="salah-country" name="country" type="text" autocomplete="country-name" placeholder="e.g. United Kingdom" required />
        <button type="submit" class="sp-chip">Load prayer times</button>
      </form>
    </section>

    <details class="sp-card sp-settings" data-salah-settings>
      <summary>Prayer settings</summary>
      <div class="sp-settings__body">
        <label for="salah-method">Calculation method</label>
        <select id="salah-method" class="salah-select" data-salah-method>
          ${renderOptions(CALCULATION_METHODS, settings.method)}
        </select>
        <label for="salah-school">Asr juristic school</label>
        <select id="salah-school" class="salah-select" data-salah-school>
          ${renderOptions(ASR_SCHOOLS, settings.school)}
        </select>
        <label for="salah-latitude">High latitude adjustment</label>
        <select id="salah-latitude" class="salah-select" data-salah-latitude>
          ${renderOptions(LATITUDE_METHODS, settings.latitudeAdjustment)}
        </select>
        <label for="salah-imsak">Imsak (minutes before Fajr)</label>
        <input id="salah-imsak" class="salah-select" type="number" min="0" max="${IMSAK_MAX_MINUTES}" step="1" inputmode="numeric" value="${settings.imsakMinutes}" data-salah-imsak />
        <label class="salah-toggle"><input type="checkbox" data-salah-imsak-countdown ${settings.imsakCountdown ? "checked" : ""} /> Imsak countdown on Home</label>
        <p class="salah-preferences__hint">Preferences are saved and applied to your prayer times.</p>
      </div>
    </details>

    <section class="sp-card sp-times" aria-labelledby="salah-times-heading">
      <h3 id="salah-times-heading" class="sp-label">Today's prayers</h3>
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

/** "HH:MM" for a number of minutes after midnight; wraps within one day. */
export function formatMinutes(minutes) {
  const day = 24 * 60;
  const wrapped = ((minutes % day) + day) % day;
  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
}

/** Imsak = Fajr minus the chosen number of minutes. Null if Fajr is unknown. */
export function imsakTimeFor(timings, minutesBefore) {
  const fajr = parseTime(timings?.Fajr);
  if (fajr === null) return null;
  return formatMinutes(fajr - (Number(minutesBefore) || 0));
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
    // Every prayer today has passed: there is no next prayer today. getNextPrayerTarget()
    // then uses tomorrow's Fajr. (Returning today's Fajr here made the countdown reload
    // the whole Home screen repeatedly.)
    return { current: prayerMinutes[prayerMinutes.length - 1], next: null };
  }

  const current = nextIndex > 0 ? prayerMinutes[nextIndex - 1] : null;
  return { current, next: prayerMinutes[nextIndex] };
}

const PLACE_CACHE_KEY = "tazawwud:salah-place";
const pendingPlaces = new Set();

function placeKey(location) {
  return `${Number(location.latitude).toFixed(2)},${Number(location.longitude).toFixed(2)}`;
}

function readPlaceCache() {
  try {
    return JSON.parse(localStorage.getItem(PLACE_CACHE_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

/** The flag emoji for a two-letter country code. Empty if the code is not valid. */
export function flagFor(countryCode) {
  const code = String(countryCode || "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return "";
  return String.fromCodePoint(0x1f1e6 + code.charCodeAt(0) - 65, 0x1f1e6 + code.charCodeAt(1) - 65);
}

/**
 * The city and flag for saved coordinates, once the phone's geocoder has resolved them.
 * Until then, the plain label. The lookup runs in the app only, and is cached.
 */
function resolvedPlaceLabel(location) {
  const hit = readPlaceCache()[placeKey(location)];
  if (hit?.name) {
    const flag = flagFor(hit.countryCode);
    return flag ? `${flag} ${hit.name}` : hit.name;
  }
  requestPlace(location);
  return "Your current location";
}

function requestPlace(location) {
  const key = placeKey(location);
  if (pendingPlaces.has(key) || !inNativeApp()) return;
  pendingPlaces.add(key);
  resolvePlaceNative(location.latitude, location.longitude)
    .then((place) => {
      if (!place?.name) return;
      const cache = readPlaceCache();
      cache[key] = { name: place.name, countryCode: place.countryCode || "" };
      localStorage.setItem(PLACE_CACHE_KEY, JSON.stringify(cache));
      const label = document.querySelector("[data-salah-location]");
      if (label) label.innerHTML = `<strong>${escapeHtml(resolvedPlaceLabel(location))}</strong>`;
      window.dispatchEvent(new CustomEvent("tazawwud:place-resolved"));
    })
    .catch(() => {})
    .finally(() => pendingPlaces.delete(key));
}

/** The text to show for a location label: the resolved city when the label is the plain coordinates label. */
function displayLabel(label) {
  if (label === "Your current location" && currentLocation?.type === "coordinates") {
    return resolvedPlaceLabel(currentLocation);
  }
  return label;
}

function renderPrayerTimes(root, timings, locationLabel) {
  const state = getPrayerState(timings);
  root.setAttribute("aria-busy", "false");
  root.querySelector("[data-salah-location]").innerHTML = `<strong>${escapeHtml(displayLabel(locationLabel))}</strong>`;
  const imsak = imsakTimeFor(timings, loadSettings().imsakMinutes);
  const imsakRow = imsak === null ? "" : `
      <div class="salah-prayer salah-prayer--imsak" data-prayer-key="Imsak">
        <div>
          <span class="salah-prayer__name">Imsak</span>
          <span class="salah-prayer__arabic" lang="ar" dir="rtl">الإمساك</span>
          <span class="salah-prayer__caption">Before Fajr</span>
        </div>
        <div>
          <span class="salah-prayer__time">${escapeHtml(imsak)}</span>
        </div>
      </div>`;
  root.querySelector("[data-salah-times]").innerHTML = imsakRow + PRAYERS.map((prayer) => {
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
  window.dispatchEvent(new CustomEvent("tazawwud:prayer-times", { detail: { timings } }));
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

/** The query values sent to AlAdhan, built from the saved settings. */
export function buildApiParams(settings) {
  return {
    method: String(settings.method),
    school: String(settings.school),
    latitudeAdjustmentMethod: String(settings.latitudeAdjustment),
  };
}

function getApiParams() {
  return buildApiParams(loadSettings());
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
  return location.type === "coordinates" ? resolvedPlaceLabel(location) : `${location.city}, ${location.country}`;
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

  // Imsak countdown: until today's Imsak has passed, the countdown is to Imsak.
  const settings = loadSettings();
  const imsak = settings.imsakCountdown ? imsakTimeFor(timings, settings.imsakMinutes) : null;
  const imsakMinutes = imsak === null ? null : parseTime(imsak);
  if (imsakMinutes !== null && now.getHours() * 60 + now.getMinutes() < imsakMinutes) {
    const target = new Date(now);
    target.setHours(Math.floor(imsakMinutes / 60), imsakMinutes % 60, 0, 0);
    return { prayer: { key: "Imsak", name: "Imsak", arabic: "الإمساك" }, target, time: imsak };
  }

  if (state.next) {
    const target = new Date(now);
    target.setHours(Math.floor(state.next.minutes / 60), state.next.minutes % 60, 0, 0);
    return { prayer: state.next, target, time: timings[state.next.key] || "" };
  }

  const fajrMinutes = parseTime(timings.Fajr);
  if (fajrMinutes === null) return null;
  const fajr = PRAYERS.find((prayer) => prayer.key === "Fajr");
  const target = new Date(now);
  target.setDate(target.getDate() + 1);
  target.setHours(Math.floor(fajrMinutes / 60), fajrMinutes % 60, 0, 0);
  return { prayer: { ...fajr, minutes: fajrMinutes }, target, time: timings.Fajr };
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

export function initSalah(root) {
  if (!root) return;
  if (initializedRoot === root) return;
  initializedRoot = root;
  renderShell(root);

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

  root.querySelector("[data-salah-latitude]").addEventListener("change", (event) => {
    const settings = loadSettings();
    settings.latitudeAdjustment = Number(event.currentTarget.value);
    saveSettings(settings);
    reloadCurrentLocation(root);
  });
  root.querySelector("[data-salah-imsak]").addEventListener("change", (event) => {
    const text = event.currentTarget.value.trim();
    const value = text === "" ? NaN : Number(text); // an empty box is not 0
    const settings = loadSettings();
    if (Number.isInteger(value) && value >= 0 && value <= IMSAK_MAX_MINUTES) {
      settings.imsakMinutes = value;
      saveSettings(settings);
      reloadCurrentLocation(root);
    } else {
      event.currentTarget.value = String(settings.imsakMinutes);
    }
  });
  root.querySelector("[data-salah-imsak-countdown]").addEventListener("change", (event) => {
    const settings = loadSettings();
    settings.imsakCountdown = event.currentTarget.checked;
    saveSettings(settings);
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
