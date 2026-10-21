# Adhan recordings

The app plays named Adhan recordings from MP3 files stored in
`public/assets/adhan/`. Each reciter in the app is linked to one exact file name.

| Reciter in the app | File name |
|---|---|
| Abdul Basit | `Abdul-Basit.mp3` |
| Abdul Ghaffar | `Abdul-Ghaffar.mp3` |
| Abdul Hakam | `Abdul-Hakam.mp3` |
| Al-Hussaini | `Al-Hussaini.mp3` |
| Minshawi | `Minshawi.mp3` |
| Naghshbandi | `Naghshbandi.mp3` |
| Hafiz Murad | `Hafiz-Murad.mp3` |
| Egypt | `Adhan-Egypt.mp3` |
| Madinah | `Adhan-Madinah.mp3` |
| Al-Aqsa | `Adhan-Alaqsa.mp3` |
| Makkah | `Adhan-Makkah.mp3` |
| Yusuf Islam | `Yusuf-Islam.mp3` |

## Rules

- Only add recordings you have the right to use: your own recordings, or
  recordings whose licence allows you to host and redistribute them.
- Keep each file small (ideally under 2 MB) so the app stays fast.
- If a file is missing, the app plays the built-in chime and shows a message
  saying so. Nothing breaks.

## Adding a new reciter

1. Add the MP3 to `public/assets/adhan/` with a simple name (letters, numbers
   and hyphens).
2. Add an entry for it in the `MUADHIN_OPTIONS` list in
   `public/js/notifications.js`, following the existing entries, with a unique `id`.
3. Bump the cache version in `public/sw.js`.
4. Commit, merge to `main`, and let the deploy finish.

## Checking after a deploy

Open Salah, choose the reciter, and tap **Test**. If the chime plays and the
message says the recording could not load, check the file name and that the
deploy has finished.
