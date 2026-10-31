// ============================================================================
// TAZAWWUD - About page: what the app contains, and where its content comes from.
// ============================================================================

const ABOUT_STYLE_HREF = "/css/sidebar-redesign.css";

function ensureAboutStyles() {
  if (document.querySelector(`link[href="${ABOUT_STYLE_HREF}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = ABOUT_STYLE_HREF;
  document.head.append(link);
}

const FEATURES = [
  ["Qur'an", "Read in the Mushaf page view or the verse view. Choose a translation and a reciter, bookmark an ayah, and go to any surah and ayah. Download the text, translations, Mushaf pages and recitations for offline reading."],
  ["Hadith", "Read the Hadith collections in the app, and download them for offline reading."],
  ["Salah", "Prayer times for your location or a city you choose, with your calculation method and Asr school. A Qiblah compass shows the direction of the Ka’bah, with the bearing in degrees."],
  ["Adhan and reminders", "Adhan alerts for each prayer, with a choice of reciters. Optional Qur’an, Adhkar and Friday reminders. Turn each one on or off."],
  ["Prayer tracker", "Tick the prayers you have prayed. A prayer can be ticked once its time has passed, and your streak counts the days you complete all five."],
  ["Daily tools", "Dua and Dhikr, the 99 Names of Allah, a Tasbih counter, the Hijri calendar, Stories, and a Mosque Finder that opens Google Maps."],
];

const SOURCES = [
  ["Qur’an text and translations", "AlQuran.cloud (api.alquran.cloud)."],
  ["Prayer times", "AlAdhan (aladhan.com)."],
  ["Hadith collections", "The open hadith API used by the app."],
  ["Hisn al-Muslim (Fortress of the Muslim)", "By Sa’id bin Ali bin Wahf al-Qahtani. Arabic text, transliteration and English translation from OpenDua (opendua.org), licensed under Creative Commons Attribution 4.0 (CC BY 4.0)."],
  ["Icons", "Material Symbols by Google, licensed under the Apache License, Version 2.0."],
  ["Maps", "Mosque results open in Google Maps. Google Maps is a trademark of Google LLC."],
];

function esc(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function initAbout(root) {
  if (!root) return;
  ensureAboutStyles();
  root.innerHTML = `
    <section class="ab-hero">
      <p class="ab-hero__arabic" lang="ar" dir="rtl">تَزَوُّد</p>
      <h2 class="ab-title">TAZAWWUD</h2>
      <p class="ab-tagline">Your provision for every day.</p>
    </section>

    <section class="ab-card" aria-labelledby="ab-what">
      <h3 id="ab-what" class="ab-heading">What is inside</h3>
      <ul class="ab-list">
        ${FEATURES.map(([title, text]) => `<li><strong>${esc(title)}</strong><span>${esc(text)}</span></li>`).join("")}
      </ul>
    </section>

    <section class="ab-card" aria-labelledby="ab-free">
      <h3 id="ab-free" class="ab-heading">Free and ad-free</h3>
      <p class="ab-text">TAZAWWUD is free and has no advertising. Your bookmarks, ticks, settings and downloads are stored on your phone.</p>
    </section>

    <section class="ab-card" aria-labelledby="ab-sources">
      <h3 id="ab-sources" class="ab-heading">Sources and credits</h3>
      <dl class="ab-sources">
        ${SOURCES.map(([name, text]) => `<div><dt>${esc(name)}</dt><dd>${esc(text)}</dd></div>`).join("")}
      </dl>
    </section>

    <section class="ab-card" aria-labelledby="ab-links">
      <h3 id="ab-links" class="ab-heading">Policies</h3>
      <nav class="ab-links" aria-label="Policies">
        <a href="/privacy.html">Privacy policy</a>
        <a href="/terms.html">Terms of use</a>
      </nav>
    </section>
  `;
}
