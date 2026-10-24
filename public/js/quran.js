// ============================================================================
// TAZAWWUD — Qur'an Module
// ----------------------------------------------------------------------------
// Free data sources, no keys, no paid tiers:
//   - AlQuran.cloud REST API      -> Surah list, Arabic text, translations
//   - MP3Quran.net                -> Per-SURAH recitation audio, 17 reciters
//   - spa5k/tafsir_api (jsDelivr) -> Per-ayah tafsir (static JSON, CDN-hosted)
//
// Phase 4, Part 1: Surah list
// Phase 4, Part 2: Surah reader (Arabic + translation + audio)
// Phase 4, Part 3: multiple translation languages, per-ayah tafsir,
//                  bookmarks persisted to Firebase (see bookmarks.js)
// Phase 5:         reciter selection, loading/error states on audio
// Phase 5 (revised): ALL reciters moved to MP3Quran.net per-Surah audio
//                  (previously 16 were per-ayah via EveryAyah.com, 1 via
//                  MP3Quran). Per-Surah is what MP3Quran's official API
//                  actually offers — one MP3 per Surah, not per ayah — so
//                  every reciter is now handled the same way: no bulk
//                  download, no hardcoded 114-URL lists, just a formula
//                  (server + zero-padded Surah number) computed client-side.
// ============================================================================

import { toggleBookmark, getBookmarksForSurah } from "./bookmarks.js";
import { fetchJsonWithFallback } from "./error-boundary.js";
import { loadLocalQuran, localArabic } from "./quran-local.js";
import { escapeHtml } from "./html-utils.js";

const API_BASE = "https://api.alquran.cloud/v1";
const SURAH_LIST_ENDPOINT = `${API_BASE}/surah`;

const TAFSIR_BASE = "https://cdn.jsdelivr.net/gh/spa5k/tafsir_api@main/tafsir";
const TAFSIR_EDITION = "en-tafisr-ibn-kathir"; // English, Ibn Kathir (abridged)

/**
 * Reciters — all per-Surah audio via MP3Quran.net's official API
 * (https://mp3quran.net/api/v3/reciters). Each `server` value was read
 * directly from that API's own "server" field (the officially intended
 * streaming path), NOT the page's "/download/…" links, which set a
 * Content-Disposition header meant for the download button instead.
 *
 * One exception: Ali Al-Hudhaify's server value was derived rather than
 * read directly from an API response — his page (mp3quran.net/ar/hthfi)
 * was scraped to confirm the "hthfi" slug and "server9" host, and the
 * `/download/` → streaming path conversion was confirmed identical for
 * two other reciters (Alafasy, Badr Al-Turki) checked both ways. If this
 * one specific URL is ever wrong, it'll show this reciter's normal
 * audio-error state rather than break anything else.
 *
 * URL formula: `${server}${surahNumber, zero-padded to 3 digits}.mp3`
 */
const RECITERS = [
  { id: "alafasy", label: "Mishary Alafasy", server: "https://server8.mp3quran.net/afs/" },
  { id: "abdulbasit-murattal", label: "Abdul Basit (Murattal)", server: "https://server7.mp3quran.net/basit/" },
  { id: "abdulbasit-mujawwad", label: "Abdul Basit (Mujawwad)", server: "https://server7.mp3quran.net/basit/Almusshaf-Al-Mojawwad/" },
  { id: "husary", label: "Mahmoud Al-Husary", server: "https://server13.mp3quran.net/husr/" },
  { id: "husary-mujawwad", label: "Al-Husary (Mujawwad)", server: "https://server13.mp3quran.net/husr/Almusshaf-Al-Mojawwad/" },
  { id: "hudhaify", label: "Ali Al-Hudhaify", server: "https://server9.mp3quran.net/hthfi/" },
  { id: "sudais", label: "Abdur-Rahman As-Sudais", server: "https://server11.mp3quran.net/sds/" },
  { id: "shuraim", label: "Saud Al-Shuraim", server: "https://server7.mp3quran.net/shur/" },
  { id: "mahermuaiqly", label: "Maher Al-Muaiqly", server: "https://server12.mp3quran.net/maher/" },
  { id: "shatri", label: "Abu Bakr Al-Shatri", server: "https://server11.mp3quran.net/shatri/" },
  { id: "basfar", label: "Abdullah Basfar", server: "https://server6.mp3quran.net/bsfr/" },
  { id: "ghamdi", label: "Saad Al-Ghamdi", server: "https://server7.mp3quran.net/s_gmd/" },
  { id: "minshawi-mujawwad", label: "Al-Minshawi (Mujawwad)", server: "https://server10.mp3quran.net/minsh/Almusshaf-Al-Mojawwad/" },
  { id: "minshawi-murattal", label: "Al-Minshawi (Murattal)", server: "https://server10.mp3quran.net/minsh/" },
  { id: "jibreel", label: "Muhammad Jibreel", server: "https://server8.mp3quran.net/jbrl/" },
  { id: "ayyoub", label: "Muhammad Ayyoub", server: "https://server8.mp3quran.net/ayyub/" },
  { id: "badralturki", label: "Badr Al-Turki", server: "https://server10.mp3quran.net/bader/Rewayat-Hafs-A-n-Assem/" },
];
const RECITER_STORAGE_KEY = "tazawwud:reciter";

