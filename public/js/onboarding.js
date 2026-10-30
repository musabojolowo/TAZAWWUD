// ============================================================================
// TAZAWWUD - First-launch intro and permission sequence
// ----------------------------------------------------------------------------
// Shown once. Order: the intro screens, then location, then notifications, then the
// Qur'an and Hadith downloads, then Adhan settings, then alarm and reminder settings.
// Each one is the
// phone's own prompt inside the Android app, or the browser's prompt on the web.
// If a permission is refused, the person is told how to turn it on later. The app
// never sends them to settings automatically.
// ============================================================================

import { getPosition } from "./geo.js";
import {
  requestNotificationPermission, inNativeApp, getAlarmStatus, openExactAlarmSettings, openBatterySettings,
} from "./native-bridge.js";

const DONE_KEY = "tazawwud:onboarding-done-v1";

export const SCREENS = [
  {
    icon: "⏰",
    title: "Never miss a prayer",
    text: "Accurate prayer times, Adhan alerts and reminders for all five daily prayers.",
  },
  {
    icon: "📖",
    title: "Read & listen to Qur’an",
    text: "A clean, distraction-free reading experience.",
  },
  {
    icon: "🤲",
    title: "Build your daily Islamic habits",
    text: "Access duas and your tasbih counter anytime, anywhere.",
  },
];

export function isOnboardingDone(storage = globalThis.localStorage) {
  try {
    return storage.getItem(DONE_KEY) === "1";
  } catch {
    return true; // storage blocked: never show the intro again in this session
  }
}

export function markOnboardingDone(storage = globalThis.localStorage) {
  try {
    storage.setItem(DONE_KEY, "1");
  } catch {
    // nothing else to do
  }
}

/**
 * Asks for location, then notifications, one after the other. Never throws, so a
 * refusal or an error can't block the app. Returns the outcome of each.
 */
export async function runPermissionSequence({ requestLocation, requestNotifications }) {
  const result = { location: "not-asked", notifications: "not-asked" };
  try {
    await requestLocation();
    result.location = "granted";
  } catch (error) {
    result.location = error?.code === 1 ? "denied" : "unavailable";
  }
  try {
    const answer = await requestNotifications();
    result.notifications = answer === "granted" ? "granted" : "denied";
  } catch {
    result.notifications = "unavailable";
  }
  return result;
}

/** Plain-language notes for anything that was refused or failed. */
export function permissionNotes(result, native = inNativeApp()) {
  const notes = [];
  const where = native ? "phone Settings > Apps > TAZAWWUD > Permissions" : "the lock icon in the address bar";
  if (result.location === "denied") {
    notes.push(`Prayer times and the Qiblah need your location. To turn it on later: ${where} > Location.`);
  } else if (result.location === "unavailable") {
    notes.push("We couldn’t get your location. Make sure Location is on, then tap “Use my location” on Home.");
  }
  if (result.notifications === "denied") {
    notes.push(`Prayer alerts need notifications. To turn them on later: ${where} > Notifications.`);
  }
  return notes;
}

function el(tag, styles = {}, text = "") {
  const node = document.createElement(tag);
  Object.assign(node.style, styles);
  if (text) node.textContent = text;
  return node;
}

const DOWNLOAD_NOTE =
  "The download starts straight away. You can follow it, or delete it, later in the sidebar under Account & Settings.";

function promptFrame(title, text) {
  const frame = el("div", {
    flex: "1", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    padding: "24px", textAlign: "center", overflowY: "auto",
  });
  const heading = el("h2", { margin: "0 0 12px", fontSize: "24px", fontWeight: "600" }, title);
  const note = el("p", { margin: "0 0 20px", maxWidth: "320px", color: "#b9d9d0", fontSize: "15px", lineHeight: "1.5" }, text);
  const controls = el("div", { display: "flex", flexDirection: "column", gap: "12px", width: "100%", maxWidth: "320px" });
  frame.append(heading, note, controls);
  return { frame, controls };
}

function promptButton(label, primary = true) {
  return el("button", {
    padding: "14px", borderRadius: "999px", fontSize: "16px", fontWeight: "600", cursor: "pointer",
    border: primary ? "0" : "1px solid #a7d8c9", background: primary ? "#00a35a" : "transparent", color: "#ffffff",
  }, label);
}

