// ============================================================================
// TAZAWWUD — Canonical 604-page Mushaf reader
// ----------------------------------------------------------------------------
// Arabic text and page boundaries come from Al Quran Cloud's canonical
// `/v1/page/{page}/quran-uthmani` endpoint. The existing reading card remains
// a flowing paragraph with ayah-end numbers; only its data source and page
// navigation are canonicalized here.
// ============================================================================

import {
  RECITERS,
  getReciter,
  buildSurahAudioUrl,
  getCurrentReciterId,
  setCurrentReciterId,
  getCurrentTranslationCode,
  setCurrentTranslationCode,
  TRANSLATION_EDITIONS,
  fetchAyahTafsir,
  fetchSurahDetail,
} from "./quran.js";
import { toggleBookmark, getBookmarksForSurah } from "./bookmarks.js";
import { ensureSignedIn } from "./auth.js";
import { db } from "./firebase-config.js";
import { ref, get, set } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js";
import { fetchJsonWithFallback, renderFallbackNotice } from "./error-boundary.js";
import { escapeHtml } from "./html-utils.js";
import { validateJump, pageForAyah } from "./mushaf-jump.js";

const API_BASE = "https://api.alquran.cloud/v1";
const PAGE_COUNT = 604;
const NO_BISMILLAH_BANNER = new Set([1, 9]); // Al-Fatihah's Bismillah IS ayah 1; At-Tawbah has none
const BISMILLAH_TEXT = "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ";
const LAST_SURAH_STORAGE_KEY = "tazawwud:lastReadSurah";
const BISMILLAH_PREFIX = /^\uFEFF?بِسْمِ\s+ٱ?للَّهِ\s+ٱ?لرَّحْمَٰنِ\s+ٱ?لرَّحِيمِ\s*/;

const cachedPages = new Map();

let autoScrollActive = false;
let repeatActive = false;
let autoScrollRAF = null;

// ----------------------------------------------------------------------------
// Last-read-Surah persistence (instant via localStorage, best-effort sync
// to Firebase so "Continue Reading" follows the same account across devices)
// ----------------------------------------------------------------------------

function saveLastSurahLocally(surahNumber) {
  localStorage.setItem(LAST_SURAH_STORAGE_KEY, String(surahNumber));
}

function getLastSurahLocally() {
  const stored = localStorage.getItem(LAST_SURAH_STORAGE_KEY);
  return stored ? Number(stored) : null;
}

async function saveLastSurahRemote(surahNumber) {
  try {
    const user = await ensureSignedIn();
    if (!user) return;
    await set(ref(db, `progress/${user.uid}/lastSurah`), surahNumber);
  } catch (error) {
    console.error("[TAZAWWUD] Failed to sync last-read Surah:", error);
  }
}

/** Records progress WITHOUT blocking the UI — fire-and-forget by design. */
function recordLastRead(surahNumber) {
  saveLastSurahLocally(surahNumber);
  saveLastSurahRemote(surahNumber); // not awaited — never delays rendering
}

/** Best-effort lookup of where to resume; localStorage wins for instant response. */
async function resolveStartingSurah() {
  const local = getLastSurahLocally();
  if (local) return local;
  try {
    const user = await ensureSignedIn();
    if (!user) return 1;
    const snapshot = await get(ref(db, `progress/${user.uid}/lastSurah`));
    return snapshot.exists() ? snapshot.val() : 1;
  } catch {
    return 1;
  }
}

// ----------------------------------------------------------------------------
// Rendering
// ----------------------------------------------------------------------------

function renderSkeleton() {
  return `
    <div class="reading-card reading-card--skeleton">
      <div class="skeleton-block skeleton-block--line-lg" style="width: 40%; height: 20px; margin: 0 auto 8px;"></div>
      <div class="skeleton-block skeleton-block--line-sm" style="width: 25%; margin: 0 auto 20px;"></div>
      ${Array.from({ length: 8 })
        .map(() => `<div class="skeleton-block" style="height: 24px; margin-bottom: 10px;"></div>`)
        .join("")}
    </div>
  `;
}

