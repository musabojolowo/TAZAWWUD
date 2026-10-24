// ============================================================================
// TAZAWWUD - Bundled Qur'an text (Tanzil Project, Uthmani, CC BY 3.0)
// ----------------------------------------------------------------------------
// The file public/data/quran/quran-uthmani.txt is stored exactly as downloaded
// from tanzil.net. It is never edited. Display-only adjustments are made here,
// in memory, after reading.
//
// Attribution: Tanzil Project, https://tanzil.net, Creative Commons Attribution 3.0.
// ============================================================================

const TEXT_URL = "/data/quran/quran-uthmani.txt";
// The bismillah is compared without tatweel, diacritics or alef-wasla forms, because the
// Tanzil text writes these words with a tatweel (for example ٱلرَّحْمَـٰنِ).
const BISMILLAH_SKELETON = "بسم الله الرحمن الرحيم";

function skeleton(text) {
  return String(text)
    .replace(/\uFEFF/g, "")
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g, "")
    .replace(/[\u0671\u0622]/g, "\u0627")
    .replace(/\s+/g, " ")
    .trim();
}
// Surahs without an opening bismillah banner in the reader (see quran.js).
const NO_BISMILLAH_BANNER = new Set([1, 9]);

let loading = null;
let byKey = null;

/** Parses "surah|ayah|text" lines into a Map keyed by "surah:ayah". Text is kept unchanged. */
export function parseQuranText(source) {
  const map = new Map();
  for (const line of source.split("\n")) {
    const match = line.match(/^(\d+)\|(\d+)\|(.*)$/);
    if (!match) continue; // notice block and blank lines
    map.set(`${Number(match[1])}:${Number(match[2])}`, match[3]);
  }
  return map;
}

/** Loads the bundled file once. Resolves to null if it cannot be read, so callers can fall back. */
export function loadLocalQuran() {
  if (!loading) {
    loading = fetch(TEXT_URL, { cache: "force-cache" })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then((text) => {
        byKey = parseQuranText(text);
        return byKey;
      })
      .catch((error) => {
        console.warn("[TAZAWWUD] Bundled Qur'an text unavailable:", error.message);
        byKey = null;
        return null;
      });
  }
  return loading;
}

/** Display rule: the first ayah of most surahs has the bismillah removed, as the reader shows it. */
export function displayArabic(text, surahNumber, ayahNumber) {
  if (ayahNumber !== 1 || NO_BISMILLAH_BANNER.has(surahNumber)) return text;
  const words = String(text).split(" ");
  if (words.length <= 4) return text;
  if (skeleton(words.slice(0, 4).join(" ")) !== BISMILLAH_SKELETON) return text;
  return words.slice(4).join(" ");
}

/** Arabic text of one ayah from the bundled file, adjusted for display, or null if unavailable. */
export function localArabic(surahNumber, ayahNumber) {
  if (!byKey) return null;
  const stored = byKey.get(`${surahNumber}:${ayahNumber}`);
  return stored === undefined ? null : displayArabic(stored, surahNumber, ayahNumber);
}
