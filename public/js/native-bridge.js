// ============================================================================
// TAZAWWUD — native bridge (Capacitor Android shell)
// ----------------------------------------------------------------------------
// Inside the Android app, notifications and location go through Capacitor's
// native plugins, because the WebView does not provide the browser Notification
// API and blocks the browser location prompt. In a browser every function below
// reports the same results as before, so the website is unchanged.
// ============================================================================

const ALERT_CHANNEL = { id: "tazawwud-alerts", name: "Prayer and reminder alerts", importance: 4 };
let nativePermissionCache = false;
let channelReady = false;

function capacitor() {
  return typeof window !== "undefined" ? window.Capacitor : undefined;
}

export function inNativeApp() {
  try {
    return !!capacitor()?.isNativePlatform?.();
  } catch {
    return false;
  }
}

function plugin(name) {
  if (!inNativeApp()) return null;
  try {
    return capacitor()?.Plugins?.[name] ?? null;
  } catch {
    return null;
  }
}

export function notifier() {
  return plugin("LocalNotifications");
}

export function locator() {
  return plugin("Geolocation");
}

/** True when the app can show alerts at all (browser API or native plugin). */
export function notificationApiAvailable() {
  return !!notifier() || (typeof window !== "undefined" && "Notification" in window);
}

/** Synchronous permission check. Inside the app it reads the value last confirmed. */
export function notificationPermissionSync() {
  if (notifier()) return nativePermissionCache;
  return typeof Notification !== "undefined" && Notification.permission === "granted";
}

/** Remembers the native permission and tells the page to refresh its controls. */
function setNativePermission(granted) {
  const changed = nativePermissionCache !== granted;
  nativePermissionCache = granted;
  if (changed && typeof window !== "undefined") {
    window.dispatchEvent(new Event("tazawwud:notification-permission-changed"));
  }
}

/** Asks the native side for the current permission and remembers it. */
export async function notificationPermissionGranted() {
  const n = notifier();
  if (!n) return typeof Notification !== "undefined" && Notification.permission === "granted";
  try {
    const result = await n.checkPermissions();
    setNativePermission(result?.display === "granted");
  } catch {
    setNativePermission(false);
  }
  return nativePermissionCache;
}

/** Shows the permission prompt. Resolves to "granted" or "denied", like the browser API. */
export async function requestNotificationPermission() {
  const n = notifier();
  if (!n) {
    return typeof Notification !== "undefined" ? Notification.requestPermission() : "denied";
  }
  try {
    const result = await n.requestPermissions();
    setNativePermission(result?.display === "granted");
  } catch {
    setNativePermission(false);
  }
  return nativePermissionCache ? "granted" : "denied";
}

async function ensureAlertChannel(n) {
  if (channelReady) return;
  try {
    await n.createChannel(ALERT_CHANNEL);
  } catch (error) {
    console.warn("[TAZAWWUD] Could not create alert channel:", error?.message);
  }
  channelReady = true;
}

/** A stable 31-bit number for a tag, because the native API needs an integer id. */
function notificationId(tag) {
  let hash = 0;
  for (const ch of String(tag)) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(hash) % 2147483000 || 1;
}

/** Shows one alert through the native plugin. Resolves to false outside the app. */
export async function showNativeAlert({ title, body, tag, url }) {
  const n = notifier();
  if (!n) return false;
  await ensureAlertChannel(n);
  await n.schedule({
    notifications: [{
      id: notificationId(tag),
      title,
      body,
      channelId: ALERT_CHANNEL.id,
      schedule: { at: new Date(Date.now() + 500), allowWhileIdle: true },
      extra: { url },
    }],
  });
  return true;
}

/** Native location with the same error codes as the browser (1 denied, 2 unavailable, 3 timeout). */
export async function getNativePosition({ timeout = 15000, enableHighAccuracy = false, maximumAge = 300000 } = {}) {
  const g = locator();
  if (!g) return null;
  const perm = await g.requestPermissions();
  if (perm?.location !== "granted") {
    throw Object.assign(new Error("Location permission was refused."), { code: 1 });
  }
  const timer = new Promise((_, reject) => setTimeout(
    () => reject(Object.assign(new Error("Location request timed out."), { code: 3 })), timeout));
  const found = await Promise.race([
    g.getCurrentPosition({ enableHighAccuracy, timeout, maximumAge }),
    timer,
  ]);
  return { coords: { latitude: found.coords.latitude, longitude: found.coords.longitude } };
}

/**
 * Sends the saved prayer settings, location and notification preferences to the native
 * side, which sets the Adhan alarms and the countdown card. A no-op in a browser.
 */
export function syncNativeSchedule() {
  const bridge = plugin("PrayerBridge");
  if (!bridge) return;
  try {
    const read = (key) => JSON.parse(localStorage.getItem(key) || "null");
    const settings = read("tazawwud:salah-settings") || {};
    const location = read("tazawwud:salah-location");
    const prefs = read("tazawwud:notification-prefs") || {};
    bridge.saveSettings({
      location,
      method: Number.isInteger(settings.method) ? settings.method : 3,
      school: Number.isInteger(settings.school) ? settings.school : 0,
      master: prefs.master !== false,
      offsetMinutes: Number(prefs.offsetMinutes) || 0,
      prayers: prefs.prayers || {},
      quran: prefs.quran || {},
      adhkar: prefs.adhkar || {},
      friday: prefs.friday || {},
    }).catch((error) => console.warn("[TAZAWWUD] Native schedule not saved:", error?.message));
  } catch (error) {
    console.warn("[TAZAWWUD] Native schedule could not be read:", error?.message);
  }
}

// Keep the cached permission current, and the native alarms in step, when the app starts.
if (inNativeApp()) {
  notificationPermissionGranted();
  syncNativeSchedule();
}