function renderErrorState(container, onRetry) {
  container.innerHTML = `
    <div class="state-message state-message--error">
      <span class="material-symbols-rounded icon icon--lg" aria-hidden="true">error</span>
      <p>Couldn't load this Sūrah. Please check your connection and try again.</p>
      <button type="button" class="btn-retry">Retry</button>
    </div>
  `;
  container.querySelector(".btn-retry")?.addEventListener("click", onRetry);
}

function toArabicDigits(n) {
  const map = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];
  return String(n).split("").map((d) => map[Number(d)] ?? d).join("");
}

/** Top bar: prev/next page nav, page number + Juz (from the ayah data itself — never invented), reciter/translation pickers. */
function renderReadingTopBar(pageNumber, juzLabel) {
  return `
    <div class="reading-topbar">
      <button type="button" id="prev-page-btn" class="reading-nav-btn" aria-label="Previous page" ${pageNumber <= 1 ? "disabled" : ""}>
        <span class="material-symbols-rounded icon" aria-hidden="true">chevron_left</span>
      </button>
      <span class="reading-topbar__title">
        Page ${pageNumber}${juzLabel ? `<span class="reading-topbar__juz"> · ${juzLabel}</span>` : ""}
      </span>
      <div class="reading-topbar__actions">
        <label class="select-pill select-pill--compact">
          <span class="material-symbols-rounded icon icon--sm" aria-hidden="true">record_voice_over</span>
          <select id="reading-reciter-select">
            ${RECITERS.map(
              (r) => `<option value="${r.id}" ${r.id === getCurrentReciterId() ? "selected" : ""}>${r.label}</option>`
            ).join("")}
          </select>
        </label>
        <label class="select-pill select-pill--compact">
          <span class="material-symbols-rounded icon icon--sm" aria-hidden="true">translate</span>
          <select id="reading-translation-select">
            ${TRANSLATION_EDITIONS.map(
              (t) => `<option value="${t.code}" ${t.code === getCurrentTranslationCode() ? "selected" : ""}>${t.label}</option>`
            ).join("")}
          </select>
        </label>
      </div>
      <button type="button" id="next-page-btn" class="reading-nav-btn" aria-label="Next page" ${pageNumber >= PAGE_COUNT ? "disabled" : ""}>
        <span class="material-symbols-rounded icon" aria-hidden="true">chevron_right</span>
      </button>
    </div>
  `;
}

export async function fetchPage(pageNumber, translationCode) {
  const cacheKey = `${pageNumber}:${translationCode}`;
  if (cachedPages.has(cacheKey)) return cachedPages.get(cacheKey);

  const result = await fetchJsonWithFallback(`${API_BASE}/page/${pageNumber}/quran-uthmani`, {
    cacheKey: `quran:page:${pageNumber}`,
    persistent: true,
    validate: (value) =>
      value?.code === 200 &&
      Array.isArray(value.data?.ayahs) &&
      value.data.number === pageNumber,
  });
  const payload = result.data;

  const surahNumbers = [...new Set(payload.data.ayahs.map((ayah) => ayah.surah.number))];
  const details = await Promise.all(surahNumbers.map((number) => fetchSurahDetail(number, translationCode)));
  const detailBySurah = new Map(details.map((detail) => [detail.number, detail]));
  const page = {
    number: pageNumber,
    ayahs: payload.data.ayahs.map((ayah) => {
      const detail = detailBySurah.get(ayah.surah.number);
      const detailAyah = detail?.ayahs.find((item) => item.numberInSurah === ayah.numberInSurah);
      return {
        ...ayah,
        arabic: String(ayah.text).replace(
          ayah.numberInSurah === 1 && !NO_BISMILLAH_BANNER.has(ayah.surah.number) ? BISMILLAH_PREFIX : /^$/,
          ""
        ),
        translation: detailAyah?.translation ?? "",
      };
    }),
    details: detailBySurah,
    source: result.source,
  };
  // Only cache clean network results — a cache/fallback result is already
  // persisted by fetchJsonWithFallback itself, and re-caching it here under
  // the in-memory key would mask a later successful network fetch this tab.
  if (result.source === "network") cachedPages.set(cacheKey, page);
  return page;
}

/**
 * Groups a page's ayahs into runs by Surah (a page can span up to a
 * handful of Surahs, e.g. the very short ones near the end of the Mushaf).
 * Every group boundary is exactly where numberInSurah === 1, i.e. where
 * the API's own data says a Surah starts — nothing here is guessed.
 */
