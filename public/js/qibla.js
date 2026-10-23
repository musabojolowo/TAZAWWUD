// ============================================================================
// TAZAWWUD - Qiblah Compass (Phase 9)
// ----------------------------------------------------------------------------
// Calculates the great-circle bearing from the user's location to the Kaaba.
// Device orientation is used when available; otherwise the exact bearing is
// shown as a degree-only fallback.
// ============================================================================

import { getPositionWithFallback, describeLocationError } from "./geo.js";
import { locator } from "./native-bridge.js";
import { magneticDeclination } from "./magnetic.js";

const KAABA = { latitude: 21.422487, longitude: 39.826206 };
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

let initializedRoot = null;
// Module-level (not inside initQibla's closure) so stopQibla() can remove
// exactly the listener that's currently attached, regardless of which
// initQibla() call started it — initQibla only ever runs its setup once
// per root (see the guard below), so this must be reachable independently.
let orientationListening = false;
let activeOrientationHandler = null;
let fallbackTimerId = null;

function normalizeDegrees(degrees) {
  return (degrees + 360) % 360;
}

/**
 * Smooths compass headings with a low-pass filter on unit vectors. Averaging
 * angles directly would break at the 0/360 boundary, so each reading is blended
 * as an (x, y) direction and the angle is taken from the result.
 */
export function createHeadingSmoother(alpha = 0.2) {
  let x = null;
  let y = null;
  return {
    push(headingDegrees) {
      const radians = headingDegrees * DEG_TO_RAD;
      if (x === null) {
        x = Math.cos(radians);
        y = Math.sin(radians);
      } else {
        x = (1 - alpha) * x + alpha * Math.cos(radians);
        y = (1 - alpha) * y + alpha * Math.sin(radians);
      }
      return normalizeDegrees(Math.atan2(y, x) * RAD_TO_DEG);
    },
    reset() {
      x = null;
      y = null;
    },
  };
}

/** Compass accuracy in degrees from iOS (smaller is better); null where the browser doesn't report it. */
function getCompassAccuracy(event) {
  return typeof event.webkitCompassAccuracy === "number" ? event.webkitCompassAccuracy : null;
}

/** The sentence shown under the compass, based on its reported accuracy. */
export function compassCalibrationNote(accuracy) {
  if (typeof accuracy !== "number" || accuracy < 0) {
    return "Compass is live. If the needle seems off, move your phone in a figure eight to calibrate.";
  }
  if (accuracy > 20) {
    return "Compass accuracy is low. Move your phone in a figure eight to calibrate.";
  }
  return "Compass is accurate.";
}

const headingSmoother = createHeadingSmoother();

function calculateQiblaBearing(latitude, longitude) {
  const latitudeRad = latitude * DEG_TO_RAD;
  const kaabaLatitudeRad = KAABA.latitude * DEG_TO_RAD;
  const deltaLongitude = (KAABA.longitude - longitude) * DEG_TO_RAD;
  const y = Math.sin(deltaLongitude) * Math.cos(kaabaLatitudeRad);
  const x = Math.cos(latitudeRad) * Math.sin(kaabaLatitudeRad)
    - Math.sin(latitudeRad) * Math.cos(kaabaLatitudeRad) * Math.cos(deltaLongitude);
  return normalizeDegrees(Math.atan2(y, x) * RAD_TO_DEG);
}

function bearingLabel(bearing) {
  const directions = ["North", "East", "South", "West"];
  const index = Math.round(bearing / 90) % 4;
  const degrees = Math.round(bearing);
  return `${degrees}° ${directions[index]} of North`;
}

