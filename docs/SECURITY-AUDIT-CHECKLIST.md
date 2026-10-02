# TAZAWWUD — Security & Release Audit Checklist

Run `node tests/smoke-test.mjs` first — it covers syntax, config validity,
known XSS patterns, and stale-cache detection automatically. Everything
below needs a human with a real browser/device, and should be run before
every production deploy.

## 1. Automated (run this first)
- [ ] `node tests/smoke-test.mjs` exits 0

## 2. Cross-Site Scripting (XSS)
- [ ] Hadith search: type `<img src=x onerror=alert(1)>` into the search box
      on at least 2 collections. Confirm it's shown as literal text, not
      executed. (This was a real, confirmed bug — fixed this session.)
- [ ] Open a few different Surahs and a few different Hadith
      collections/chapters — confirm Arabic text, translations, and
      names render as text, not truncated or malformed by escaping.
- [ ] View source / inspect element on a rendered ayah or hadith card and
      confirm no raw `<`/`>` characters leak through unescaped.

## 3. Firebase — Realtime Database rules
- [ ] Deploy `database.rules.json` to a **staging** project first, not
      production, and re-run this section there.
- [ ] Signed out: confirm every read/write to `/bookmarks` and `/users` is
      rejected (Firebase console → Rules Playground, or just try it from
      the app while signed out).
- [ ] Signed in as user A: confirm A cannot read or write
      `/bookmarks/{other-uid}` or `/users/{other-uid}`.
- [ ] Try writing a bookmark with `surah: 200` (out of range), `ayah: "two"`
      (wrong type), or an extra unexpected field — confirm the write is
      rejected by validation, not silently accepted.
- [ ] Confirm `/users/{uid}/bookmarks` no longer exists for any account
      going forward (the old duplicate path) — existing old data there is
      harmless but is no longer written to.

## 4. Authentication
- [ ] Fresh browser profile (or clear site data): open the app, bookmark a
      few ayat anonymously, then sign in with Google. Confirm the
      bookmarks are still there after sign-in (this was a real, confirmed
      bug — anonymous→Google linking previously created a brand-new
      account and silently orphaned all anonymous data).
- [ ] Sign in with a Google account that has **never** used this app
      before vs. one that has an **existing** TAZAWWUD account under a
      different (earlier) anonymous session — confirm the merge message
      appears in the second case and bookmarks end up merged, not lost.
- [ ] Sign in on a second device/browser with the same Google account:
      confirm preferences (translation, reciter, theme) restore from the
      cloud rather than being silently overwritten by the new device's
      empty defaults.

## 5. Offline behaviour
- [ ] Load the app once online, then go offline (DevTools → Network →
      Offline, or airplane mode). Confirm: previously-opened Qur'an pages
      still open; a previously-played Surah's audio still plays; a
      previously-opened Hadith collection still opens; Salah times still
      show (falls back to the on-device solar estimate).
- [ ] Confirm the offline experience never shows a broken/blank screen —
      always either real content or an explicit "you're offline" state.

## 6. Service worker / cache
- [ ] After any JS/CSS/HTML change: confirm `CACHE_VERSION` in `sw.js` was
      bumped (smoke test's check #4 catches this automatically).
- [ ] Hard-reload a device that already has the app installed and confirm
      it picks up the new version (no stuck-on-old-cache behavior).

## 7. Manual feature pass (whatever this release touched)
- [ ] Qur'an: open at least 5 different Surahs in Verse View (not just
      Al-Fatihah) — confirm full Arabic + translation for each.
- [ ] Mushaf: open several pages, use "Switch to Verses" from a page that
      is **not** Al-Fatihah's — confirm it opens the correct Surah.
- [ ] Salah: confirm all 5 prayer times, location change, and countdown.
- [ ] Qiblah: confirm it loads with location granted and with location
      denied (shows a clear message either way, never a blank screen).
- [ ] Calendar: confirm today is highlighted, month navigation works, and
      the Hijri date shown matches what Home shows for the same day.

