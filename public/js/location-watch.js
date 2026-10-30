// ============================================================================
// TAZAWWUD - Location watch
// ----------------------------------------------------------------------------
// When the app comes back to the foreground: checks location services and
// permission. If they are on, refreshes the saved location (at most once an
// hour, so the battery is not drained) and the prayer times. If they are off, or
// blocked, shows a note on Home with "Maybe later" and "Go to settings".
// Nothing here asks for permission on its own.
// ============================================================================

import { getLocationStatus, openLocationSettings, openAppSettings, inNativeApp } from "./native-bridge.js";
import { requestLocationHeadless } from "./salah.js";

const SAVED_KEY = "tazawwud:salah-location";
const CHECKED_KEY = "tazawwud:location-refreshed-at";
const REFRESH_EVERY_MS = 60 * 60 * 1000;
const DISMISSED_KEY = "tazawwud:location-note-dismissed";

let lastState = null;
let started = false;

/** "ok", "services-off" or "permission-denied". On the web, location is assumed to be available. */
async function currentState() {
  if (!inNativeApp()) return "ok";
  const status = await getLocationStatus();
  if (!status) return "ok";
  if (!status.servicesOn) return "services-off";
  if (!status.permission) return "permission-denied";
  return "ok";
}

function hasSavedCoordinates() {
  try {
    const saved = JSON.parse(globalThis.localStorage?.getItem(SAVED_KEY) || "null");
    return saved?.type === "coordinates";
  } catch {
    return false;
  }
}

function refreshDue() {
  const last = Number(globalThis.localStorage?.getItem(CHECKED_KEY) || 0);
  return Date.now() - last > REFRESH_EVERY_MS;
}

function noteFor(state) {
  const note = document.createElement("section");
  note.className = "home-location-note";
  note.setAttribute("role", "status");
  const text = state === "services-off"
    ? "Location is turned off on your phone. Prayer times use your last saved place until you turn it on."
    : "TAZAWWUD is not allowed to use your location. Prayer times use your last saved place.";
  note.innerHTML = `
    <p class="home-location-note__text">${text}</p>
    <div class="home-location-note__actions">
      <button type="button" class="home-location-note__later" data-location-later>Maybe later</button>
      <button type="button" class="home-location-note__settings" data-location-settings>Go to settings</button>
    </div>`;
  note.querySelector("[data-location-later]").addEventListener("click", () => {
    globalThis.sessionStorage?.setItem(DISMISSED_KEY, "1");
    note.remove();
  });
  note.querySelector("[data-location-settings]").addEventListener("click", () => {
    if (state === "services-off") openLocationSettings();
    else openAppSettings();
  });
  return note;
}

/** Shows or removes the note on Home, to match the current state. */
function placeNote(state) {
  const root = document.getElementById("home-dashboard-root");
  if (!root) return;
  root.querySelector(".home-location-note")?.remove();
  if (state === "ok") return;
  if (globalThis.sessionStorage?.getItem(DISMISSED_KEY) === "1") return;
  root.prepend(noteFor(state));
}

async function checkNow() {
  const state = await currentState();
  const becameOk = lastState && lastState !== "ok" && state === "ok";
  lastState = state;
  placeNote(state);
  if (state === "ok" && hasSavedCoordinates() && (becameOk || refreshDue())) {
    try {
      await requestLocationHeadless();
      globalThis.localStorage?.setItem(CHECKED_KEY, String(Date.now()));
      window.dispatchEvent(new CustomEvent("tazawwud:location-updated"));
    } catch (error) {
      console.warn("[TAZAWWUD] Location refresh did not finish:", error);
    }
  }
}

/** Starts the watch once. Safe to call again. */
export function startLocationWatch() {
  if (started) return;
  started = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkNow();
  });
  // Home redraws itself, which removes the note, so put it back.
  window.addEventListener("tazawwud:home-rendered", () => checkNow());
  checkNow();
}