function renderShell(root) {
  root.innerHTML = `
    <header class="qiblah-header">
      <span class="material-symbols-rounded icon icon--lg" aria-hidden="true">explore</span>
      <h2>Qiblah Direction</h2>
      <p class="qiblah-header__arabic" lang="ar" dir="rtl">القبلة</p>
      <p class="qiblah-header__note">Find the direction of the Kaaba from your location.</p>
    </header>
    <section class="qiblah-panel" aria-labelledby="qiblah-location-heading">
      <h3 id="qiblah-location-heading" class="qiblah-panel__heading">Your direction</h3>
      <p class="qiblah-status" data-qiblah-status role="status">Location is needed to calculate the Qiblah.</p>
      <button type="button" class="qiblah-button" data-qiblah-location>
        <span class="material-symbols-rounded icon icon--sm" aria-hidden="true">my_location</span>
        Use my location
      </button>
      <button type="button" class="qiblah-button qiblah-button--secondary" data-qiblah-orientation hidden>
        Enable compass
      </button>
    </section>
    <section class="qiblah-compass-panel" data-qiblah-compass-panel hidden aria-label="Qiblah compass">
      <div class="qiblah-compass" data-qiblah-compass>
        <span class="qiblah-compass__direction qiblah-compass__direction--north">N</span>
        <span class="qiblah-compass__direction qiblah-compass__direction--east">E</span>
        <span class="qiblah-compass__direction qiblah-compass__direction--south">S</span>
        <span class="qiblah-compass__direction qiblah-compass__direction--west">W</span>
        <div class="qiblah-compass__needle" data-qiblah-needle aria-hidden="true">
          <span class="material-symbols-rounded">navigation</span>
        </div>
        <div class="qiblah-compass__center" aria-hidden="true"></div>
      </div>
      <p class="qiblah-bearing" data-qiblah-bearing>--°</p>
      <p class="qiblah-bearing__label" data-qiblah-bearing-label>Qiblah bearing</p>
      <p class="qiblah-sensor-note" data-qiblah-sensor-note>Exact bearing from your location.</p>
    </section>
  `;
}

function renderStatus(root, message, isError = false) {
  const status = root.querySelector("[data-qiblah-status]");
  status.textContent = message;
  status.classList.toggle("qiblah-status--error", isError);
}

function setBearing(root, bearing) {
  root.querySelector("[data-qiblah-compass-panel]").hidden = false;
  root.querySelector("[data-qiblah-bearing]").textContent = `${Math.round(bearing)}°`;
  root.querySelector("[data-qiblah-bearing-label]").textContent = bearingLabel(bearing);
  root.querySelector("[data-qiblah-needle]").style.transform = `rotate(${bearing}deg)`;
}

function getHeading(event) {
  // iOS Safari's webkitCompassHeading is magnetic-north-referenced by
  // definition whenever it's present with a valid accuracy — safe as-is.
  if (typeof event.webkitCompassHeading === "number" && event.webkitCompassAccuracy !== -1) {
    return normalizeDegrees(event.webkitCompassHeading);
  }
  // event.alpha is only north-referenced when the event itself reports
  // absolute orientation (event.absolute === true, or it came from
  // "deviceorientationabsolute"). A plain, non-absolute deviceorientation
  // event's alpha is relative to whatever orientation the device happened
  // to be in when listening started — using it as a compass heading would
  // silently point in an arbitrary, wrong direction with no indication to
  // the user that it's not actually calibrated to true north.
  if (event.absolute === true && typeof event.alpha === "number") {
    return normalizeDegrees(360 - event.alpha);
  }
  return null;
}

function supportsOrientation() {
  return "DeviceOrientationEvent" in window;
}

