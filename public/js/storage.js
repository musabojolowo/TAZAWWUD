// ============================================================================
// TAZAWWUD - Offline Storage Helpers (Phase 12)
// ----------------------------------------------------------------------------
// A small localStorage facade keeps preferences and lightweight user data
// consistent across modules. Invalid or unavailable storage never breaks UI.
// ============================================================================

const STORAGE_PREFIX = "tazawwud:";

function key(name) {
  return `${STORAGE_PREFIX}${name}`;
}

export function readStorage(name, fallback = null) {
  try {
    const value = localStorage.getItem(key(name));
    return value === null ? fallback : JSON.parse(value);
  } catch (error) {
    console.warn(`[TAZAWWUD] Could not read offline storage: ${name}`, error);
    return fallback;
  }
}

export function writeStorage(name, value) {
  try {
    localStorage.setItem(key(name), JSON.stringify(value));
    return true;
  } catch (error) {
    console.warn(`[TAZAWWUD] Could not write offline storage: ${name}`, error);
    return false;
  }
}

export function removeStorage(name) {
  try {
    localStorage.removeItem(key(name));
  } catch (error) {
    console.warn(`[TAZAWWUD] Could not remove offline storage: ${name}`, error);
  }
}

export function readPreference(name, fallback = null) {
  return readStorage(`preference:${name}`, fallback);
}

export function writePreference(name, value) {
  return writeStorage(`preference:${name}`, value);
}

export function readBookmarks(scope = "offline") {
  return readStorage(`bookmarks:${scope}`, {});
}

export function writeBookmarks(scope, bookmarks) {
  return writeStorage(`bookmarks:${scope}`, bookmarks);
}

export function isOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/**
 * Removes every locally-stored piece of app data (bookmarks, last-read,
 * salah location/settings, theme, translation/reciter choice, adhkar
 * progress, everything). Every key this app has ever written uses the
 * "tazawwud:" prefix — via this file's key() helper or directly (theme.js,
 * salah.js, mushaf.js, cloud-sync.js) — so removing every key with that
 * prefix is complete, not a partial/best-effort list that can drift out of
 * date as new features add their own storage keys.
 */
export function clearAllLocalData() {
  try {
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k && k.startsWith(STORAGE_PREFIX)) toRemove.push(k);
    }
    toRemove.forEach((k) => localStorage.removeItem(k));
    return toRemove.length;
  } catch (error) {
    console.warn("[TAZAWWUD] Could not clear local storage:", error);
    return 0;
  }
}
