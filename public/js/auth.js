// ============================================================================
// TAZAWWUD — Auth Helper
// ----------------------------------------------------------------------------
// Phase 4, Part 3: bookmarks need a per-user path in Realtime Database, but
// email/password sign-up/sign-in screens haven't been built yet. Firebase's
// anonymous auth gives every visitor a stable UID with zero UI required, so
// bookmarking works today. When real email/password auth lands, an
// anonymous account can be upgraded in place with linkWithCredential() —
// nothing here needs to change to support that later.
// ============================================================================

import { auth } from "./firebase-config.js";
import {
  onAuthStateChanged,
  signInAnonymously,
  GoogleAuthProvider,
  signInWithPopup,
  linkWithPopup,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

let currentUser = null;
let resolveAuthReady;

/** Resolves (with the Firebase user, or null) once the initial auth state is known. */
export const authReady = new Promise((resolve) => {
  resolveAuthReady = resolve;
});

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  resolveAuthReady(user);
});

/**
 * Ensures there's a signed-in user (anonymous is fine), returning it.
 * Safe to call repeatedly — reuses the existing session once signed in.
 */
export async function ensureSignedIn() {
  await authReady;
  if (currentUser) return currentUser;

  try {
    const credential = await signInAnonymously(auth);
    currentUser = credential.user;
    return currentUser;
  } catch (error) {
    console.error("[TAZAWWUD] Anonymous sign-in failed:", error);
    return null;
  }
}

/**
 * Starts an explicit Google sign-in flow from a user gesture.
 * If the current session is anonymous, links Google onto that SAME uid
 * (so existing bookmarks/preferences under it keep working) instead of
 * switching to a brand-new account. Returns { user, isNewLink }.
 */
export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();

  if (currentUser?.isAnonymous) {
    try {
      const credential = await linkWithPopup(currentUser, provider);
      currentUser = credential.user;
      return { user: currentUser, isNewLink: true };
    } catch (error) {
      if (error.code !== "auth/credential-already-in-use") throw error;
      // This Google account already has its own Firebase user elsewhere —
      // sign into that existing account instead. The caller is responsible
      // for merging this (now-abandoned) anonymous uid's local data into it.
      console.warn(
        "[TAZAWWUD] Google account already linked to a different user; signing in to it instead."
      );
    }
  }

  const credential = await signInWithPopup(auth, provider);
  currentUser = credential.user;
  return { user: currentUser, isNewLink: false };
}

export function onUserChanged(callback) {
  return onAuthStateChanged(auth, callback);
}

/** Returns the current user's UID, or null if not signed in yet. */
export function getUid() {
  return currentUser?.uid ?? null;
}

/** Returns the full current Firebase user object (or null) — for reading
 *  displayName/email/isAnonymous in the account UI. */
export function getCurrentUser() {
  return currentUser;
}

/** Signs out. Does not re-establish an anonymous session — that happens
 *  lazily (ensureSignedIn()) the next time the person bookmarks something. */
export async function signOutUser() {
  await signOut(auth);
  currentUser = null;
}
