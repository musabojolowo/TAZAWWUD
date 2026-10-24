// ============================================================================
// TAZAWWUD - Mushaf jump helpers (pure functions, no network or DOM)
// ----------------------------------------------------------------------------
// Used by the Mushaf "go to Surah and Ayah" form. The page of an ayah comes from
// the Surah data, which already includes each ayah's Mushaf page number.
// ============================================================================

/** Returns an error message for a Surah and Ayah the reader cannot open, or null if valid. */
export function validateJump(surah, ayah, numberOfAyahs) {
  if (!Number.isInteger(surah) || surah < 1 || surah > 114) return "Enter a Surah number from 1 to 114.";
  if (!Number.isInteger(ayah) || ayah < 1) return "Enter an Ayah number of 1 or more.";
  if (numberOfAyahs != null && ayah > numberOfAyahs) return `Surah ${surah} has ${numberOfAyahs} ayahs.`;
  return null;
}

/** The Mushaf page of an ayah, from the Surah data. Null if the ayah is not in it. */
export function pageForAyah(detail, ayah) {
  const target = detail?.ayahs?.find((item) => item.numberInSurah === ayah);
  return Number.isInteger(target?.page) ? target.page : null;
}

/** Rows for the Contents panel: valid surahs only, in order, with the labels to show. */
export function contentsEntries(surahs) {
  return (surahs || [])
    .filter((surah) => Number.isInteger(surah?.number) && surah.number >= 1 && surah.number <= 114)
    .slice()
    .sort((a, b) => a.number - b.number)
    .map((surah) => ({
      number: surah.number,
      arabicName: String(surah.name ?? ""),
      englishName: String(surah.englishName ?? `Surah ${surah.number}`),
      translation: String(surah.englishNameTranslation ?? ""),
      ayahCount: Number.isInteger(surah.numberOfAyahs) ? surah.numberOfAyahs : null,
    }));
}