let currentReciterId =
  localStorage.getItem(RECITER_STORAGE_KEY) || RECITERS[0].id;

function getReciter(reciterId) {
  return RECITERS.find((r) => r.id === reciterId) || RECITERS[0];
}

/** Builds the full-Surah MP3 URL for a reciter — pure formula, no fetch needed. */
function buildSurahAudioUrl(reciter, surahNumber) {
  const s = String(surahNumber).padStart(3, "0");
  return `${reciter.server}${s}.mp3`;
}

/** Available translation editions the reader can switch between. */
const TRANSLATION_EDITIONS = [
  { code: "en.asad", label: "English — Asad" },
  { code: "en.sahih", label: "English — Saheeh International" },
  { code: "en.pickthall", label: "English — Pickthall" },
  { code: "ur.jalandhry", label: "Urdu — Jalandhry" },
  { code: "fr.hamidullah", label: "French — Hamidullah" },
  { code: "id.indonesian", label: "Indonesian — Kemenag" },
];
const TRANSLATION_STORAGE_KEY = "tazawwud:translation";

let currentTranslationCode =
  localStorage.getItem(TRANSLATION_STORAGE_KEY) || TRANSLATION_EDITIONS[0].code;

/** In-memory caches so re-opening a tab/Surah/tafsir doesn't re-fetch. */
let cachedSurahs = null;
const cachedSurahDetails = new Map(); // key: `${number}:${translationCode}`
const cachedTafsirs = new Map(); // key: `${surah}:${ayah}`

// ----------------------------------------------------------------------------
// Shared-state exports (Phase 5 revision: reused by mushaf.js so the Mushaf
// page view and the Surah list/reader share the exact same reciter and
// translation selection — one source of truth, no drift between views).
// ----------------------------------------------------------------------------
export { RECITERS, TRANSLATION_EDITIONS, getReciter, buildSurahAudioUrl };

export function getCurrentReciterId() {
  return currentReciterId;
}
export function setCurrentReciterId(reciterId) {
  currentReciterId = reciterId;
  localStorage.setItem(RECITER_STORAGE_KEY, reciterId);
}
export function getCurrentTranslationCode() {
  return currentTranslationCode;
}
export function setCurrentTranslationCode(code) {
  currentTranslationCode = code;
  localStorage.setItem(TRANSLATION_STORAGE_KEY, code);
}
export { fetchAyahTafsir };
export { playSurahToggle };
export { fetchSurahDetail };

/** Returns the cached Surah list (null until the Surah List view has loaded once). */
export function getCachedSurahList() {
  return cachedSurahs;
}

/** Surahs recited WITHOUT an opening Bismillah banner (see explanation below). */
const NO_BISMILLAH_BANNER = new Set([1, 9]);
const BISMILLAH_PREFIX = /^\uFEFF?بِسْمِ\s+ٱ?للَّهِ\s+ٱ?لرَّحْمَٰنِ\s+ٱ?لرَّحِيمِ\s*/;

