// ============================================================================
// TAZAWWUD — Bookmarks screen
// ----------------------------------------------------------------------------
// Lists the ayahs the person has bookmarked in the Qur'an reader. Tapping one
// opens that surah at that ayah (see app.js, "tazawwud:open-surah").
// ============================================================================

import { listBookmarks } from "./bookmarks.js";
import { fetchSurahList } from "./quran.js";
import { escapeHtml } from "./html-utils.js";

function renderMessage(container, html) {
  container.innerHTML = `<div class="stories-status">${html}</div>`;
}

function renderList(container, bookmarks, surahNames) {
  const items = bookmarks.map((bookmark) => {
    const name = surahNames.get(bookmark.surah) || `Surah ${bookmark.surah}`;
    return `
      <li>
        <button type="button" class="settings-row-btn" data-surah="${bookmark.surah}" data-ayah="${bookmark.ayah}">
          <span class="material-symbols-rounded icon" aria-hidden="true">bookmark</span>
          <span>${escapeHtml(name)} · Ayah ${bookmark.ayah}</span>
        </button>
      </li>`;
  }).join("");
  container.innerHTML = `
    <header class="view-header">
      <h2 class="view-header__title">Bookmarks</h2>
      <p class="view-header__subtitle">Tap a bookmark to open that ayah in the Qur'an.</p>
    </header>
    <ul class="settings-list">${items}</ul>
  `;
  container.querySelectorAll("[data-surah]").forEach((button) => {
    button.addEventListener("click", () => {
      window.dispatchEvent(new CustomEvent("tazawwud:open-surah", {
        detail: { surahNumber: Number(button.dataset.surah), ayahNumber: Number(button.dataset.ayah) },
      }));
    });
  });
}

export async function initBookmarks(container) {
  if (!container) return;
  renderMessage(container, "Loading bookmarks…");
  try {
    const bookmarks = await listBookmarks();
    if (!bookmarks.length) {
      renderMessage(container, "No bookmarks yet. Open a surah in the Qur'an, tap an ayah, then tap the bookmark icon.");
      return;
    }
    let surahNames = new Map();
    try {
      const surahs = await fetchSurahList();
      surahNames = new Map(surahs.map((surah) => [surah.number, surah.englishName]));
    } catch (error) {
      console.warn("[TAZAWWUD] Bookmarks: surah names unavailable:", error.message);
    }
    renderList(container, bookmarks, surahNames);
  } catch (error) {
    console.error("[TAZAWWUD] Bookmarks failed to load:", error);
    renderMessage(container, "Couldn't load your bookmarks. Check your connection, then reopen this screen.");
  }
}