function groupPageBySurah(page) {
  const segments = [];
  let current = null;
  page.ayahs.forEach((ayah) => {
    if (!current || current.surahNumber !== ayah.surah.number) {
      current = { surahNumber: ayah.surah.number, surah: ayah.surah, ayahs: [] };
      segments.push(current);
    }
    current.ayahs.push(ayah);
  });
  return segments;
}

/**
 * Renders the page as real Mushaf-style running text: an ornamental Surah
 * heading + Bismillah only where a Surah actually begins on this page (not
 * a repeated banner at the top of every page), a light "continued" label
 * when the page opens mid-Surah, and each Surah's ayahs as one continuous
 * justified paragraph with ayah-end markers — no per-ayah cards.
 */
function renderPageSegments(page) {
  const segments = groupPageBySurah(page);

  return segments.map((segment, index) => {
    const startsNewSurah = segment.ayahs[0]?.numberInSurah === 1;
    let heading = "";

    if (startsNewSurah) {
      heading = `
        <div class="mushaf-surah-heading">
          <span class="mushaf-surah-heading__name" lang="ar" dir="rtl">${escapeHtml(segment.surah.name)}</span>
          <span class="mushaf-surah-heading__name-en">${escapeHtml(segment.surah.englishName)} · ${escapeHtml(segment.surah.englishNameTranslation)}</span>
        </div>
        ${!NO_BISMILLAH_BANNER.has(segment.surahNumber)
          ? `<p class="bismillah-banner bismillah-banner--reading" lang="ar" dir="rtl">${BISMILLAH_TEXT}</p>`
          : ""}
      `;
    } else if (index === 0) {
      // Page opens mid-Surah — orient the reader without implying a fresh start.
      heading = `<p class="mushaf-page-continuing">${escapeHtml(segment.surah.englishName)} — continued</p>`;
    }

    const ayahMarkup = segment.ayahs.map((ayah) => `
      <span class="reading-ayah" data-surah="${ayah.surah.number}" data-ayah="${ayah.numberInSurah}" tabindex="0" role="button" aria-label="${escapeHtml(ayah.surah.englishName)} Ayah ${ayah.numberInSurah}">${escapeHtml(ayah.arabic)}</span>
      <span class="reading-ayah-num" data-surah="${ayah.surah.number}" data-ayah="${ayah.numberInSurah}" tabindex="0" role="button" aria-label="${escapeHtml(ayah.surah.englishName)} Ayah ${ayah.numberInSurah} options">${toArabicDigits(ayah.numberInSurah)}</span>
    `).join(" ");

    return `${heading}<p class="reading-text" lang="ar" dir="rtl">${ayahMarkup}</p>`;
  }).join("");
}

/** Traditional Mushaf page-bottom numbering, in Arabic-Indic digits. */
function renderMushafFooter(pageNumber) {
  return `
    <div class="mushaf-page-footer">
      <span class="mushaf-page-footer__ornament" aria-hidden="true">۝</span>
      <span class="mushaf-page-footer__number" lang="ar" dir="rtl">${toArabicDigits(pageNumber)}</span>
      <span class="mushaf-page-footer__ornament" aria-hidden="true">۝</span>
    </div>
  `;
}

/** "Juz 3" or "Juz 3–4" when the page crosses a Juz boundary — read straight off the ayah data, never computed/guessed. */
function juzLabelForPage(page) {
  const first = page.ayahs[0]?.juz;
  const last = page.ayahs[page.ayahs.length - 1]?.juz;
  if (!first) return "";
  return first === last ? `Juz ${first}` : `Juz ${first}–${last}`;
}

/** Collapsible per-ayah strip: translation (already in memory — no extra fetch) + tafsir + bookmark. */
function renderAyahDetailPanel(ayahNumber, translationText) {
  return `
    <div class="reading-ayah-detail" id="ayah-detail-${ayahNumber}" hidden>
      <div class="reading-ayah-detail__translation">${escapeHtml(translationText)}</div>
      <div class="reading-ayah-detail__actions">
        <button type="button" class="ayah-btn reading-tafsir-toggle" aria-expanded="false">
          <span class="material-symbols-rounded icon icon--sm" aria-hidden="true">auto_stories</span> Tafsir
        </button>
        <button type="button" class="ayah-btn reading-bookmark-toggle" aria-label="Bookmark ayah ${ayahNumber}">
          <span class="material-symbols-rounded icon icon--sm" aria-hidden="true">bookmark</span>
        </button>
      </div>
      <div class="reading-ayah-detail__tafsir" hidden></div>
    </div>
  `;
}