## 8. Content-Security-Policy (headers set in firebase.json)
CSP is the highest-risk change in this project to date — a wrong entry
silently breaks a feature instead of throwing an obvious error. **Deploy
to a staging/preview channel first** (`firebase hosting:channel:deploy
preview`), not directly to production, and check the browser console for
`Refused to ...` / `Content-Security-Policy` violation messages on every
page below before promoting to production.
- [ ] Home, Qur'an (Verse View + Mushaf), Hadith, Salah, Qiblah, Calendar —
      each loads with no CSP errors in the console.
- [ ] Qur'an/Hadith/Calendar data still loads (console: no blocked
      `connect-src` for api.alquran.cloud / api.aladhan.com /
      cdn.jsdelivr.net / raw.githubusercontent.com).
- [ ] Qur'an audio plays for at least 2 different reciters (console: no
      blocked `media-src`/`connect-src` for `*.mp3quran.net`).
- [ ] Google Fonts (Inter, Noto Naskh Arabic, Material Symbols) render —
      if blocked, Arabic text falls back to a system font and looks wrong.
- [ ] Anonymous sign-in AND Google sign-in both still work (console: no
      blocked `connect-src` for identitytoolkit/securetoken.googleapis.com,
      no blocked `script-src` for apis.google.com/gstatic.com).
- [ ] Bookmarks still save/sync (RTDB over `wss://*.firebaseio.com`).
- [ ] Dark mode toggle still works with no flash of the wrong theme on
      reload (confirms `theme-preload.js` — no longer inline — still
      loads and runs before first paint).
- [ ] Service worker still registers (`/js/app.js` now handles this, not
      an inline script — check the console log line on load).
- [ ] If anything in this section fails: the fix is almost always one
      missing host in `connect-src`/`script-src`/`media-src` in
      `firebase.json`, not a deeper problem — check the console's exact
      blocked URL and add its origin to the matching directive.

