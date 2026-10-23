// ============================================================================
// TAZAWWUD - Notification hub
// ----------------------------------------------------------------------------
// One notification manager for the whole app. It is created on first use and
// keeps running when the Notifications screen is closed. The Salah page sends
// the day's prayer times with the "tazawwud:prayer-times" event.
// ============================================================================

import { createNotificationManager } from "./notifications.js";

let manager = null;

export function getNotificationManager() {
  // The manager finds its status line by searching the whole page, so it reaches
  // the Notifications screen wherever it is drawn.
  if (!manager) manager = createNotificationManager(document.body);
  return manager;
}

window.addEventListener("tazawwud:prayer-times", (event) => {
  getNotificationManager().setPrayerTimes(event.detail?.timings);
});