/** Bottom toolbar: Play, Auto-scroll, Repeat — matching the reference's 4-icon bar. */
function renderBottomToolbar() {
  return `
    <div class="reading-bottom-toolbar">
      <button type="button" id="reading-contents-btn" class="reading-toolbar-btn">
        <span class="material-symbols-rounded icon" aria-hidden="true">menu_book</span>
        <span class="reading-toolbar-btn__label">Contents</span>
      </button>
      <button type="button" id="reading-play-btn" class="reading-toolbar-btn">
        <span class="material-symbols-rounded icon" aria-hidden="true">play_arrow</span>
        <span class="reading-toolbar-btn__label">Play</span>
      </button>
      <button type="button" id="autoscroll-btn" class="reading-toolbar-btn">
        <span class="material-symbols-rounded icon" aria-hidden="true">swipe_vertical</span>
        <span class="reading-toolbar-btn__label">Auto-Scroll</span>
      </button>
      <button type="button" id="repeat-btn" class="reading-toolbar-btn">
        <span class="material-symbols-rounded icon" aria-hidden="true">repeat</span>
        <span class="reading-toolbar-btn__label">Repeat</span>
      </button>
    </div>
  `;
}

// ----------------------------------------------------------------------------
// Interactivity
// ----------------------------------------------------------------------------

function toggleAyahDetail(cardEl, page, surahNumber, ayahNumber) {
  const panelId = `ayah-detail-${surahNumber}-${ayahNumber}`;
  let panel = cardEl.querySelector(`#${panelId}`);
  const numEl = cardEl.querySelector(`.reading-ayah-num[data-surah="${surahNumber}"][data-ayah="${ayahNumber}"]`);

  cardEl.querySelectorAll(".reading-ayah-detail:not([hidden])").forEach((open) => {
    if (open.id !== panelId) open.hidden = true;
  });

  if (!panel) {
    const surah = page.details.get(Number(surahNumber));
    const ayah = surah?.ayahs.find((a) => a.numberInSurah === Number(ayahNumber));
    const wrapper = document.createElement("div");
    wrapper.innerHTML = renderAyahDetailPanel(ayahNumber, ayah?.translation ?? "Translation unavailable.");
    panel = wrapper.firstElementChild;
    panel.id = panelId;
    numEl.insertAdjacentElement("afterend", panel);
    wireAyahDetailPanel(panel, Number(surahNumber), Number(ayahNumber));
    initBookmarkState(panel, Number(surahNumber), Number(ayahNumber));
  }

  panel.hidden = !panel.hidden;
}

function wireAyahDetailPanel(panel, surahNumber, ayahNumber) {
  const tafsirBtn = panel.querySelector(".reading-tafsir-toggle");
  const tafsirPanel = panel.querySelector(".reading-ayah-detail__tafsir");

  tafsirBtn.addEventListener("click", async () => {
    const expanded = tafsirBtn.getAttribute("aria-expanded") === "true";
    if (expanded) {
      tafsirPanel.hidden = true;
      tafsirBtn.setAttribute("aria-expanded", "false");
      return;
    }
    tafsirBtn.setAttribute("aria-expanded", "true");
    tafsirPanel.hidden = false;
    if (!tafsirPanel.dataset.loaded) {
      tafsirPanel.textContent = "Loading tafsir…";
      try {
        const text = await fetchAyahTafsir(surahNumber, ayahNumber);
        tafsirPanel.textContent = text;
        tafsirPanel.dataset.loaded = "true";
      } catch (error) {
        console.error("[TAZAWWUD] Tafsir fetch failed:", error);
        tafsirPanel.textContent = "Tafsir unavailable for this ayah right now.";
      }
    }
  });

  const bookmarkBtn = panel.querySelector(".reading-bookmark-toggle");
  bookmarkBtn.addEventListener("click", async () => {
    bookmarkBtn.disabled = true;
    try {
      const isNowBookmarked = await toggleBookmark(surahNumber, ayahNumber);
      if (isNowBookmarked !== null) {
        bookmarkBtn.classList.toggle("is-active", isNowBookmarked);
      }
    } catch (error) {
      console.error("[TAZAWWUD] Bookmark toggle failed:", error);
    } finally {
      bookmarkBtn.disabled = false;
    }
  });
}