## 9. Adhan / Muadhin selector (Salah settings)
- [ ] Both options appear in the dropdown: "Simple Chime" and "Adhan
      (generic recording, unverified source)" — the ⚠ marks the
      unverified one, by design (see notifications.js's sourcing note).
- [ ] "Test" plays the currently-selected sound immediately.
- [ ] Switching the selection and pressing "Test" again plays the new one.
- [ ] The choice persists after closing and reopening the app.
- [ ] With notifications enabled, confirm the selected sound (not always
      the chime) plays at the next prayer time.
- [ ] If the generic Adhan recording fails to load/play: this is the
      known-unverified source — see the report for this work item before
      treating it as a regression.

## 10. Tasbih (new feature)
- [ ] Opens from Home's Quick Access, and from the bottom-of-page routes
      correctly (confirms the new `navigateTo()` helper — see report).
- [ ] Tap increments the count; switching phrases keeps each phrase's
      count separate; selecting "Custom" shows a text input and the typed
      text appears in the big display without losing cursor position.
- [ ] Reaching the target (33/99/100) rolls the count back to 0 and
      increments "sets completed today"; selecting "No limit" never rolls
      over.
- [ ] Reset asks for confirmation before zeroing the count.
- [ ] Count and phrase/target choice persist after closing and reopening
      the app (survives a real reload, not just a view switch).
- [ ] Works fully offline (no network calls at all — nothing to check
      beyond the app shell loading).

## 11. Daily Reminders (settings sidebar)
- [ ] Adding a reminder asks for notification permission first; if denied,
      no reminder is added and the "blocked" note appears.
- [ ] A reminder set for 1-2 minutes from now actually fires a system
      notification while the app is open.
- [ ] Toggling a reminder off prevents it from firing; deleting removes it
      from the list immediately.
- [ ] Reminders persist after closing and reopening the app.
- [ ] **Known, documented limitation — not a bug**: a reminder does NOT
      fire if the app/tab has been fully closed (not just backgrounded).
      This is a plain client-side timer, the same mechanism the existing
      prayer-time notifications already use — true push notifications
      while fully closed would need a server-side Web Push/FCM backend,
      which is new infrastructure this project doesn't have.

## 12. Islamic Stories + Admin CMS — highest-risk feature in this project
**Deploy `database.rules.json` to staging first and test every item below
there before production.** This is the first feature where a rules mistake
could let a non-admin modify content, not just see something they
shouldn't.

**Architecture, so the checks below make sense:**
- Who's an admin is purely `admins/{uid}: true` in the database — nothing
  in the app's JS decides this, only `database.rules.json` does.
- `admins/` is `.write: false` for everyone, including existing admins —
  only editable directly in the Firebase Console. See
  `docs/DEPLOYMENT.md` → "Granting the first Stories admin".
- `stories/.read` is `true` for everyone, including signed-out users and
  **including unpublished drafts** — this is a deliberate, documented
  trade-off (see the comment in `database.rules.json` and in `stories.js`):
  Realtime Database can't natively filter a broad read by a per-record
  field for some readers but not others the way Firestore can. The app
  itself never *displays* unpublished stories to non-admins, but a
  technically sophisticated person could read a draft's raw JSON via a
  direct database query. If true draft secrecy is required later, that
  needs either a Cloud Function (new infrastructure) or migrating Stories
  to Firestore — out of scope here.
- `stories/.write` requires `admins/{the signed-in uid}` to exist. Every
  field (`title`, `body`, `category`, `author`, `imageUrl`, `published`,
  timestamps) has its own type/length validation — an extra field not in
  that list is rejected outright (`$other: { ".validate": false }`).

**Tests — as a non-admin (signed out, and separately as a signed-in but
non-admin Google account):**
- [ ] Stories view shows only published stories, never drafts.
- [ ] Opening `#admin` shows "not an admin" (or "sign in") — never the CMS.
- [ ] From the browser console, try writing directly to `stories/` via the
      SDK (`set(ref(db,'stories/x'),{title:'x'})`) — must be rejected.
- [ ] Try writing to `admins/{your-uid}` directly — must be rejected (this
      is the one that matters most: confirms nobody can self-promote).

**Tests — as a granted admin:**
- [ ] CMS loads, shows all stories (published and draft).
- [ ] Add Story: new stories start as drafts (unpublished) — confirm they
      do NOT appear in the public Stories view until explicitly published.
- [ ] Publish a story — confirm it appears in Stories **live, without a
      reload**, in a second browser/tab open to the Stories view (tests
      the onValue real-time listener actually works end to end).
- [ ] Unpublish it — confirm it disappears from Stories live too.
- [ ] Edit a story's title/body — confirm the change reflects immediately
      in the CMS list; open the public detail view and confirm it updated
      there too.
- [ ] Delete a story — confirm it's gone from both the CMS and Stories.
- [ ] Try submitting a title over 200 characters, or a body over 20,000 —
      confirm the client-side error shows before any write is attempted.
- [ ] Try an image URL that isn't `https://` — confirm it's rejected
      client-side with a clear message.
- [ ] Paste a real `https://` image URL — confirm the image actually
      loads on both the card and detail view (confirms the CSP's
      `img-src` change — see below — actually works).

**CSP note:** adding Stories required broadening `img-src` from `'self'
data:` to `'self' data: https:` (story images are admin-pasted URLs from
any host — this project has no Firebase Storage per policy, so there's no
fixed host to allowlist instead). Re-run CSP section 8 checks after this
change, specifically confirming no *other* image-related regressions.

**Navigating away:** 
- [ ] Open Stories, then navigate to another view, then back — confirm no
      duplicate/stacked Firebase listeners (check the console for repeated
      "Admin: failed to load" or similar if you go back and forth several
      times rapidly; `stopStories()`/`stopAdmin()` should prevent this).

## Known limitations (not fixed by this checklist)
- No automated RTDB rules test suite (Firebase's own emulator + rules unit
  tests would be the next step here, not yet set up in this project).
- No automated CSP test — section 8 above is manual/console-log-based only.
- The smoke test's XSS check is a text heuristic, not a real parser — it
  can miss a differently-shaped bug. Section 2 above is the real backstop.
- `style-src` allows `'unsafe-inline'` (several places set inline
  `style="background-color: ..."` for dynamic per-item colors). This is
  intentionally scoped to styles only, not scripts — inline styles can't
  execute arbitrary JS. Converting those to CSS classes would let this be
  tightened further; not done here to keep this change targeted.