function normalizeAyahText(text, surahNumber, numberInSurah) {
  if (numberInSurah !== 1 || NO_BISMILLAH_BANNER.has(surahNumber)) return text;
  return String(text).replace(BISMILLAH_PREFIX, "");
}

// ----------------------------------------------------------------------------
// Data fetching
// ----------------------------------------------------------------------------

/** Fetches the list of all 114 Surahs (metadata only). */
export async function fetchSurahList() {
  if (cachedSurahs) return cachedSurahs;

  const result = await fetchJsonWithFallback(SURAH_LIST_ENDPOINT, {
    cacheKey: "quran:surah-index",
    persistent: true,
    validate: (payload) => payload?.code === 200 && Array.isArray(payload.data),
  });
  cachedSurahs = result.data.data;
  return cachedSurahs;
}

/**
 * Fetches Arabic text + translation for one Surah. Audio isn't fetched here —
 * MP3Quran URLs are computed on the fly from the selected reciter.
 * @param {number} number Surah number, 1-114
 * @param {string} translationCode e.g. "en.asad"
 */
async function fetchSurahDetail(number, translationCode) {
  const cacheKey = `${number}:${translationCode}`;
  if (cachedSurahDetails.has(cacheKey)) {
    return cachedSurahDetails.get(cacheKey);
  }

  // The bundled Tanzil text is used for the Arabic when it has loaded; the API is the fallback.
  await loadLocalQuran();
  const editions = `quran-uthmani,${translationCode}`;
  const result = await fetchJsonWithFallback(`${API_BASE}/surah/${number}/editions/${editions}`, {
    cacheKey: `quran:surah:${number}:${translationCode}`,
    persistent: true,
    validate: (payload) => payload?.code === 200 && Array.isArray(payload.data) && payload.data.length === 2,
  });
  const payload = result.data;

  const [arabicEdition, translationEdition] = payload.data;

  const detail = {
    number: arabicEdition.number,
    name: arabicEdition.name,
    englishName: arabicEdition.englishName,
    englishNameTranslation: arabicEdition.englishNameTranslation,
    revelationType: arabicEdition.revelationType,
    numberOfAyahs: arabicEdition.numberOfAyahs,
    ayahs: arabicEdition.ayahs.map((ayah, i) => ({
      numberInSurah: ayah.numberInSurah,
      globalNumber: ayah.number,
      page: ayah.page,
      juz: ayah.juz,
      arabic: localArabic(number, ayah.numberInSurah) ?? normalizeAyahText(ayah.text, number, ayah.numberInSurah),
      translation: translationEdition.ayahs[i]?.text ?? "",
    })),
  };

  cachedSurahDetails.set(cacheKey, detail);
  return detail;
}

/**
 * Fetches tafsir (commentary) for a single ayah. The API's exact field name
 * for the commentary text isn't formally documented, so this reads whichever
 * of the common keys is present rather than assuming one.
 */
async function fetchAyahTafsir(surahNumber, ayahNumber) {
  const cacheKey = `${surahNumber}:${ayahNumber}`;
  if (cachedTafsirs.has(cacheKey)) return cachedTafsirs.get(cacheKey);

  const result = await fetchJsonWithFallback(`${TAFSIR_BASE}/${TAFSIR_EDITION}/${surahNumber}/${ayahNumber}.json`, {
    cacheKey: `tafsir:${surahNumber}:${ayahNumber}`,
    persistent: true,
    validate: (payload) => Boolean(payload),
  });
  let payload = result.data;
  if (Array.isArray(payload)) payload = payload[0];

  const text =
    payload?.text || payload?.tafsir || payload?.content || "Tafsir text unavailable for this ayah.";

  cachedTafsirs.set(cacheKey, text);
  return text;
}

// ----------------------------------------------------------------------------
// Surah List — rendering
// ----------------------------------------------------------------------------

