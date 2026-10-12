// ============================================================================
// TAZAWWUD — IndexedDB cache for large API JSON
// ----------------------------------------------------------------------------
// Persistent storage for responses too large or too numerous for localStorage
// (full Hadith editions, Qur'an Surah/page JSON, tafsir). localStorage stays
// for small preferences and settings.
//
// Contract: every exported function resolves to a safe value and never
// throws. If IndexedDB is missing, blocked, slow, or out of quota, callers
// simply get "not cached" (null / false) and the app continues normally.
// ============================================================================

const DB_NAME = "tazawwud-api-cache";
const DB_VERSION = 1;
const STORE = "responses";
const OPEN_TIMEOUT_MS = 4000;
const OP_TIMEOUT_MS = 8000;

let dbPromise = null;

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    promise.then(
      (value) => {
        clearTimeout(id);
        resolve(value);
      },
      (error) => {
        clearTimeout(id);
        reject(error);
      }
    );
  });
}

function openDatabase() {
  if (dbPromise) return dbPromise;
  dbPromise = withTimeout(
    new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("IndexedDB is not available in this browser"));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "key" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("IndexedDB open was blocked"));
    }),
    OPEN_TIMEOUT_MS,
    "IndexedDB open"
  ).catch((error) => {
    dbPromise = null; // allow a later call to retry opening
    throw error;
  });
  return dbPromise;
}

/**
 * Reads one entry. Resolves to { value, storedAt } or null.
 * Callers must still validate `value` before using it.
 */
export async function cacheGet(key) {
  try {
    const db = await openDatabase();
    const entry = await withTimeout(
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const request = tx.objectStore(STORE).get(key);
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error);
        tx.onabort = () => reject(tx.error || new Error("IndexedDB read aborted"));
      }),
      OP_TIMEOUT_MS,
      "IndexedDB read"
    );
    return entry ? { value: entry.value, storedAt: entry.storedAt } : null;
  } catch (error) {
    console.warn(`[TAZAWWUD] Offline cache read failed for ${key}:`, error.message);
    return null;
  }
}

/**
 * Writes one entry, rejecting if the write does not commit (quota, abort,
 * unavailable). Downloads use this so a full disk is reported, not ignored.
 */
export async function cachePutOrThrow(key, value) {
  const db = await openDatabase();
  await withTimeout(
    new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ key, value, storedAt: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("IndexedDB write aborted"));
    }),
    OP_TIMEOUT_MS,
    "IndexedDB write"
  );
}

/**
 * Best-effort write: resolves to true only after the transaction has
 * committed, false on any failure. Used by the normal API cache, where a
 * failed write must never break a live request.
 */
export async function cachePut(key, value) {
  try {
    await cachePutOrThrow(key, value);
    return true;
  } catch (error) {
    console.warn(`[TAZAWWUD] Offline cache write failed for ${key}:`, error.message);
    return false;
  }
}

/** Removes one entry. Resolves to true on success, false otherwise. */
export async function cacheDelete(key) {
  try {
    const db = await openDatabase();
    await withTimeout(
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error("IndexedDB delete aborted"));
      }),
      OP_TIMEOUT_MS,
      "IndexedDB delete"
    );
    return true;
  } catch (error) {
    console.warn(`[TAZAWWUD] Offline cache delete failed for ${key}:`, error.message);
    return false;
  }
}
