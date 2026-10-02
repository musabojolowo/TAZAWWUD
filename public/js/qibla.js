// ============================================================================
// TAZAWWUD - Qiblah Compass (Phase 9)
// ----------------------------------------------------------------------------
// Calculates the great-circle bearing from the user's location to the Kaaba.
// Device orientation is used when available; otherwise the exact bearing is
// shown as a degree-only fallback.
// ============================================================================

const KAABA = { latitude: 21.422487, longitude: 39.826206 };
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

let initializedRoot = null;

function normalizeDegrees(degrees) {
  return (degrees + 360) % 360;
}

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
  if (typeof event.webkitCompassHeading === "number" && event.webkitCompassAccuracy !== -1) {
    return normalizeDegrees(event.webkitCompassHeading);
  }
  if (typeof event.alpha === "number") {
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
  let orientationListening = false;
  const locationButton = root.querySelector("[data-qiblah-location]");
  const orientationButton = root.querySelector("[data-qiblah-orientation]");
  const needle = root.querySelector("[data-qiblah-needle]");

  const handleOrientation = (event) => {
    const heading = getHeading(event);
    if (heading === null || qiblaBearing === null) return;
    needle.style.transform = `rotate(${normalizeDegrees(qiblaBearing - heading)}deg)`;
    root.querySelector("[data-qiblah-sensor-note]").textContent = "Live compass heading enabled.";
  };

  function startOrientation() {
    if (!supportsOrientation() || orientationListening) return;
    window.addEventListener("deviceorientationabsolute", handleOrientation, true);
    window.addEventListener("deviceorientation", handleOrientation, true);
    orientationListening = true;
    renderStatus(root, "Compass heading enabled. Hold your phone flat and follow the needle.");
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
    if (!navigator.geolocation) {
      renderStatus(root, "Location is unavailable in this browser. Unable to calculate Qiblah.", true);
      return;
    }
    locationButton.disabled = true;
    renderStatus(root, "Getting your location...");
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        qiblaBearing = calculateQiblaBearing(coords.latitude, coords.longitude);
        setBearing(root, qiblaBearing);
        renderStatus(root, `Qiblah calculated for ${coords.latitude.toFixed(2)}°, ${coords.longitude.toFixed(2)}°.`);
        if (supportsOrientation()) {
          orientationButton.hidden = false;
          orientationButton.addEventListener("click", requestOrientation, { once: true });
        } else {
          root.querySelector("[data-qiblah-sensor-note]").textContent = "Compass sensors are unavailable. Use the exact bearing shown.";
        }
        locationButton.disabled = false;
      },
      (error) => {
        locationButton.disabled = false;
        const message = error.code === error.PERMISSION_DENIED
          ? "Location access was denied. Please allow location or use another compass app."
          : "Unable to get your location. Please try again.";
        renderStatus(root, message, true);
        console.warn("[TAZAWWUD] Qiblah geolocation failed:", error.message);
      },
      { enableHighAccuracy: true, maximumAge: 300000, timeout: 10000 }
    );
  });
}