function renderSurahCard(surah) {
  const isMeccan = surah.revelationType === "Meccan";
  const badgeClass = isMeccan ? "revelation-badge--meccan" : "revelation-badge--medinan";
  const revelationIcon = isMeccan ? "mosque" : "location_city";

  return `
    <li class="surah-card" data-surah-number="${surah.number}" data-dl-surah="${surah.number}" data-surah-name="${escapeHtml(surah.englishName.toLowerCase())}" tabindex="0" role="button" aria-label="Open Surah ${escapeHtml(surah.englishName)}">
      <span class="surah-card__index">${surah.number}</span>

      <div class="surah-card__body">
        <div class="surah-card__names">
          <span class="surah-card__name-en">${escapeHtml(surah.englishName)}</span>
          <span class="surah-card__name-ar" lang="ar" dir="rtl">${escapeHtml(surah.name)}</span>
        </div>
        <span class="surah-card__translation">${escapeHtml(surah.englishNameTranslation)}</span>

        <div class="surah-card__meta">
          <span class="surah-card__ayah-count">
            <span class="material-symbols-rounded icon icon--sm" aria-hidden="true">menu_book</span>
            ${surah.numberOfAyahs} Ayahs
          </span>
          <span class="revelation-badge ${badgeClass}">
            <span class="material-symbols-rounded icon icon--sm" aria-hidden="true">${revelationIcon}</span>
            ${surah.revelationType}
          </span>
        </div>
      </div>

      <span class="material-symbols-rounded icon surah-card__chevron" aria-hidden="true">chevron_right</span>
    </li>
  `;
}

function renderSkeletonCards(count = 8) {
  return Array.from({ length: count })
    .map(
      () => `
        <li class="surah-card surah-card--skeleton" aria-hidden="true">
          <span class="surah-card__index skeleton-block"></span>
          <div class="surah-card__body">
            <div class="skeleton-block skeleton-block--line-lg"></div>
            <div class="skeleton-block skeleton-block--line-sm"></div>
          </div>
        </li>
      `
    )
    .join("");
}

function renderListErrorState(container, onRetry) {
  container.innerHTML = `
    <li class="state-message state-message--error">
      <span class="material-symbols-rounded icon icon--lg" aria-hidden="true">error</span>
      <p>Couldn't load the Surah list. Please check your connection and try again.</p>
      <button type="button" class="btn-retry">Retry</button>
    </li>
  `;
  container.querySelector(".btn-retry")?.addEventListener("click", onRetry);
}

function initSurahSearch(listContainer) {
  const input = document.getElementById("surah-search-input");
  if (!input || input.dataset.wired) return;
  input.dataset.wired = "true";

  input.addEventListener("input", () => {
    const query = input.value.trim().toLowerCase();
    const cards = listContainer.querySelectorAll(".surah-card:not(.surah-card--skeleton)");

    cards.forEach((card) => {
      const name = card.dataset.surahName || "";
      const number = card.dataset.surahNumber || "";
      const matches = name.includes(query) || number === query || query === "";
      card.hidden = !matches;
    });
  });
}

/**
 * Public entry point: mounts the Surah list into the given container.
 * @param {HTMLElement} container the <ul id="surah-list">
 * @param {(surahNumber: number) => void} onOpenSurah called when a card is tapped
 */
export async function initSurahList(container, onOpenSurah) {
  if (!container) return;

  container.setAttribute("aria-busy", "true");
  container.innerHTML = renderSkeletonCards();

  try {
    const surahs = await fetchSurahList();
    container.innerHTML = surahs.map(renderSurahCard).join("");
    container.setAttribute("aria-busy", "false");
    initSurahSearch(container);

    if (!container.dataset.clickWired) {
      container.dataset.clickWired = "true";
      container.addEventListener("click", (event) => {
        const card = event.target.closest(".surah-card");
        if (card && typeof onOpenSurah === "function") {
          onOpenSurah(Number(card.dataset.surahNumber));
        }
      });
      container.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        const card = event.target.closest(".surah-card");
        if (card && typeof onOpenSurah === "function") {
          event.preventDefault();
          onOpenSurah(Number(card.dataset.surahNumber));
        }
      });
    }
  } catch (error) {
    console.error("[TAZAWWUD] Failed to load Surah list:", error);
    container.setAttribute("aria-busy", "false");
    renderListErrorState(container, () => initSurahList(container, onOpenSurah));
  }
}