/** Step 1 of the downloads: the Qur'an, with a choice of translation. Skippable. */
async function showQuranPrompt(overlay, onDone) {
  const { TRANSLATION_EDITIONS } = await import("./quran.js");
  const { startQuranDownload } = await import("./downloads-ui.js");
  const { frame, controls } = promptFrame("Read the Qur’an offline", `Choose a translation to download. ${DOWNLOAD_NOTE}`);
  const select = el("select", { padding: "12px", borderRadius: "10px", fontSize: "15px" });
  TRANSLATION_EDITIONS.forEach((edition) => {
    const option = el("option", {}, edition.label);
    option.value = edition.code;
    select.append(option);
  });
  const download = promptButton("Download the Qur’an");
  const skip = promptButton("Skip for now", false);
  const status = el("p", { margin: "8px 0 0", color: "#f6d58b", fontSize: "14px" });
  download.addEventListener("click", async () => {
    download.disabled = true;
    try {
      await startQuranDownload(select.value);
      status.textContent = "Download started. You can follow it in the sidebar.";
      setTimeout(onDone, 1200);
    } catch (error) {
      console.error("[TAZAWWUD] Qur'an download did not start:", error);
      status.textContent = "The download could not start. You can try again from the sidebar.";
      download.disabled = false;
    }
  });
  skip.addEventListener("click", onDone);
  controls.append(select, download, skip, status);
  overlay.replaceChildren(frame);
}

/** Step 2 of the downloads: Hadith, one collection or all of them. Skippable. */
async function showHadithPrompt(overlay, onDone) {
  const { getHadithCollectionMeta } = await import("./hadith.js");
  const { startHadithDownload } = await import("./downloads-ui.js");
  const collections = getHadithCollectionMeta();
  const { frame, controls } = promptFrame(
    "Read Hadith offline",
    `Choose one collection, or download them all. Collections are large, so downloads can take a while. ${DOWNLOAD_NOTE}`
  );
  const select = el("select", { padding: "12px", borderRadius: "10px", fontSize: "15px" });
  collections.forEach((collection) => {
    const option = el("option", {}, collection.nameEn);
    option.value = collection.slug;
    select.append(option);
  });
  const downloadOne = promptButton("Download this collection");
  const downloadAll = promptButton("Download all collections", false);
  const skip = promptButton("Skip for now", false);
  const status = el("p", { margin: "8px 0 0", color: "#f6d58b", fontSize: "14px" });

  // Collections download one after another, in the background, so the prompt does not wait.
  const start = (slugs) => {
    downloadOne.disabled = true;
    downloadAll.disabled = true;
    status.textContent = "Download started. You can follow it in the sidebar.";
    (async () => {
      for (const slug of slugs) {
        try {
          await startHadithDownload(slug);
        } catch (error) {
          console.warn(`[TAZAWWUD] Hadith download did not start for ${slug}:`, error);
        }
      }
    })();
    setTimeout(onDone, 1200);
  };
  downloadOne.addEventListener("click", () => start([select.value]));
  downloadAll.addEventListener("click", () => start(collections.map((collection) => collection.slug)));
  skip.addEventListener("click", onDone);
  controls.append(select, downloadOne, downloadAll, skip, status);
  overlay.replaceChildren(frame);
}

/** Shows the intro once, on first launch. Safe to call on every start. */
/** Step 3: Adhan settings. Explains the alerts; the choices are changed later under Notifications & Adhan. */
function showAdhanPrompt(overlay, onDone) {
  const { frame, controls } = promptFrame(
    "Adhan and prayer alerts",
    "The Adhan plays for each prayer, and a bell for Sunrise. You can change the muadhin, and which prayers play the Adhan, at any time under Account & Settings, Notifications & Adhan.",
  );
  const next = promptButton("Continue");
  const skip = promptButton("Skip for now", false);
  next.addEventListener("click", onDone);
  skip.addEventListener("click", onDone);
  controls.append(next, skip);
  overlay.replaceChildren(frame);
}

/**
 * Step 4: exact alarms and battery use, so the Adhan rings on time. Shown only when
 * something still needs changing. On the web, or when everything is allowed, it is skipped.
 */