async function initBookmarkState(panel, surahNumber, ayahNumber) {
  try {
    const marked = await getBookmarksForSurah(surahNumber);
    if (marked.has(ayahNumber)) {
      panel.querySelector(".reading-bookmark-toggle")?.classList.add("is-active");
    }
  } catch (error) {
    console.error("[TAZAWWUD] Failed to check bookmark state:", error);
  }
}

function wireAyahTaps(cardEl, page) {
  cardEl.querySelectorAll(".reading-ayah, .reading-ayah-num").forEach((el) => {
    el.addEventListener("click", () => toggleAyahDetail(cardEl, page, el.dataset.surah, el.dataset.ayah));
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggleAyahDetail(cardEl, page, el.dataset.surah, el.dataset.ayah);
      }
    });
  });
}

/**
 * A monotonically-increasing token identifying the current playback
 * "session". Every play attempt captures the token at that moment; audio
 * event handlers check it before acting, so a handler left over from an
 * earlier, since-abandoned play attempt (e.g. paused before "playing"
 * fired) becomes a harmless no-op instead of corrupting a later session's
 * button state or spuriously starting auto-scroll.
 */
let playbackToken = 0;

/** Play/Pause the whole Surah's audio (one MP3Quran file), with Repeat support. */
function wirePlayButton(container, surahNumber) {
  const audioEl = document.getElementById("quran-audio-player");
  const playBtn = container.querySelector("#reading-play-btn");
  const icon = playBtn.querySelector(".material-symbols-rounded");
  const label = playBtn.querySelector(".reading-toolbar-btn__label");

  function setState(iconName, labelText) {
    icon.textContent = iconName;
    label.textContent = labelText;
  }

  playBtn.addEventListener("click", () => {
    const reciter = getReciter(getCurrentReciterId());
    const url = buildSurahAudioUrl(reciter, surahNumber);
    // Source of truth is the actual <audio> element, not a separately
    // tracked string — this stays correct even if the reciter changed
    // since the last play action.
    const isThisPlaying = !audioEl.paused && audioEl.src === url;

    if (isThisPlaying) {
      audioEl.pause();
      setState("play_arrow", "Play");
      stopAutoScroll();
      return;
    }

    const myToken = ++playbackToken; // invalidates any still-pending listeners from before

    setState("progress_activity", "Loading…");
    audioEl.loop = repeatActive;

    const onPlaying = () => {
      if (myToken !== playbackToken) return;
      setState("pause", "Playing…");
      if (autoScrollActive) startAutoScroll(container, audioEl);
    };
    const onEnded = () => {
      if (myToken !== playbackToken) return;
      setState("play_arrow", "Play");
      stopAutoScroll();
    };
    const onError = () => {
      if (myToken !== playbackToken) return;
      console.error("[TAZAWWUD] Surah audio failed to load:", url);
      setState("error", "Unavailable");
      stopAutoScroll();
    };

    audioEl.addEventListener("playing", onPlaying, { once: true });
    audioEl.addEventListener("ended", onEnded, { once: true });
    audioEl.addEventListener("error", onError, { once: true });

    audioEl.src = url;
    audioEl.play().catch((err) => {
      console.error("[TAZAWWUD] Audio playback failed:", err);
      onError();
    });
  });
}

/**
 * Auto-scroll: since MP3Quran's Surah-length files carry no per-ayah
 * timestamps, this can't sync to the exact ayah being recited. What it
 * DOES do honestly: scroll the page smoothly at a constant rate timed to
 * the audio's total duration, so by the time the recitation ends the
 * reader has scrolled through the whole Surah. Approximate, not
 * word-accurate — flagged here rather than implied to be more than it is.
 */
