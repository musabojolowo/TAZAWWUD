# TAZAWWUD — Deployment Guide

## Prerequisites
- Firebase CLI installed and logged in (`npm i -g firebase-tools`, `firebase login`)
- The correct project selected: `firebase use tazawwud-4028b` (check `.firebaserc`)

## Before every deploy
1. `node tests/smoke-test.mjs` — must pass (exit 0).
2. Confirm `public/sw.js`'s `CACHE_VERSION` was bumped if any file under
   `public/` changed. The smoke test flags this, but double-check by eye —
   forgetting this means already-installed users keep the old version
   indefinitely (this has happened repeatedly during development).
3. Walk `docs/SECURITY-AUDIT-CHECKLIST.md` at least once per release,
   fully after any change touching auth, bookmarks, or Firebase rules.
4. If `database.rules.json` changed: deploy rules to a **staging**
   Firebase project first (a second project, or the Firebase Emulator
   Suite) and test there before touching production. A bad rules deploy
   can either lock out real users or expose data — there is no dry-run
   against the live database.
5. If `firebase.json`'s CSP (`hosting.headers`) changed: deploy to a
   preview channel first —
   `firebase hosting:channel:deploy preview-name` — and walk section 8 of
   `docs/SECURITY-AUDIT-CHECKLIST.md` there before promoting to
   production. A wrong CSP silently breaks features (blocked network
   requests, blocked fonts, blocked sign-in) rather than throwing an
   obvious error, so this can't be skipped.

## Deploying
```bash
# Hosting only (the app itself)
firebase deploy --only hosting

# Realtime Database rules only
firebase deploy --only database

# Both
firebase deploy --only hosting,database
```

There is no build step — `public/` is deployed as-is (vanilla JS, ES
modules, no bundler). What's in the ZIP/repo is exactly what ships.

## Granting the first Stories admin (one-time, manual, by design)
There is no in-app way to make someone an admin — not a bug, a deliberate
choice. This project has no Cloud Functions (Spark/free-plan compliance,
per the comment in `firebase-config.js`), so there's no server-side code
to safely automate this, and `database.rules.json` makes the `admins/`
node **unwritable from the client entirely** (`.write: false`) specifically
so no client-side bug or compromised session could ever grant someone
admin access. The only way in is the Firebase Console, by you:

1. Have the person sign in to TAZAWWUD with Google at least once.
2. Open `#admin` in the app as that person (Settings sidebar → About →
   "Stories Admin", or just the URL). It will show "not an admin yet" and
   display their UID — have them send it to you, or look it up yourself
   in Firebase Console → Authentication → Users.
3. Firebase Console → Realtime Database → Data → add a child under
   `admins`: key = their UID, value = `true`.
4. They don't need to reload — `admin.js` re-checks on every auth-state
   change, so the CMS appears as soon as the write lands.

To revoke: delete that key from `admins/` the same way. There is
currently no way to list all current admins from within the app (by
design — the `admins/` node's read rule only lets a user check their own
UID) — keep track of who you've granted access to yourself, or check the
Realtime Database data view directly in the Firebase Console.

## Rolling back
Firebase Hosting keeps prior releases — use the Firebase Console
(Hosting → release history → Rollback) rather than trying to manually
recreate an older deploy. Realtime Database rules have no built-in
rollback; keep the previous `database.rules.json` content (git history,
or a copy) before deploying a rules change.

## What is NOT yet part of this pipeline
- No CI (GitHub Actions or similar) runs the smoke test automatically —
  it's a manual step today. Wiring it into a pre-deploy CI job (fail the
  deploy if `node tests/smoke-test.mjs` exits non-zero) is a natural next
  step, not yet done.
- No emulator-based automated test of the RTDB rules themselves — section
  3 of the audit checklist covers this manually for now.
- No automated test of the CSP itself — section 8 of the audit checklist
  covers this manually (console-log-based) for now.