async function showAlarmPrompt(overlay, onDone) {
  const status = inNativeApp() ? await getAlarmStatus() : null;
  if (!status || (status.exactAlarms && status.batteryUnrestricted)) {
    onDone();
    return;
  }
  const { frame, controls } = promptFrame(
    "Alarms and reminders",
    "So prayer alerts ring on time, allow “Alarms & reminders” for TAZAWWUD, and set the battery for TAZAWWUD to Unrestricted. Your phone opens each setting for you. You can change these later, and a warning on the Notifications page stays until they are fixed.",
  );
  if (!status.exactAlarms) {
    const allow = promptButton("Allow alarms");
    allow.addEventListener("click", () => openExactAlarmSettings());
    controls.append(allow);
  }
  if (!status.batteryUnrestricted) {
    const battery = promptButton("Battery settings", false);
    battery.addEventListener("click", () => openBatterySettings());
    controls.append(battery);
  }
  const done = promptButton("Continue");
  done.addEventListener("click", onDone);
  controls.append(done);
  overlay.replaceChildren(frame);
}

export function maybeStartOnboarding() {
  if (isOnboardingDone()) return;

  const overlay = el("div", {
    position: "fixed", inset: "0", zIndex: "10000", background: "#003a33", color: "#ffffff",
    display: "flex", flexDirection: "column", fontFamily: "Inter, system-ui, sans-serif",
  });
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Welcome to TAZAWWUD");

  const skip = el("button", { alignSelf: "flex-end", margin: "20px", background: "none", border: "0", color: "#a7d8c9", fontSize: "15px", cursor: "pointer" }, "Skip");
  const body = el("div", { flex: "1", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "24px", textAlign: "center" });
  const icon = el("div", { fontSize: "96px", lineHeight: "1", marginBottom: "36px" });
  const title = el("h2", { margin: "0 0 12px", fontSize: "26px", fontWeight: "600" });
  const text = el("p", { margin: "0", maxWidth: "300px", color: "#b9d9d0", fontSize: "16px", lineHeight: "1.5" });
  const message = el("div", { maxWidth: "320px", color: "#f6d58b", fontSize: "15px", lineHeight: "1.5", marginTop: "18px" });
  body.append(icon, title, text, message);

  const dots = el("div", { display: "flex", justifyContent: "center", gap: "12px", margin: "24px 0" });
  const dotNodes = SCREENS.map(() => el("span", { width: "10px", height: "10px", borderRadius: "50%", border: "1px solid #a7d8c9" }));
  dotNodes.forEach((d) => dots.append(d));

  const action = el("button", {
    margin: "0 16px 32px", padding: "16px", border: "0", borderRadius: "999px", background: "#00a35a",
    color: "#ffffff", fontSize: "17px", fontWeight: "600", cursor: "pointer",
  }, "Get started");

  overlay.append(skip, body, dots, action);
  document.body.append(overlay);

  let index = 0;
  let phase = "intro";
  const finish = () => {
    markOnboardingDone();
    overlay.remove();
  };

  const showScreen = (i) => {
    index = i;
    const screen = SCREENS[i];
    icon.textContent = screen.icon;
    title.textContent = screen.title;
    text.textContent = screen.text;
    dotNodes.forEach((d, n) => { d.style.background = n === i ? "#a7d8c9" : "transparent"; });
    action.textContent = i < SCREENS.length - 1 ? "Continue" : "Get started";
  };

  const askPermissions = async () => {
    action.disabled = true;
    skip.hidden = true;
    action.textContent = "Please wait…";
    icon.textContent = "🔔";
    title.textContent = "Allow what TAZAWWUD needs";
    text.textContent = "Your answers are used only for prayer times, the Qiblah and alerts.";
    const outcome = await runPermissionSequence({
      requestLocation: () => getPosition({ timeout: 15000 }),
      requestNotifications: () => requestNotificationPermission(),
    });
    const notes = permissionNotes(outcome);
    if (notes.length) message.textContent = notes.join(" ");
    action.disabled = false;
    action.textContent = "Continue";
    phase = "permissions-done";
  };

  // One handler for the main button, moving through the steps in order.
  action.addEventListener("click", () => {
    if (phase === "intro") {
      if (index < SCREENS.length - 1) {
        showScreen(index + 1);
      } else {
        askPermissions();
      }
    } else if (phase === "permissions-done") {
      phase = "downloads";
      showQuranPrompt(overlay, () => showHadithPrompt(overlay, () => showAdhanPrompt(overlay, () => showAlarmPrompt(overlay, finish))));
    }
  });
  skip.addEventListener("click", finish);
  showScreen(0);
}
