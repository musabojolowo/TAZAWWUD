// ============================================================================
// TAZAWWUD — Bookmarks Module
// ----------------------------------------------------------------------------
// Phase 4, Part 3: persists ayah bookmarks to Firebase Realtime Database,
// scoped under the signed-in user's UID (anonymous or, later, a real
// account — see auth.js). Data shape:
//
//   /bookmarks/{uid}/{surahNumber}_{ayahNumber} = { surah, ayah, ts }
//
// Realtime Database rules (per-user read/write scoping, field validation,
// and a per-user size cap) live in /database.rules.json at the project
// root — deploy with `firebase deploy --only database`.
// ============================================================================

import { db } from "./firebase-config.js";
import { ensureSignedIn } from "./auth.js";
import { readBookmarks, writeBookmarks } from "./storage.js";
import {
  ref,
  get,
  set,
  remove,
  update,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";

function bookmarkKey(surahNumber, ayahNumber) {
  return `${surahNumber}_${ayahNumber}`;
}

function updateLocalBookmark(scope, surahNumber, ayahNumber, bookmarked) {
  const bookmarks = readBookmarks(scope, {});
  const key = bookmarkKey(surahNumber, ayahNumber);
  if (bookmarked) {
    bookmarks[key] = { surah: surahNumber, ayah: ayahNumber, ts: Date.now() };
  } else {
    delete bookmarks[key];
  }
  writeBookmarks(scope, bookmarks);
}

/**
 * Merges bookmarks saved locally under one uid's scope into another uid's
 * cloud bookmarks — used when signInWithGoogle() has to abandon an
 * anonymous uid (that Google account already has its own Firebase user).
 * Additive only: never deletes anything from the destination.
 */
export async function mergeLocalBookmarksIntoCloud(fromUid, toUid) {
  const local = readBookmarks(fromUid, {});
  const entries = Object.entries(local);
  if (!entries.length) return 0;

  try {
    const updates = {};
    entries.forEach(([key, entry]) => {
      updates[`bookmarks/${toUid}/${key}`] = entry;
    });
    await update(ref(db), updates);
    return entries.length;
  } catch (error) {
    console.warn("[TAZAWWUD] Could not merge local bookmarks into the signed-in account:", error.message);
    return 0;
  }
}

/** Deletes every cloud bookmark for a user (privacy/data-deletion control). */
export async function deleteAllCloudBookmarks(uid) {
  if (!uid) return;
  await remove(ref(db, `bookmarks/${uid}`));
}

function toggleLocalBookmark(scope, surahNumber, ayahNumber) {
  const bookmarks = readBookmarks(scope, {});
  const key = bookmarkKey(surahNumber, ayahNumber);
  const bookmarked = !bookmarks[key];
  updateLocalBookmark(scope, surahNumber, ayahNumber, bookmarked);
  return bookmarked;
}

/**
 * Toggles a single ayah's bookmark for the current user.
 * @returns {Promise<boolean|null>} true if now bookmarked, false if removed,
 *   null if the user couldn't be signed in (e.g. offline).
 */
export async function toggleBookmark(surahNumber, ayahNumber) {
  const user = await ensureSignedIn();
  const scope = user?.uid || "offline";

  if (!user) {
    return toggleLocalBookmark(scope, surahNumber, ayahNumber);
  }

  try {
    const bookmarkRef = ref(db, `bookmarks/${user.uid}/${bookmarkKey(surahNumber, ayahNumber)}`);
    const snapshot = await get(bookmarkRef);

    if (snapshot.exists()) {
      await remove(bookmarkRef);
      updateLocalBookmark(scope, surahNumber, ayahNumber, false);
      return false;
    }

    await set(bookmarkRef, { surah: surahNumber, ayah: ayahNumber, ts: Date.now() });
    updateLocalBookmark(scope, surahNumber, ayahNumber, true);
    return true;
  } catch (error) {
    // Realtime Database unreachable (offline, etc.) — fall back to the same
    // local-only toggle used when signed out, scoped to this user's uid.
    // cloud-sync.js already reads bookmarks from this same local scope and
    // pushes them up once the connection returns, so nothing is lost.
    console.warn("[TAZAWWUD] Bookmark sync unavailable, saved locally instead:", error.message);
    return toggleLocalBookmark(scope, surahNumber, ayahNumber);
  }
}

/**
 * Returns the set of bookmarked ayah numbers (numberInSurah) for one Surah,
 * for the current user. Empty set if signed-out or nothing bookmarked.
 */
export async function getBookmarksForSurah(surahNumber) {
  const user = await ensureSignedIn();
  const scope = user?.uid || "offline";

  const marked = new Set(Object.values(readBookmarks(scope, {}))
    .filter((entry) => entry.surah === surahNumber)
    .map((entry) => entry.ayah));

  if (!user) return marked;

  try {
    const userBookmarksRef = ref(db, `bookmarks/${user.uid}`);
    const snapshot = await get(userBookmarksRef);
    if (snapshot.exists()) {
      Object.values(snapshot.val()).forEach((entry) => {
        if (entry.surah === surahNumber) marked.add(entry.ayah);
      });
    }
  } catch (error) {
    // Offline/unreachable — the local set above is still returned as-is.
    console.warn("[TAZAWWUD] Could not fetch cloud bookmarks, showing local-only:", error.message);
  }

  return marked;
}

/**
 * Every saved ayah bookmark for the current user, newest first, as { surah, ayah, ts }.
 * Reads this phone's copy, then the cloud copy when reachable. Never creates a session
 * just to list bookmarks: if no one is signed in, only the phone's copy is shown.
 */
export async function listBookmarks() {
  let user = null;
  try {
    user = await ensureSignedIn();
  } catch (error) {
    console.warn("[TAZAWWUD] Bookmarks: no session, showing this phone's bookmarks only:", error.message);
  }
  const scope = user?.uid || "offline";
  const merged = new Map();
  const add = (entry) => {
    const surah = Number(entry?.surah);
    const ayah = Number(entry?.ayah);
    if (Number.isInteger(surah) && Number.isInteger(ayah)) {
      merged.set(bookmarkKey(surah, ayah), { surah, ayah, ts: Number(entry.ts) || 0 });
    }
  };
  Object.values(readBookmarks(scope) || {}).forEach(add);

  if (user) {
    try {
      const snapshot = await get(ref(db, `bookmarks/${user.uid}`));
      if (snapshot.exists()) Object.values(snapshot.val()).forEach(add);
    } catch (error) {
      console.warn("[TAZAWWUD] Could not fetch cloud bookmarks, showing this phone's copy:", error.message);
    }
  }
  return [...merged.values()].sort((a, b) => b.ts - a.ts);
}