// ----------------------------------------------------------------------------
// Surah Reader — rendering
// ----------------------------------------------------------------------------

const BISMILLAH_TEXT = "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ";

function renderReaderSkeleton() {
  const ayahSkeletons = Array.from({ length: 5 })
    .map(
      () => `
        <div class="ayah-block ayah-block--skeleton" aria-hidden="true">
          <div class="skeleton-block skeleton-block--line-lg" style="width: 90%; height: 28px;"></div>
          <div class="skeleton-block skeleton-block--line-sm" style="width: 60%;"></div>
        </div>
      `
    )
    .join("");

  return `
    <div class="reader-header reader-header--skeleton">
      <div class="skeleton-block skeleton-block--line-lg" style="width: 50%; height: 24px;"></div>
      <div class="skeleton-block skeleton-block--line-sm" style="width: 30%;"></div>
    </div>
    ${ayahSkeletons}
  `;
}

function renderTranslationSelect() {
  const options = TRANSLATION_EDITIONS.map(
    (t) => `<option value="${t.code}" ${t.code === currentTranslationCode ? "selected" : ""}>${t.label}</option>`
  ).join("");

  return `
    <label class="select-pill">
      <span class="material-symbols-rounded icon icon--sm" aria-hidden="true">translate</span>
      <select id="translation-select">${options}</select>
    </label>
  `;
}

function renderReciterSelect() {
  const options = RECITERS.map(
    (r) => `<option value="${r.id}" ${r.id === currentReciterId ? "selected" : ""}>${r.label}</option>`
  ).join("");

  return `
    <label class="select-pill">
      <span class="material-symbols-rounded icon icon--sm" aria-hidden="true">record_voice_over</span>
      <select id="reciter-select">${options}</select>
    </label>
  `;
}

function renderReaderHeader(surah) {
  const isMeccan = surah.revelationType === "Meccan";
  const badgeClass = isMeccan ? "revelation-badge--meccan" : "revelation-badge--medinan";

  return `
    <div class="reader-header">
      <div class="reader-header__names">
        <h2 class="reader-header__name-en">${surah.number}. ${escapeHtml(surah.englishName)}</h2>
        <span class="reader-header__name-ar" lang="ar" dir="rtl">${escapeHtml(surah.name)}</span>
      </div>
      <p class="reader-header__translation">${escapeHtml(surah.englishNameTranslation)}</p>

      <div class="reader-header__meta">
        <span class="surah-card__ayah-count">
          <span class="material-symbols-rounded icon icon--sm" aria-hidden="true">menu_book</span>
          ${surah.numberOfAyahs} Ayahs
        </span>
        <span class="revelation-badge ${badgeClass}">${surah.revelationType}</span>
      </div>

      <div class="reader-header__actions">
        <button type="button" id="play-surah-btn" class="btn-play-surah">
          <span class="material-symbols-rounded icon" aria-hidden="true">play_arrow</span>
          <span class="btn-play-surah__label">Play Surah</span>
        </button>
        ${renderReciterSelect()}
        ${renderTranslationSelect()}
      </div>

      <p class="reader-note">Audio plays the full Surah in one recitation — tap Play Surah above.</p>
    </div>

    ${
      !NO_BISMILLAH_BANNER.has(surah.number)
        ? `<p class="bismillah-banner" lang="ar" dir="rtl">${BISMILLAH_TEXT}</p>`
        : ""
    }
  `;
}

function renderAyahBlock(ayah) {
  return `
    <div class="ayah-block" id="ayah-${ayah.numberInSurah}">
      <div class="ayah-block__top">
        <span class="ayah-block__number">${ayah.numberInSurah}</span>
        <div class="ayah-block__controls">
          <button type="button" class="ayah-btn ayah-tafsir-btn" aria-label="Show tafsir for ayah ${ayah.numberInSurah}" aria-expanded="false">
            <span class="material-symbols-rounded icon icon--sm" aria-hidden="true">auto_stories</span>
          </button>
          <button type="button" class="ayah-btn ayah-bookmark-btn" aria-label="Bookmark ayah ${ayah.numberInSurah}">
            <span class="material-symbols-rounded icon icon--sm" aria-hidden="true">bookmark</span>
          </button>
        </div>
      </div>
      <p class="ayah-block__arabic" lang="ar" dir="rtl">${escapeHtml(ayah.arabic)}</p>
      <p class="ayah-block__translation">${escapeHtml(ayah.translation)}</p>
      <div class="ayah-block__tafsir" hidden></div>
    </div>
  `;
}

