// ============================================================================
// TAZAWWUD - Cloud Sync (Phase 13)
// ----------------------------------------------------------------------------
// Realtime Database is the active sync store for the existing Spark-compatible
// project. Firestore is initialized separately for future collection-based data.
// Local values remain the source of truth when the network is unavailable.
// ============================================================================

import { db } from "./firebase-config.js";
import { getUid, onUserChanged } from "./auth.js";
import { ref, update, get, remove } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";

const PREFERENCE_KEYS = [
  "tazawwud:theme",
  "tazawwud:translation",
  "tazawwud:reciter",
  "tazawwud:salah-settings",
  "tazawwud:prayer-notifications-enabled",
  "tazawwud:adhkar-progress",
  "tazawwud:lastReadSurah",
];

function readLocalValue(key) {
  try {
    const value = localStorage.getItem(key);
    if (value === null) return null;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  } catch {
    return null;
  }
}

function collectPreferences() {
  return PREFERENCE_KEYS.reduce((preferences, key) => {
    const value = readLocalValue(key);
    if (value !== null) preferences[key.replace("tazawwud:", "")] = value;
    return preferences;
  }, {});
}

/**
 * Fills in any preference this device has never set locally, from the
 * user's cloud copy (e.g. signing in on a new device/browser). Never
 * overwrites a value the device already has — that direction is
 * syncUserData()'s job. Safe to call on every sign-in, every time.
 */
export async function restoreUserData({ onStatus } = {}) {
  const report = (message, isError = false) => onStatus?.({ message, isError });
  const uid = getUid();
  if (!uid || !navigator.onLine) return false;

  try {
    const snapshot = await get(ref(db, `users/${uid}/preferences`));
    if (!snapshot.exists()) return true;

    const remote = snapshot.val() || {};
    let restoredAny = false;
    PREFERENCE_KEYS.forEach((key) => {
      if (readLocalValue(key) !== null) return; // this device already has a value — keep it
      const shortKey = key.replace("tazawwud:", "");
      const remoteValue = remote[shortKey];
      if (remoteValue === undefined) return;
      localStorage.setItem(key, typeof remoteValue === "string" ? remoteValue : JSON.stringify(remoteValue));
      restoredAny = true;
    });

    if (restoredAny) report("Restored your preferences from your account.");
    return true;
  } catch (error) {
    console.warn("[TAZAWWUD] Could not restore preferences:", error.message);
    return false;
  }
}

/** Pushes this device's preferences to the cloud. Bookmarks sync separately
 *  through bookmarks/{uid}/... in bookmarks.js — not duplicated here. */
export async function syncUserData({ onStatus } = {}) {
  const report = (message, isError = false) => onStatus?.({ message, isError });
  if (!navigator.onLine) {
    report("Offline: local preferences will sync when you reconnect.");
    return false;
  }

  const uid = getUid();
  if (!uid) {
    report("Sign in to back up your preferences and bookmarks.");
    return false;
  }

  try {
    await update(ref(db, `users/${uid}`), {
      preferences: collectPreferences(),
      updatedAt: Date.now(),
    });
    report("Cloud sync is up to date.");
    return true;
  } catch (error) {
    console.error("[TAZAWWUD] Cloud sync failed:", error);
    report("Cloud sync will retry when the connection is available.", true);
    return false;
  }
}

/** Deletes a user's cloud preferences node (privacy/data-deletion control). */
export async function deleteCloudPreferences(uid) {
  if (!uid) return;
  await remove(ref(db, `users/${uid}`));
}

export function watchAuthAndSync(options = {}) {
  return onUserChanged(async () => {
    await restoreUserData(options);
    syncUserData(options);
  });
}