function startAutoScroll(container, audioEl) {
  const scrollEl = container.querySelector(".reading-card");
  if (!scrollEl || !audioEl.duration) return;

  function step() {
    if (audioEl.paused || audioEl.ended) {
      autoScrollRAF = null;
      return;
    }
    const progress = audioEl.currentTime / audioEl.duration;
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    const cardTop = scrollEl.getBoundingClientRect().top + window.scrollY;
    const cardHeight = scrollEl.offsetHeight;
    const targetScroll = Math.min(cardTop + cardHeight * progress - 200, maxScroll);
    window.scrollTo({ top: Math.max(targetScroll, 0), behavior: "auto" });
    autoScrollRAF = requestAnimationFrame(step);
  }
  autoScrollRAF = requestAnimationFrame(step);
}

function stopAutoScroll() {
  if (autoScrollRAF) {
    cancelAnimationFrame(autoScrollRAF);
    autoScrollRAF = null;
  }
}

function wireAutoScrollAndRepeat(container) {
  const autoScrollBtn = container.querySelector("#autoscroll-btn");
  const repeatBtn = container.querySelector("#repeat-btn");
  const audioEl = document.getElementById("quran-audio-player");

  autoScrollBtn?.addEventListener("click", () => {
    autoScrollActive = !autoScrollActive;
    autoScrollBtn.classList.toggle("is-active", autoScrollActive);
    if (!autoScrollActive) stopAutoScroll();
  });

  repeatBtn?.addEventListener("click", () => {
    repeatActive = !repeatActive;
    repeatBtn.classList.toggle("is-active", repeatActive);
    audioEl.loop = repeatActive;
  });
}

/** Go to a Surah and Ayah: finds the ayah's page, shows it and scrolls to the ayah. */
function wireGoto(container) {
  const form = container.querySelector("#reading-goto-form");
  if (!form) return;
  const message = container.querySelector("#goto-message");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const surah = Number(container.querySelector("#goto-surah").value);
    const ayah = Number(container.querySelector("#goto-ayah").value);
    const surahError = validateJump(surah, ayah, null);
    if (surahError) {
      message.textContent = surahError;
      return;
    }
    message.textContent = "Finding the ayah…";
    try {
      const detail = await fetchSurahDetail(surah, getCurrentTranslationCode());
      const error = validateJump(surah, ayah, detail.numberOfAyahs);
      if (error) {
        message.textContent = error;
        return;
      }
      const page = pageForAyah(detail, ayah);
      if (!page) {
        message.textContent = "That ayah could not be found.";
        return;
      }
      await renderPage(container, page);
      container.querySelector(`.reading-ayah[data-surah="${surah}"][data-ayah="${ayah}"]`)
        ?.scrollIntoView({ block: "center" });
    } catch (error) {
      console.error("[TAZAWWUD] Go to ayah failed:", error);
      message.textContent = "Could not open that ayah. Check your connection, then try again.";
    }
  });
}

/** Contents: opens the Surah list. */
function wireContents(container) {
  container.querySelector("#reading-contents-btn")?.addEventListener("click", () => {
    window.location.hash = "#quran";
  });
}

function wireTopBarNav(container, pageNumber) {
  container.querySelector("#prev-page-btn")?.addEventListener("click", () => {
    if (pageNumber > 1) renderPage(container, pageNumber - 1);
  });
  container.querySelector("#next-page-btn")?.addEventListener("click", () => {
    if (pageNumber < PAGE_COUNT) renderPage(container, pageNumber + 1);
  });
  container.querySelector("#reading-reciter-select")?.addEventListener("change", (e) => {
    setCurrentReciterId(e.target.value);
  });
  container.querySelector("#reading-translation-select")?.addEventListener("change", (e) => {
    setCurrentTranslationCode(e.target.value);
    renderPage(container, pageNumber);
  });
}

function wireSwipeGestures(container, surah) {
  let touchStartX = null;
  container.addEventListener("touchstart", (e) => { touchStartX = e.changedTouches[0].screenX; }, { passive: true });
  container.addEventListener("touchend", (e) => {
    if (touchStartX === null) return;
    const dx = e.changedTouches[0].screenX - touchStartX;
    if (Math.abs(dx) > 70) {
      if (dx < 0 && surah.number < PAGE_COUNT) renderPage(container, surah.number + 1);
      else if (dx > 0 && surah.number > 1) renderPage(container, surah.number - 1);
    }
    touchStartX = null;
  }, { passive: true });
}