function renderReaderErrorState(container, onRetry) {
  container.innerHTML = `
    <div class="state-message state-message--error">
      <span class="material-symbols-rounded icon icon--lg" aria-hidden="true">error</span>
      <p>Couldn't load this Surah. Please check your connection and try again.</p>
      <button type="button" class="btn-retry">Retry</button>
    </div>
  `;
  container.querySelector(".btn-retry")?.addEventListener("click", onRetry);
}

// ----------------------------------------------------------------------------
// Reader interactivity: audio, tafsir toggles, bookmarks, translation/reciter
// ----------------------------------------------------------------------------

/**
 * Plays/pauses the single full-Surah MP3 for the current reciter. Manages
 * the Play-Surah button's icon/label directly (loading spinner while
 * buffering, pause icon while playing, error icon if the file 404s).
 */
function playSurahToggle(audioEl, url, button) {
  const icon = button.querySelector(".material-symbols-rounded");
  const label = button.querySelector(".btn-play-surah__label");

  const isThisAlreadyPlaying = button.dataset.playingUrl === url && !audioEl.paused;
  if (isThisAlreadyPlaying) {
    audioEl.pause();
    icon.textContent = "play_arrow";
    label.textContent = "Play Surah";
    return;
  }

  button.dataset.playingUrl = url;
  button.classList.add("is-buffering");
  icon.textContent = "progress_activity";
  label.textContent = "Loading…";

  const cleanup = () => {
    audioEl.removeEventListener("waiting", onWaiting);
    audioEl.removeEventListener("playing", onPlaying);
    audioEl.removeEventListener("ended", onEnded);
    audioEl.removeEventListener("error", onError);
  };
  const onWaiting = () => {
    button.classList.add("is-buffering");
    icon.textContent = "progress_activity";
    label.textContent = "Loading…";
  };
  const onPlaying = () => {
    button.classList.remove("is-buffering");
    icon.textContent = "pause";
    label.textContent = "Playing…";
  };
  const onEnded = () => {
    icon.textContent = "play_arrow";
    label.textContent = "Play Surah";
    cleanup();
  };
  const onError = () => {
    console.error("[TAZAWWUD] Surah audio failed to load:", url);
    button.classList.remove("is-buffering");
    icon.textContent = "error";
    label.textContent = "Audio unavailable";
    cleanup();
  };

  audioEl.addEventListener("waiting", onWaiting);
  audioEl.addEventListener("playing", onPlaying);
  audioEl.addEventListener("ended", onEnded);
  audioEl.addEventListener("error", onError);

  audioEl.src = url;
  audioEl.play().catch((err) => {
    console.error("[TAZAWWUD] Audio playback failed:", err);
    onError();
  });
}

function initReaderAudio(container, reciter, surahNumber) {
  const audioEl = document.getElementById("quran-audio-player");
  const playSurahBtn = container.querySelector("#play-surah-btn");

  playSurahBtn?.addEventListener("click", () => {
    playSurahToggle(audioEl, buildSurahAudioUrl(reciter, surahNumber), playSurahBtn);
  });
}

/** Wires the per-ayah tafsir toggle buttons; fetches lazily on first open. */
function initTafsirToggles(container, surahNumber) {
  container.querySelectorAll(".ayah-tafsir-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const block = btn.closest(".ayah-block");
      const panel = block.querySelector(".ayah-block__tafsir");
      const ayahNumber = Number(block.id.replace("ayah-", ""));
      const isExpanded = btn.getAttribute("aria-expanded") === "true";

      if (isExpanded) {
        panel.hidden = true;
        btn.setAttribute("aria-expanded", "false");
        return;
      }

      btn.setAttribute("aria-expanded", "true");
      panel.hidden = false;

      if (!panel.dataset.loaded) {
        panel.textContent = "Loading tafsir…";
        try {
          const text = await fetchAyahTafsir(surahNumber, ayahNumber);
          panel.textContent = text;
          panel.dataset.loaded = "true";
        } catch (error) {
          console.error(`[TAZAWWUD] Tafsir fetch failed for ${surahNumber}:${ayahNumber}:`, error);
          panel.textContent = "Tafsir unavailable for this ayah right now.";
        }
      }
    });
  });
}

