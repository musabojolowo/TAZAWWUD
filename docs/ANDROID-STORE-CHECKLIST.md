# Google Play (Android) — checklist

Status: preparation only. No developer account, signing key or store listing has been created.

## What the app already has
- Web app manifest with name, start page (`/index.html`), standalone display, theme colour,
  and 192 and 512 px icons, including maskable versions.
- HTTPS hosting on `tazawwud-4028b.web.app`.
- Privacy policy at `/privacy.html`. It covers location, notifications, accounts, bookmarks and Firebase.
- No analytics or advertising.

## Needed before submission
1. **Google Play Console developer account** (one-time fee; confirm the current amount on Google's site).
   The owner must complete identity verification.
2. **Signing key.** Google Play App Signing is recommended: Google keeps the release key and you keep
   the upload key. Back up the upload key file and its password somewhere safe.
3. **Trusted Web Activity package** (for example built with Bubblewrap or PWABuilder), using the manifest.
4. **Digital Asset Links file**, served at
   `https://tazawwud-4028b.web.app/.well-known/assetlinks.json`. It needs the package name
   and the SHA-256 fingerprint of the signing key, so it can only be written after step 2.
   It must be added to the hosting before the app is reviewed, or the app opens with a browser bar.
5. **Store listing:** short and full description, screenshots (phone), 512 px app icon,
   1024 x 500 feature graphic.
6. **Data safety form.** Draft answers, to confirm against the final app:
   - Location: collected to calculate prayer times and the Qiblah direction. Not shared. Can be
     turned off.
   - Notifications: used for prayer and reminder alerts.
   - Personal info and account: anonymous Firebase account ID; Google sign-in is optional.
   - App activity: bookmarks and preferences, stored on the device and, when signed in, in the cloud.
   - No ads, no analytics, no sale of data.
7. **Content rating questionnaire** and **target audience** declaration.
8. **Google Cloud API key.** Add an Android restriction (package name and signing fingerprint) once the
   app exists. Keep the website restriction only if the web app still uses this key.

## Notes
- Play review can reject a site that is only a wrapper. The offline Qur'an, bookmarks and the
  prayer tools are the reasons this is a real app.
- Adhan recordings must be ones you have the right to distribute. See docs/ADHAN-AUDIO.md.