export function initQibla(root) {
  if (!root || initializedRoot === root) return;
  initializedRoot = root;
  renderShell(root);

  let qiblaBearing = null;
  // Magnetic declination at the user's location, in degrees east. The compass
  // reads magnetic north, so this is added to get the true heading.
  let declinationDeg = 0;
  let receivedReliableHeading = false;
  const locationButton = root.querySelector("[data-qiblah-location]");
  const orientationButton = root.querySelector("[data-qiblah-orientation]");
  const needle = root.querySelector("[data-qiblah-needle]");

  const handleOrientation = (event) => {
    const rawHeading = getHeading(event);
    // rawHeading === null means this particular event doesn't give a
    // reliably north-referenced reading (see getHeading) — leave the
    // needle exactly where it is (pointing at the accurate static bearing
    // from setBearing()) rather than rotating it off something untrustworthy.
    if (rawHeading === null || qiblaBearing === null) return;
    const magneticHeading = headingSmoother.push(rawHeading);
    const heading = normalizeDegrees(magneticHeading + declinationDeg);
    if (!receivedReliableHeading) {
      receivedReliableHeading = true;
      if (fallbackTimerId !== null) {
        window.clearTimeout(fallbackTimerId);
        fallbackTimerId = null;
      }
      root.querySelector("[data-qiblah-sensor-note]").textContent =
        compassCalibrationNote(getCompassAccuracy(event));
    }
    needle.style.transform = `rotate(${normalizeDegrees(qiblaBearing - heading)}deg)`;
  };

  function startOrientation() {
    if (!supportsOrientation() || orientationListening) return;
    activeOrientationHandler = handleOrientation;
    window.addEventListener("deviceorientationabsolute", activeOrientationHandler, true);
    window.addEventListener("deviceorientation", activeOrientationHandler, true);
    orientationListening = true;
    receivedReliableHeading = false;
    headingSmoother.reset();
    renderStatus(root, "Compass enabled — waiting for a reading...");
    root.querySelector("[data-qiblah-sensor-note]").textContent = "Waiting for compass data...";

    // If no reliable (absolute) heading ever arrives, say so plainly
    // instead of leaving a "waiting" message up indefinitely — the user
    // still has the accurate static bearing shown above the needle.
    fallbackTimerId = window.setTimeout(() => {
      fallbackTimerId = null;
      if (!receivedReliableHeading) {
        root.querySelector("[data-qiblah-sensor-note]").textContent =
          "A reliable compass heading isn't available on this device. Use the exact bearing shown above instead.";
      }
    }, 2500);
  }

  async function requestOrientation() {
    if (typeof DeviceOrientationEvent.requestPermission === "function") {
      try {
        const permission = await DeviceOrientationEvent.requestPermission();
        if (permission !== "granted") {
          renderStatus(root, "Compass permission was not granted. Use the bearing shown below.", true);
          return;
        }
      } catch (error) {
        console.warn("[TAZAWWUD] Compass permission request failed:", error);
        renderStatus(root, "Compass permission was unavailable. Use the bearing shown below.", true);
        return;
      }
    }
    startOrientation();
  }

  locationButton.addEventListener("click", () => {
    if (!navigator.geolocation && !locator()) {
      renderStatus(root, "Location is unavailable in this browser. Unable to calculate Qiblah.", true);
      return;
    }
    locationButton.disabled = true;
    renderStatus(root, "Getting your location...");
    // Qiblah needs the freshest practical coordinates; the shared default is
    // intentionally city-level for prayer times and can be stale on a phone.
    getPositionWithFallback({ primaryHighAccuracy: true, timeout: 20000 }).then(
      ({ coords }) => {
        qiblaBearing = calculateQiblaBearing(coords.latitude, coords.longitude);
        declinationDeg = magneticDeclination(coords.latitude, coords.longitude);
        setBearing(root, qiblaBearing);
        renderStatus(root, `Qiblah calculated for ${coords.latitude.toFixed(2)}°, ${coords.longitude.toFixed(2)}°.`);
        if (supportsOrientation()) {
          orientationButton.hidden = false;
          // Not { once: true }: stopQibla() (view-leave cleanup, see below)
          // stops the live listeners, so re-enabling after returning to
          // this view needs the button to still work, not just the first time.
          orientationButton.addEventListener("click", requestOrientation);
        } else {
          root.querySelector("[data-qiblah-sensor-note]").textContent = "Compass sensors are unavailable. Use the exact bearing shown.";
        }
        locationButton.disabled = false;
      },
      (error) => {
        locationButton.disabled = false;
        const message = error?.code === 1
          ? "Location access was denied. Please allow location or use another compass app."
          : `Unable to get your location. ${describeLocationError(error)} Please try again.`;
        renderStatus(root, message, true);
        console.warn("[TAZAWWUD] Qiblah geolocation failed:", error?.message);
      }
    );
  });
}

/**
 * Removes the deviceorientation/deviceorientationabsolute listeners started
 * by "Enable compass" — call when navigating away from Qiblah. Without
 * this, enabling the compass once left it listening (and re-computing the
 * needle rotation) for the rest of the app session, on every other view,
 * for no reason. Location/bearing state is intentionally left alone — the
 * static Qiblah bearing should still be there, unchanged, if the user
 * comes back.
 */
export function stopQibla() {
  if (fallbackTimerId !== null) {
    window.clearTimeout(fallbackTimerId);
    fallbackTimerId = null;
  }
  if (!orientationListening) return;
  if (activeOrientationHandler) {
    window.removeEventListener("deviceorientationabsolute", activeOrientationHandler, true);
    window.removeEventListener("deviceorientation", activeOrientationHandler, true);
  }
  orientationListening = false;
  activeOrientationHandler = null;
}
