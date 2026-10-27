// ============================================================================
// TAZAWWUD — Mosque Finder
// ----------------------------------------------------------------------------
// Opens a map search for mosques near the person, near their saved Salah
// location, or near a place they type. Mosque listings come from the map
// service (Google Maps) and are not stored by TAZAWWUD. This keeps the app
// free of a mosque database and of any map API key.
//
// The saved location is read from the same localStorage key Salah writes, so
// Mosque and Salah always agree on "where I am" without a second location
// system. Nothing here is sent anywhere except the map link the user opens.
// ============================================================================

import { escapeHtml } from "./html-utils.js";
import { locator } from "./native-bridge.js";
import { getPositionWithFallback, describeLocationError } from "./geo.js";

const SALAH_LOCATION_KEY = "tazawwud:salah-location";

const PAGE_STYLE_HREF = "/css/pages-redesign.css";

function ensurePageStyles() {
  if (document.querySelector(`link[href="${PAGE_STYLE_HREF}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = PAGE_STYLE_HREF;
  document.head.append(link);
}


export function nearbyMosquesUrl(latitude, longitude) {
  return `https://www.google.com/maps/search/mosque/@${latitude},${longitude},14z`;
}

export function mosqueSearchUrl(place) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`mosque ${place}`)}`;
}

/** The saved Salah location as { label, url }, or null. A city is searched by
 *  name; coordinates are searched directly by position. */
function savedPlace() {
  try {
    const saved = JSON.parse(localStorage.getItem(SALAH_LOCATION_KEY) || "null");
    if (!saved) return null;
    if (saved.type === "city" && saved.city && saved.country) {
      const label = `${saved.city}, ${saved.country}`;
      return { label, url: mosqueSearchUrl(label) };
    }
    if (saved.type === "coordinates" && Number.isFinite(saved.latitude) && Number.isFinite(saved.longitude)) {
      return {
        label: "your saved location",
        url: nearbyMosquesUrl(saved.latitude.toFixed(5), saved.longitude.toFixed(5)),
      };
    }
  } catch {
    // Unreadable saved value: treat as no saved location.
  }
  return null;
}

function openMap(url) {
  window.open(url, "_blank", "noopener");
}

function showStatus(root, message, isError = false) {
  const el = root.querySelector("[data-mosque-status]");
  if (!el) return;
  el.textContent = message;
  el.classList.toggle("is-error", isError);
}

function nearMe(root) {
  if (!navigator.geolocation && !locator()) {
    showStatus(root, "Your browser can't share your location. Type a place below instead.", true);
    return;
  }
  showStatus(root, "Getting your location…");
  getPositionWithFallback()
    .then(({ coords }) => {
      showStatus(root, "Opened mosques near you in a new tab.");
      openMap(nearbyMosquesUrl(coords.latitude.toFixed(5), coords.longitude.toFixed(5)));
    })
    .catch((error) => {
      const message = error?.code === 1
        ? "Location permission was not given. Type a place below instead."
        : `Unable to get your location. ${describeLocationError(error)} Type a place below instead.`;
      showStatus(root, message, true);
    });
}

export function initMosque(root) {
  if (!root) return;
  ensurePageStyles();
  const saved = savedPlace();
  root.innerHTML = `
    <section class="mq-hero">
      <p class="mq-hero__icon" aria-hidden="true">🕌</p>
      <h2 class="mq-title">Mosque Finder</h2>
      <p class="mq-subtitle">Find a mosque near you</p>
    </section>
    <div class="mq-actions">
      <button type="button" class="mq-action mq-action--primary" data-mosque-near-me>
        <span class="mq-action__label">Mosques near me</span>
        <span class="mq-action__hint">Uses your location</span>
      </button>
      ${saved ? `
      <button type="button" class="mq-action" data-mosque-saved>
        <span class="mq-action__label">Near ${escapeHtml(saved.label)}</span>
        <span class="mq-action__hint">Your saved location</span>
      </button>` : ""}
    </div>
    <form class="mq-search" data-mosque-form>
      <label class="mq-search__label" for="mosque-place">Or search a place</label>
      <div class="mq-search__row">
        <input id="mosque-place" class="mq-search__input" type="text" maxlength="120" placeholder="City, area or address" autocomplete="off" required />
        <button type="submit" class="mq-search__button">Search</button>
      </div>
    </form>
    <p class="mq-status" data-mosque-status role="status"></p>
  `;

  root.querySelector("[data-mosque-near-me]")?.addEventListener("click", () => nearMe(root));
  root.querySelector("[data-mosque-saved]")?.addEventListener("click", () => {
    if (saved) {
      showStatus(root, `Opened mosques near ${saved.label} in a new tab.`);
      openMap(saved.url);
    }
  });
  root.querySelector("[data-mosque-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = root.querySelector("#mosque-place").value.trim();
    if (!value) return;
    showStatus(root, `Opened mosques in ${value} in a new tab.`);
    openMap(mosqueSearchUrl(value));
  });
}