/** Wires bookmark buttons to Firebase-backed persistence and reflects saved state. */
function initBookmarks(container, surahNumber) {
  getBookmarksForSurah(surahNumber)
    .then((markedAyahs) => {
      markedAyahs.forEach((ayahNumber) => {
        container.querySelector(`#ayah-${ayahNumber} .ayah-bookmark-btn`)?.classList.add("is-active");
      });
    })
    .catch((error) => console.error("[TAZAWWUD] Failed to load bookmarks:", error));

  container.querySelectorAll(".ayah-bookmark-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const block = btn.closest(".ayah-block");
      const ayahNumber = Number(block.id.replace("ayah-", ""));

      btn.disabled = true;
      try {
        const isNowBookmarked = await toggleBookmark(surahNumber, ayahNumber);
        if (isNowBookmarked === null) {
          console.warn("[TAZAWWUD] Couldn't sign in to save bookmark (offline?).");
        } else {
          btn.classList.toggle("is-active", isNowBookmarked);
        }
      } catch (error) {
        console.error("[TAZAWWUD] Bookmark toggle failed:", error);
      } finally {
        btn.disabled = false;
      }
    });
  });
}

/** Wires the translation <select>; switching re-loads the Surah with the new edition. */
function initTranslationSelect(container, surahNumber) {
  const select = document.getElementById("translation-select");
  select?.addEventListener("change", (event) => {
    currentTranslationCode = event.target.value;
    localStorage.setItem(TRANSLATION_STORAGE_KEY, currentTranslationCode);
    loadSurahDetail(container, surahNumber);
  });
}

/**
 * Wires the reciter <select>. Switching reciters just stops whatever's
 * playing and re-renders (Arabic/translation text is cached, so this is
 * instant, not a re-fetch) — the new reciter's Play Surah button computes
 * its own URL from the formula the next time it's tapped.
 */
function initReciterSelect(container, surahNumber) {
  const select = document.getElementById("reciter-select");
  select?.addEventListener("change", (event) => {
    currentReciterId = event.target.value;
    localStorage.setItem(RECITER_STORAGE_KEY, currentReciterId);
    stopReaderAudio();
    loadSurahDetail(container, surahNumber);
  });
}

/**
 * Public entry point: mounts a single Surah's full reader view.
 * @param {HTMLElement} container the <div id="reader-content">
 * @param {number} number Surah number, 1-114
 */
export async function loadSurahDetail(container, number) {
  if (!container) return;

  container.setAttribute("aria-busy", "true");
  container.innerHTML = renderReaderSkeleton();

  try {
    const surah = await fetchSurahDetail(number, currentTranslationCode);
    const reciter = getReciter(currentReciterId);
    container.innerHTML = renderReaderHeader(surah) + surah.ayahs.map(renderAyahBlock).join("");
    container.setAttribute("aria-busy", "false");
    container.dataset.currentSurah = String(number);

    initReaderAudio(container, reciter, number);
    initTafsirToggles(container, number);
    initBookmarks(container, number);
    initTranslationSelect(container, number);
    initReciterSelect(container, number);
  } catch (error) {
    console.error(`[TAZAWWUD] Failed to load Surah ${number}:`, error);
    container.setAttribute("aria-busy", "false");
    renderReaderErrorState(container, () => loadSurahDetail(container, number));
  }
}

/** Stops any in-progress audio playback — call when navigating away from the reader. */
export function stopReaderAudio() {
  const audioEl = document.getElementById("quran-audio-player");
  if (audioEl) {
    audioEl.pause();
    audioEl.removeAttribute("src");
  }
}
