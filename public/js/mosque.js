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
import { getPositionWithFallback, describeLocationError } from "./geo.js";

const SALAH_LOCATION_KEY = "tazawwud:salah-location";

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
  if (!navigator.geolocation) {
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
  const saved = savedPlace();
  root.innerHTML = `
    <header class="view-header">
      <h2 class="view-header__title">Mosque Finder</h2>
      <p class="view-header__subtitle">Find a mosque near you</p>
    </header>
    <div class="mosque-actions">
      <button type="button" class="salah-button" data-mosque-near-me>Mosques near me</button>
      ${saved ? `<button type="button" class="salah-button salah-button--secondary" data-mosque-saved>Near ${escapeHtml(saved.label)}</button>` : ""}
    </div>
    <form class="mosque-search" data-mosque-form>
      <label for="mosque-place">Or search a place</label>
      <div class="mosque-search__row">
        <input id="mosque-place" type="text" maxlength="120" placeholder="City, area or address" autocomplete="off" required />
        <button type="submit" class="salah-button">Search</button>
      </div>
    </form>
    <p class="mosque-status" data-mosque-status role="status"></p>
    <p class="settings-note">
      Results open in Google Maps in a new tab. Mosque details, opening times and
      reviews are provided by Google Maps, not by TAZAWWUD.
    </p>
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
