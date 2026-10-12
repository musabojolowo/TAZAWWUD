// ============================================================================
// TAZAWWUD — Daily featured content (public Home display)
// ----------------------------------------------------------------------------
// Reads the public dailyContent/{YYYY-MM-DD} record written by authorized
// admins. All remote text is escaped before it enters the DOM.
// ============================================================================

import { db } from "./firebase-config.js";
import { get, ref } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";
import { escapeHtml } from "./html-utils.js";

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function renderContent(root, content) {
  const blocks = [];
  if (content.announcement?.active === true) {
    blocks.push(`
      <article class="daily-feature-card daily-feature-card--announcement" aria-label="Announcement">
        <p class="daily-feature-card__eyebrow">Announcement</p>
        <h2 class="daily-feature-card__title">${escapeHtml(content.announcement.title)}</h2>
        <p class="daily-feature-card__body">${escapeHtml(content.announcement.body)}</p>
      </article>
    `);
  }

  if (content.verse?.arabicText && content.verse?.translation) {
    const verse = content.verse;
    const reference = `${verse.surahName ? `${verse.surahName} ` : `Surah ${verse.surahNumber}:`}${verse.surahName ? `${verse.surahNumber}:` : ""}${verse.ayahNumber}`;
    blocks.push(`
      <article class="daily-feature-card" aria-label="Verse of the Day">
        <p class="daily-feature-card__eyebrow">Verse of the Day</p>
        <p class="daily-feature-card__arabic" lang="ar" dir="rtl">${escapeHtml(verse.arabicText)}</p>
        <p class="daily-feature-card__body">${escapeHtml(verse.translation)}</p>
        <p class="daily-feature-card__source">${escapeHtml(reference)}</p>
      </article>
    `);
  }

  if (content.hadith?.text) {
    const hadith = content.hadith;
    blocks.push(`
      <article class="daily-feature-card" aria-label="Hadith of the Day">
        <p class="daily-feature-card__eyebrow">Hadith of the Day</p>
        <p class="daily-feature-card__body">${escapeHtml(hadith.text)}</p>
        <p class="daily-feature-card__source">${escapeHtml(hadith.collection)} · ${escapeHtml(hadith.reference)}${hadith.grade ? ` · ${escapeHtml(hadith.grade)}` : ""}</p>
      </article>
    `);
  }

  root.innerHTML = blocks.join("");
}

export async function initDailyFeaturedContent(root) {
  if (!root) return;
  root.setAttribute("aria-busy", "true");
  try {
    const snapshot = await get(ref(db, `dailyContent/${localDateKey()}`));
    const content = snapshot.val() || {};
    renderContent(root, content);
    if (content.verse || content.hadith) {
      document.querySelector(".daily-reminders")?.remove();
    }
  } catch (error) {
    console.error("[TAZAWWUD] Could not load daily featured content:", error);
    root.replaceChildren();
  } finally {
    root.setAttribute("aria-busy", "false");
  }
}