// ----------------------------------------------------------------------------
// Public entry points
// ----------------------------------------------------------------------------

/**
 * Renders one Surah as continuous flowing text (the primary reading view).
 * @param {HTMLElement} container the view's root element
 * @param {number} surahNumber 1-114
 * @param {string} [translationCode] overrides the currently-selected translation
 */
export async function renderSurah(container, surahNumber, translationCode) {
  if (!container) return;
  if (translationCode) setCurrentTranslationCode(translationCode);
  container.setAttribute("aria-busy", "true");
  container.innerHTML = renderSkeleton();

  try {
    const surah = await fetchSurahDetail(surahNumber, getCurrentTranslationCode());
    const firstAyahPage = surah.ayahs[0]?.page;
    if (!firstAyahPage) throw new Error(`No canonical page found for Surah ${surahNumber}`);
    return renderPage(container, firstAyahPage);
  } catch (error) {
    console.error(`[TAZAWWUD] Failed to locate Surah ${surahNumber}:`, error);
    container.setAttribute("aria-busy", "false");
    renderErrorState(container, () => renderSurah(container, surahNumber, translationCode));
  }
}

async function renderPage(container, pageNumber) {
  if (!container) return;

  stopReadingAudio(); // never leave a previous Surah's audio playing under new text

  container.setAttribute("aria-busy", "true");
  container.innerHTML = renderSkeleton();

  try {
    const page = await fetchPage(pageNumber, getCurrentTranslationCode());

    container.innerHTML = `
      ${renderReadingTopBar(page.number, juzLabelForPage(page))}
      <form id="reading-goto-form" class="reading-goto" autocomplete="off">
        <label>Surah <input id="goto-surah" type="number" min="1" max="114" inputmode="numeric" required /></label>
        <label>Ayah <input id="goto-ayah" type="number" min="1" inputmode="numeric" required /></label>
        <button type="submit" class="reading-goto__btn">Go</button>
        <p id="goto-message" class="reading-goto__message" role="status"></p>
      </form>
      <div class="reading-card mushaf-page">
        ${renderPageSegments(page)}
        ${renderMushafFooter(page.number)}
      </div>
      ${renderBottomToolbar()}
    `;
    container.setAttribute("aria-busy", "false");
    container.dataset.currentPage = String(page.number);
    // Real bug fix: app.js's "Switch to Verses" cross-link reads
    // dataset.currentSurah to know which Surah's Verse View to open. This
    // was never set, so it always fell back to Surah 1 (Al-Fatihah) no
    // matter which page/Surah was actually open in the Mushaf.
    container.dataset.currentSurah = String(page.ayahs[0]?.surah.number || 1);

    if (page.source && page.source !== "network") {
      renderFallbackNotice(container, "Showing a previously loaded copy of this page until the connection is back.");
    }

    const cardEl = container.querySelector(".reading-card");
    wireAyahTaps(cardEl, page);
    wireTopBarNav(container, page.number);
    wireGoto(container);
    wireContents(container);
    wirePlayButton(container, page.ayahs[0]?.surah.number || 1);
    wireAutoScrollAndRepeat(container);
    wireSwipeGestures(container, {
      number: page.number,
      ayahs: [],
    });

    recordLastRead(page.ayahs[0]?.surah.number || 1);
  } catch (error) {
    console.error(`[TAZAWWUD] Failed to load Mushaf page ${pageNumber}:`, error);
    container.setAttribute("aria-busy", "false");
    renderErrorState(container, () => renderPage(container, pageNumber));
  }
}

/** Opens a specific Surah — a direct render, no lookup network call needed. */
export function openSurahInMushaf(container, surahNumber) {
  return renderSurah(container, surahNumber);
}

/** Resumes the last-read Surah (or Al-Fatihah if none recorded yet). */
export async function resumeReading(container) {
  const surahNumber = await resolveStartingSurah();
  return renderSurah(container, surahNumber);
}

/** Stops any in-progress audio and auto-scroll — call when navigating away. */
export function stopReadingAudio() {
  playbackToken++; // invalidate any pending 'playing'/'ended'/'error' listeners
  stopAutoScroll();
  const audioEl = document.getElementById("quran-audio-player");
  if (audioEl) {
    audioEl.pause();
    audioEl.removeAttribute("src");
  }
}
