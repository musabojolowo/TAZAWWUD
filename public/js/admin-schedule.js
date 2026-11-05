// ============================================================================
// TAZAWWUD - Admin: scheduled Qur'an verses and Hadith (up to 10 days at once).
// Writes the same dailyContent/{date} entries the daily form uses (verse and hadith only).
// The announcement for a date is never changed. A date shows its entry on that day, once the
// app is opened on that day. Cancelling removes the verse and hadith for the chosen dates.
// ============================================================================

import { db } from "./firebase-config.js";
import { ref, get, update } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";
import { fetchSurahList } from "./quran.js";
import { escapeHtml } from "./html-utils.js";

const MAX_DAYS = 10;
const BISMILLAH_PREFIX = /^بِسْمِ(?:\s+\S+){3}\s*/;
let quranCache = null;

async function loadQuranText() {
  if (!quranCache) {
    const [uthmani, pickthall] = await Promise.all([
      fetch("/data/quran-uthmani.json").then((r) => r.json()),
      fetch("/data/quran-pickthall.json").then((r) => r.json()),
    ]);
    quranCache = { uthmani: uthmani.suras, pickthall: pickthall.suras };
  }
  return quranCache;
}

/** The Arabic and English of one ayah, from the local Tanzil and Pickthall text. */
async function verseText(surahNumber, ayahNumber) {
  const { uthmani, pickthall } = await loadQuranText();
  const raw = uthmani[String(surahNumber)]?.[String(ayahNumber)];
  if (raw === undefined) return null;
  const arabic = ayahNumber === 1 && surahNumber !== 1 && surahNumber !== 9 ? raw.replace(BISMILLAH_PREFIX, "") : raw;
  return { arabic, translation: pickthall[String(surahNumber)]?.[String(ayahNumber)] ?? "" };
}

function isoDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function datesFrom(startIso, count) {
  const [y, m, d] = startIso.split("-").map(Number);
  return Array.from({ length: count }, (_, i) => isoDate(new Date(y, m - 1, d + i)));
}

function renderShell(container, surahs, startIso) {
  const surahOptions = surahs
    .map((s) => `<option value="${s.number}">${s.number}. ${escapeHtml(s.englishName)}</option>`)
    .join("");
  container.innerHTML = `
    <section class="admin-reminders__section" aria-labelledby="admin-schedule-heading">
      <h3 id="admin-schedule-heading">Scheduled Qur'an and Hadith</h3>
      <p class="admin-reminders__note">Schedule up to ${MAX_DAYS} days at once. Each day's verse and hadith appear on that date, when the app is opened on that day. Announcements are not changed here.</p>
      <form class="admin-reminders__form" data-schedule-controls>
        <label>Start date <input name="start" type="date" value="${startIso}" required /></label>
        <label>Days <select name="count">${Array.from({ length: MAX_DAYS }, (_, i) => `<option value="${i + 1}" ${i + 1 === MAX_DAYS ? "selected" : ""}>${i + 1}</option>`).join("")}</select></label>
        <div class="admin-reminders__actions">
          <button type="button" data-schedule-load>Load these days</button>
          <button type="submit" data-schedule-save>Save schedule</button>
          <button type="button" data-schedule-cancel>Cancel selected days</button>
        </div>
        <p class="admin-reminders__status" data-schedule-status role="status"></p>
      </form>
      <div class="admin-schedule__days" data-schedule-days></div>
    </section>`;
  return { surahOptions };
}

function dayRowHtml(index, date, surahOptions) {
  return `
    <details class="admin-schedule__day" data-day="${index}" open>
      <summary><strong>${date}</strong></summary>
      <fieldset class="admin-schedule__block">
        <legend>Qur'an verse</legend>
        <label>Surah <select data-field="surah"><option value="">None</option>${surahOptions}</select></label>
        <label>Ayah <input data-field="ayah" type="number" min="1" inputmode="numeric" /></label>
        <label>Arabic <textarea data-field="arabic" rows="2" readonly></textarea></label>
        <label>Translation <textarea data-field="translation" rows="2" readonly></textarea></label>
      </fieldset>
      <fieldset class="admin-schedule__block">
        <legend>Hadith</legend>
        <label>Collection <input data-field="hadithCollection" maxlength="160" /></label>
        <label>Reference <input data-field="hadithReference" maxlength="200" /></label>
        <label>Grade <input data-field="hadithGrade" maxlength="120" /></label>
        <label>Text <textarea data-field="hadithText" rows="3" maxlength="6000"></textarea></label>
      </fieldset>
    </details>`;
}

function readDay(row) {
  const get = (name) => row.querySelector(`[data-field="${name}"]`);
  const surah = Number(get("surah").value);
  const ayah = Number(get("ayah").value);
  const verse = surah && ayah ? { surahNumber: surah, ayahNumber: ayah } : null;
  const hadithText = get("hadithText").value.trim();
  const hadith = hadithText
    ? {
        collection: get("hadithCollection").value.trim(),
        reference: get("hadithReference").value.trim(),
        grade: get("hadithGrade").value.trim(),
        text: hadithText,
      }
    : null;
  return { verse, hadith };
}

async function fillVerse(row, surahs) {
  const surah = Number(row.querySelector('[data-field="surah"]').value);
  const ayah = Number(row.querySelector('[data-field="ayah"]').value);
  const arabic = row.querySelector('[data-field="arabic"]');
  const translation = row.querySelector('[data-field="translation"]');
  const max = surahs.find((s) => s.number === surah)?.numberOfAyahs;
  if (!surah || !ayah || !max || ayah > max) {
    arabic.value = "";
    translation.value = "";
    return;
  }
  const text = await verseText(surah, ayah);
  arabic.value = text?.arabic ?? "";
  translation.value = text?.translation ?? "";
}

/** Initialises the scheduler in the given container. Call only once the admin is confirmed. */
export async function initDailySchedule(container) {
  if (!container) return;
  const surahs = await fetchSurahList();
  const today = isoDate(new Date());
  const { surahOptions } = renderShell(container, surahs, today);
  const form = container.querySelector("[data-schedule-controls]");
  const status = container.querySelector("[data-schedule-status]");
  const daysEl = container.querySelector("[data-schedule-days]");

  const say = (message, isError = false) => {
    status.textContent = message;
    status.style.color = isError ? "#b3261e" : "";
  };

  const rebuildRows = () => {
    const count = Number(form.elements.count.value);
    const dates = datesFrom(form.elements.start.value, count);
    daysEl.innerHTML = dates.map((d, i) => dayRowHtml(i, d, surahOptions)).join("");
    daysEl.querySelectorAll(".admin-schedule__day").forEach((row) => {
      row.querySelector('[data-field="surah"]').addEventListener("change", () => fillVerse(row, surahs));
      row.querySelector('[data-field="ayah"]').addEventListener("change", () => fillVerse(row, surahs));
    });
    return dates;
  };

  const loadDays = async () => {
    const dates = rebuildRows();
    say("Loading…");
    try {
      const snaps = await Promise.all(dates.map((d) => get(ref(db, `dailyContent/${d}`))));
      snaps.forEach((snap, i) => {
        const row = daysEl.querySelector(`[data-day="${i}"]`);
        const value = snap.val() || {};
        if (value.verse) {
          row.querySelector('[data-field="surah"]').value = String(value.verse.surahNumber ?? "");
          row.querySelector('[data-field="ayah"]').value = String(value.verse.ayahNumber ?? "");
          fillVerse(row, surahs);
        }
        if (value.hadith) {
          row.querySelector('[data-field="hadithCollection"]').value = value.hadith.collection ?? "";
          row.querySelector('[data-field="hadithReference"]').value = value.hadith.reference ?? "";
          row.querySelector('[data-field="hadithGrade"]').value = value.hadith.grade ?? "";
          row.querySelector('[data-field="hadithText"]').value = value.hadith.text ?? "";
        }
      });
      say(`Loaded ${dates.length} day(s).`);
    } catch (error) {
      console.error("[TAZAWWUD] Could not load the schedule:", error);
      say("Could not load these days. Check your connection and try again.", true);
    }
  };

  container.querySelector("[data-schedule-load]").addEventListener("click", loadDays);
  form.elements.count.addEventListener("change", rebuildRows);
  form.elements.start.addEventListener("change", rebuildRows);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const dates = [...daysEl.querySelectorAll(".admin-schedule__day")].map((row) => row.dataset.day);
    const writes = {};
    for (const row of daysEl.querySelectorAll(".admin-schedule__day")) {
      const date = datesFrom(form.elements.start.value, Number(form.elements.count.value))[Number(row.dataset.day)];
      const { verse, hadith } = readDay(row);
      if (verse) {
        const text = await verseText(verse.surahNumber, verse.ayahNumber);
        if (!text) return say(`${date}: that ayah does not exist.`, true);
        writes[`dailyContent/${date}/verse`] = { ...verse, surahName: surahs.find((s) => s.number === verse.surahNumber)?.englishName ?? "", arabicText: text.arabic, translation: text.translation };
      }
      if (hadith) {
        if (!hadith.collection || !hadith.reference) return say(`${date}: enter the hadith collection and reference.`, true);
        writes[`dailyContent/${date}/hadith`] = hadith;
      }
    }
    if (dates.length === 0) return say("Nothing to save.", true);
    try {
      await update(ref(db), writes);
      say("Schedule saved.");
    } catch (error) {
      console.error("[TAZAWWUD] Could not save the schedule:", error);
      say("Could not save. Confirm admin access and try again.", true);
    }
  });

  container.querySelector("[data-schedule-cancel]").addEventListener("click", async () => {
    const dates = datesFrom(form.elements.start.value, Number(form.elements.count.value));
    if (!window.confirm(`Cancel the verse and hadith for ${dates.length} selected day(s)? Announcements are kept.`)) return;
    const writes = {};
    dates.forEach((d) => {
      writes[`dailyContent/${d}/verse`] = null;
      writes[`dailyContent/${d}/hadith`] = null;
    });
    try {
      await update(ref(db), writes);
      rebuildRows();
      say("Cancelled. The selected days no longer show a verse or hadith.");
    } catch (error) {
      console.error("[TAZAWWUD] Could not cancel the schedule:", error);
      say("Could not cancel. Confirm admin access and try again.", true);
    }
  });

  rebuildRows();
}
